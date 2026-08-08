import type { NodelFileEntry } from '../api/nodel-types';
import { deleteNodeFile, getNodeFileContents, listNodeFiles, saveNodeFile } from '../api/nodel-host-client';
import { requestConfirm } from '../data/confirm';
import {
  type NodeRestartEvent,
  type NodeRestartRefreshContext,
  type NodeRestartRefreshResult
} from '../data/node-restart-source';
import type { NodelCodeEditor, NodelDiagnosticsSummary } from '../editor/codemirror-editor';
import { isBinaryFile, isEditableFile } from '../editor/file-types';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { loadCodeEditorModule } from '../utils/dynamic-imports';
import { renderComponentError } from '../utils/render-component-error';
import { resetFileInput } from '../utils/file-input';
import { formatFileSize } from '../utils/node-file-limits';
import { isPortableNodeFilePath, portableNodeFilePathKey } from '../utils/node-file-path';
import { isAbortError } from '../utils/errors';
import { LatestOperationCoordinator, type LatestOperationTicket } from '../utils/latest-operation-coordinator';
import { EditorDocumentSession } from '../editor/editor-document-session';
import { defaultEditorFile, EditorFileOperations, sortedEditorFiles } from '../editor/editor-file-operations';
import { EditorRestartBridge } from '../editor/editor-restart-bridge';
import { EditorUploadStaging } from '../editor/editor-upload-staging';

type EditorOperationKind = 'list' | 'open' | 'save' | 'create' | 'delete';
type EditorOperationTicket = LatestOperationTicket<EditorOperationKind>;

interface EditorFileView extends NodelFileEntry {
  active: boolean;
  binary: boolean;
  dirty: boolean;
  displayPath: string;
  kindLabel: string;
  legacy: boolean;
  missing: boolean;
  readEntry: NodelFileEntry;
  sizeLabel: string;
}

interface EditorViewModel {
  addFilePath: string;
  adding: boolean;
  binary: boolean;
  canDelete: boolean;
  canSave: boolean;
  deleting: boolean;
  dirty: boolean;
  dragActive: boolean;
  editorAssistEnabled: boolean;
  editorDiagnosticStatus: string;
  editorImportError: boolean;
  error: string;
  files: EditorFileView[];
  loading: boolean;
  legacy: boolean;
  notice: boolean;
  pickerPath: string;
  reloadStatus: string;
  saving: boolean;
  selectedPath: string;
  status: string;
  uploadFileName: string;
}

const EDITOR_TRANSIENT_NOTICE_MS = 3500;

// Keep host transport at the boundary; workflows receive this injected port.
const editorFileApi = {
  list: (signal?: AbortSignal) => listNodeFiles(signal ? { signal } : undefined),
  read: (path: string | NodelFileEntry, signal?: AbortSignal, maxBytes?: number) => getNodeFileContents(path, signal ? { signal } : undefined, maxBytes),
  save: (path: string, content: BodyInit, signal?: AbortSignal) => saveNodeFile(path, content, signal ? { signal } : undefined),
  delete: (path: string, signal?: AbortSignal) => deleteNodeFile(path, signal ? { signal } : undefined)
};

const template = `
  <div class="nodel-editor space-y-3" data-link="class{:error ? 'nodel-editor space-y-3 is-error' : 'nodel-editor space-y-3'}">
    <div class="nodel-editor-toolbar flex flex-wrap items-center gap-2">
      <div class="nodel-editor-picker-wrap min-w-0 flex-1">
        <select data-editor-file-picker aria-label="File" class="nodel-editor-picker nodel-field w-full" data-link="{:~fileOptionToken(pickerPath)} disabled{:loading || saving || deleting}">
          {^{for files}}
            <option value="{{:~fileOptionToken(path)}}">{^{>displayPath}}{^{if legacy}} (legacy, read-only){{else missing}} (local buffer){{else sizeLabel}} ({^{>sizeLabel}}){{/if}}{^{if dirty}} *{{/if}}</option>
          {{/for}}
        </select>
      </div>
      <button data-editor-refresh type="button" class="nodel-button" data-link="disabled{:loading || saving || deleting}">Refresh</button>
      <button data-editor-toggle-add type="button" class="nodel-button" data-link="disabled{:loading || saving || deleting}">New file</button>
      <label class="nodel-button cursor-pointer" data-link="class{:loading || saving || deleting ? 'nodel-button is-disabled cursor-not-allowed' : 'nodel-button cursor-pointer'}">
        Upload
        <input data-editor-upload class="sr-only" type="file" data-link="disabled{:loading || saving || deleting}" />
      </label>
      <button data-editor-default type="button" class="nodel-button" data-link="disabled{:loading || saving || deleting}">Edit script.py</button>
      <button data-editor-save type="button" class="nodel-button nodel-button-primary" data-link="disabled{:!canSave}">Save</button>
      <button data-editor-delete type="button" class="nodel-button nodel-button-danger" data-link="disabled{:!canDelete}">Delete</button>
    </div>

    {^{if legacy}}
      <div class="nodel-alert nodel-alert-warning nodel-alert-sm" role="status">This legacy file path is read-only. Saving, deleting, and overwriting it are disabled.</div>
    {{/if}}

    {^{if adding}}
      <div class="nodel-editor-add-wrap pt-1">
        <form data-editor-add-form class="nodel-editor-add nodel-card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <label class="block min-w-0 text-sm font-medium text-nodel-fg">
            File path
            <input data-editor-add-path class="nodel-field mt-1 w-full" type="text" placeholder="e.g. content/index.html" data-link="addFilePath trigger=true" />
          </label>
          <button data-editor-create-empty type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:loading || saving || deleting}">{^{if uploadFileName}}Upload{{else}}Create{{/if}}</button>
          <button data-editor-cancel-add type="button" class="nodel-button" data-link="disabled{:loading || saving || deleting}">Cancel</button>
          {^{if uploadFileName}}<p class="text-xs text-nodel-muted md:col-span-3">Selected local file: {^{>uploadFileName}}</p>{{/if}}
        </form>
      </div>
    {{/if}}

    <div class="nodel-editor-body relative">
      <div role="status" aria-live="polite" aria-atomic="true" class="nodel-editor-status" data-link="class{:error ? 'nodel-editor-status is-error' : 'nodel-editor-status'} hidden{:!error && (!status || (!notice && !loading && !saving && !deleting))}">
        {^{if error}}
          {^{>error}}
          {^{if editorImportError}}
            <button data-editor-retry-import type="button" class="nodel-button nodel-button-compact ml-2">Retry editor</button>
          {{/if}}
        {{else}}
          {^{>status}}
        {{/if}}
      </div>
      <div data-editor-reload-status role="status" aria-live="polite" aria-atomic="true" class="nodel-editor-reload-status" data-link="hidden{:!reloadStatus}">{^{>reloadStatus}}</div>
      <section class="nodel-editor-main min-w-0">
        <div data-editor-host class="nodel-editor-host"></div>
      </section>
      <div data-editor-drop-target class="nodel-editor-drop-target" data-link="hidden{:!dragActive}" aria-hidden="true">
        <span>Drop one file to upload</span>
      </div>
    </div>
    <div data-editor-authoring-status class="nodel-editor-authoring-status" data-link="hidden{:!editorAssistEnabled}">
      <span>Ctrl/Cmd+Space for Nodel UI hints.</span>
      <span data-editor-diagnostic-status role="status" aria-live="polite" aria-atomic="true">{^{>editorDiagnosticStatus}}</span>
    </div>
  </div>
`;

function sortFiles(files: NodelFileEntry[]) {
  return sortedEditorFiles(files);
}

function escapedLegacyPath(path: string) {
  return path.replace(/[\\\u0000-\u001f\u007f-\u009f]/g, (character) => {
    if (character === '\\') return '\\\\';
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    return `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  });
}

// Use fixed-width UTF-16 code units so every JavaScript string has a distinct,
// attribute-safe option token, including strings containing malformed Unicode.
function fileOptionToken(path: string) {
  let token = 'file-';
  for (let index = 0; index < path.length; index += 1) {
    token += path.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return token;
}

function editorListsFile(file: NodelFileEntry) {
  return file.compatibility === 'legacy' || isEditableFile(file.path) || isBinaryFile(file.path);
}

function toFileView(file: NodelFileEntry, selectedPath: string, dirtyPath: string): EditorFileView {
  const binary = isBinaryFile(file.path);
  const active = file.path === selectedPath;
  const dirty = file.path === dirtyPath;
  const legacy = file.compatibility === 'legacy';
  return {
    ...file,
    active,
    binary,
    dirty,
    displayPath: legacy ? escapedLegacyPath(file.path) : file.path,
    kindLabel: binary ? 'binary' : 'text',
    legacy,
    missing: false,
    readEntry: (file as EditorFileView).readEntry ?? file,
    sizeLabel: typeof file.size === 'number' ? formatFileSize(file.size) : '',
  };
}

export class NodelEditor extends HTMLElement {
  static get observedAttributes() {
    return ['default-file'];
  }

  private operations = new LatestOperationCoordinator<EditorOperationKind>();
  private editor: NodelCodeEditor | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private linked = false;
  private documentSession = new EditorDocumentSession();
  private fileOperations = new EditorFileOperations(editorFileApi, editorListsFile);
  private restartBridge = new EditorRestartBridge();
  private uploadStaging = new EditorUploadStaging();
  // Kept as a read-only test/debug view; the session owns the value.
  get openedModified() {
    return this.documentSession.state.metadata.modified;
  }
  private suppressEditorChange = false;
  private unloadGuardActive = false;
  // Compatibility projections for existing cross-layer tests. The bridge owns these values.
  get scriptExpectationGeneration() { return this.restartBridge.state.generation; }
  get scriptExpectationId() { return this.restartBridge.state.id; }
  get scriptReloadState() { return this.restartBridge.state.state; }
  private uploadFocusFrame: number | null = null;
  private transientNoticeTimer: number | null = null;
  private dragCancellationListenersActive = false;
  private state: EditorViewModel = {
    addFilePath: '',
    adding: false,
    binary: false,
    canDelete: false,
    canSave: false,
    deleting: false,
    dirty: false,
    dragActive: false,
    editorAssistEnabled: false,
    editorDiagnosticStatus: '',
    editorImportError: false,
    error: '',
    files: [],
    loading: false,
    legacy: false,
    notice: false,
    pickerPath: '',
    reloadStatus: '',
    saving: false,
    selectedPath: '',
    status: 'Loading files...',
    uploadFileName: ''
  };

  connectedCallback() {
    // A disconnected element may be reattached; each connection owns fresh staged files.
    this.uploadStaging = new EditorUploadStaging();
    const scope = this.lifecycle.connect();
    if (scope) {
      scope.own(this.restartBridge.subscribe(this.handleRestartEvent));
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    if (this.linked) {
      getJQuery().observable(this.state.files).refresh([]);
      this.documentSession.clear();
      this.projectDocumentState({
        addFilePath: '',
        adding: false,
        canDelete: false,
        canSave: false,
        deleting: false,
        editorAssistEnabled: false,
        editorDiagnosticStatus: '',
        editorImportError: false,
        loading: false,
        notice: false,
        reloadStatus: '',
        saving: false,
        status: '',
        uploadFileName: ''
      });
    }
    this.operations.invalidateAll();
    this.restartBridge.dispose();
    this.lifecycle.disconnect();
    this.syncBusyState();
    this.clearSelectedUpload();
    this.uploadStaging.dispose();
    if (this.uploadFocusFrame !== null) {
      window.cancelAnimationFrame(this.uploadFocusFrame);
      this.uploadFocusFrame = null;
    }
    this.clearTransientNoticeTimer();
    this.linked = false;
  }

  refreshAfterRestart(context?: NodeRestartRefreshContext): Promise<NodeRestartRefreshResult> {
    const scope = this.lifecycle.current;
    if (!scope) {
      return Promise.resolve({ status: 'failed', detail: 'Editor is not connected.' });
    }
    return this.refreshFilesAfterRestart(scope, context);
  }

  private restartRefreshIsCurrent(
    scope: ConnectionScope,
    ticket: EditorOperationTicket,
    context?: NodeRestartRefreshContext,
    secondaryTicket?: EditorOperationTicket
  ) {
    if (!this.operationIsCurrent(ticket, scope) || (secondaryTicket && !this.operationIsCurrent(secondaryTicket, scope))) {
      return false;
    }
    if (!context) {
      return true;
    }
    return this.restartBridge.isCurrent(context.expectation);
  }

  attributeChangedCallback() {
    if (this.linked && !this.state.selectedPath) {
      const scope = this.lifecycle.current;
      if (scope) {
        void scope.run(() => this.loadFiles(undefined, scope));
      }
    }
  }

  private async initialize(scope: ConnectionScope) {
    const linked = await this.linkController.link(scope, template, this.state, { fileOptionToken });
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    this.restartBridge.sync();
    this.bindEventListeners();
    scope.own(() => this.removeEventListeners());
    await this.initializeCodeEditor(scope);

    await this.loadFiles(undefined, scope);
  }

  private async initializeCodeEditor(scope: ConnectionScope) {
    const host = this.querySelector<HTMLElement>('[data-editor-host]');
    if (host) {
      const { createNodelCodeEditor } = await loadCodeEditorModule();
      if (!scope.isCurrent() || this.querySelector('[data-editor-host]') !== host || this.editor) {
        return;
      }
      const editor = createNodelCodeEditor({
        parent: host,
        ariaLabel: 'File contents',
        readOnly: true,
        onChange: scope.guard(this.handleEditorChange),
        onError: scope.guard((error) => this.handleInitializationError(error)),
        onDiagnostics: scope.guard(this.handleEditorDiagnostics),
        onSave: () => {
          if (scope.isCurrent()) {
            void this.saveSelectedFile();
          }
        }
      });
      this.editor = editor;
      scope.own(() => {
        editor.destroy();
        if (this.editor === editor) {
          this.editor = null;
        }
      });
      this.setState({ editorImportError: false, error: '' });
    }
  }

  private bindEventListeners() {
    this.addEventListener('click', this.handleClick);
    this.addEventListener('submit', this.handleSubmit);
    this.addEventListener('change', this.handleChange);
    this.addEventListener('dragenter', this.handleDragEnter);
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('dragleave', this.handleDragLeave);
    this.addEventListener('drop', this.handleDrop);
    this.addEventListener('dragend', this.handleDragEnd);
  }

  private handleEditorDiagnostics = (summary: NodelDiagnosticsSummary) => {
    if (!summary.enabled) {
      this.setState({ editorAssistEnabled: false, editorDiagnosticStatus: '' });
      return;
    }
    const parts = [];
    if (summary.errors) parts.push(`${summary.errors} error${summary.errors === 1 ? '' : 's'}`);
    if (summary.warnings) parts.push(`${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`);
    this.setState({
      editorAssistEnabled: true,
      editorDiagnosticStatus: summary.truncated ? 'Diagnostics limited for this document.' : parts.length ? `${parts.join(', ')}.` : 'No Nodel diagnostics.'
    });
  };

  private removeEventListeners() {
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('change', this.handleChange);
    this.removeEventListener('dragenter', this.handleDragEnter);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('dragleave', this.handleDragLeave);
    this.removeEventListener('drop', this.handleDrop);
    this.removeEventListener('dragend', this.handleDragEnd);
    this.clearDragState();
  }

  private setState(values: Partial<EditorViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
    this.syncTransientNotice(values);
    this.dataset.state = this.state.error ? 'error' : this.state.loading ? 'loading' : this.state.dirty ? 'dirty' : 'ready';
    this.syncUnloadGuard();
  }

  // JsViews is a projection only; document identity and capabilities live in the session.
  private projectDocumentState(values: Partial<EditorViewModel> = {}) {
    const document = this.documentSession.state;
    this.setState({
      binary: document.capabilities.binary,
      dirty: document.dirty,
      legacy: document.capabilities.legacy,
      pickerPath: document.path,
      selectedPath: document.path,
      ...values
    });
  }

  private clearTransientNoticeTimer() {
    if (this.transientNoticeTimer !== null) {
      window.clearTimeout(this.transientNoticeTimer);
      this.transientNoticeTimer = null;
    }
  }

  private syncTransientNotice(values: Partial<EditorViewModel>) {
    if (values.notice === false || values.error || values.loading || values.saving || values.deleting) {
      this.clearTransientNoticeTimer();
      return;
    }
    if (!this.state.notice || this.state.error || this.state.loading || this.state.saving || this.state.deleting) {
      return;
    }

    const status = this.state.status.trim();
    if (!status) {
      this.clearTransientNoticeTimer();
      getJQuery().observable(this.state).setProperty({ notice: false });
      return;
    }

    this.clearTransientNoticeTimer();
    this.transientNoticeTimer = window.setTimeout(() => {
      this.transientNoticeTimer = null;
      if (this.state.notice
        && this.state.status.trim() === status
        && !this.state.error
        && !this.state.loading
        && !this.state.saving
        && !this.state.deleting) {
        this.setState({ notice: false, status: '' });
      }
    }, EDITOR_TRANSIENT_NOTICE_MS);
  }

  private handleRestartEvent = (event: NodeRestartEvent) => {
    this.restartBridge.event(event);
    this.setState({ reloadStatus: '' });
    this.updateAvailability();
  };

  private refreshFileViews(files: NodelFileEntry[] = this.state.files) {
    const next = sortFiles(files).map((file) => toFileView(file, this.state.selectedPath, this.state.dirty ? this.state.selectedPath : ''));
    getJQuery().observable(this.state.files).refresh(next);
  }

  private updateAvailability() {
    const busy = this.state.loading || this.state.saving || this.state.deleting;
    const scriptReloadPending = this.state.selectedPath === 'script.py'
      && this.restartBridge.writeBlocked;
    const correctiveScriptSave = this.state.selectedPath === 'script.py'
      && this.restartBridge.correctiveWrite;
    this.setState({
      canDelete: Boolean(this.state.selectedPath
        && !this.state.legacy
        && (!isPortableNodeFilePath(this.state.selectedPath) || portableNodeFilePathKey(this.state.selectedPath) !== 'script.py')
        && !busy),
      canSave: Boolean(this.state.selectedPath
        && !this.state.binary
        && !this.state.legacy
        && !busy
        && !scriptReloadPending
        && (this.state.dirty || correctiveScriptSave))
    });
  }

  private beginOperation(kind: EditorOperationKind, scope: ConnectionScope) {
    const ticket = this.operations.begin(kind, scope.signal);
    this.syncBusyState();
    return ticket;
  }

  private finishOperation(ticket: EditorOperationTicket) {
    ticket.finish();
    this.syncBusyState();
  }

  private operationIsCurrent(ticket: EditorOperationTicket, scope: ConnectionScope) {
    return scope.isCurrent() && ticket.isCurrent();
  }

  private syncBusyState() {
    if (!this.linked) {
      return;
    }
    this.setState({
      loading: this.operations.isActive('list') || this.operations.isActive('open'),
      saving: this.operations.isActive('save') || this.operations.isActive('create'),
      deleting: this.operations.isActive('delete')
    });
    this.updateAvailability();
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };

  private syncUnloadGuard() {
    const shouldGuard = this.isConnected && (this.state.dirty || this.state.adding || this.uploadStaging.hasStage);
    if (shouldGuard === this.unloadGuardActive) {
      return;
    }
    this.unloadGuardActive = shouldGuard;
    if (shouldGuard) {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  private setEditorDocument(content: string, path: string) {
    this.suppressEditorChange = true;
    try {
      this.editor?.setDocument(content, path);
    } finally {
      this.suppressEditorChange = false;
    }
    this.documentSession.projectContent(this.editor?.getDocument() ?? '');
  }

  private fileForPath(path: string) {
    return this.state.files.find((file) => file.path === path);
  }

  private restoreTriggerFocus(trigger: Element | null) {
    window.setTimeout(() => {
      const candidates = [
        trigger,
        this.querySelector('[data-editor-file-picker]'),
        this.querySelector('[data-editor-toggle-add]')
      ];
      const target = candidates.find((candidate): candidate is HTMLElement => (
        candidate instanceof HTMLElement && candidate.isConnected && !candidate.hasAttribute('disabled')
      ));
      target?.focus();
    }, 0);
  }

  private async loadFiles(preferredPath?: string, scope = this.lifecycle.current) {
    if (!scope) {
      return;
    }
    const ticket = this.beginOperation('list', scope);
    this.setState({ error: '', notice: false, status: 'Loading files...' });

    try {
      const files = await this.fileOperations.list({ signal: ticket.signal, isCurrent: () => this.operationIsCurrent(ticket, scope) });
      if (!files) {
        return;
      }
      this.refreshFileViews(files);
      const nextPath = preferredPath ?? this.defaultFilePath(files);
      if (nextPath) {
        await this.openFile(nextPath, { skipDirtyPrompt: true }, scope);
      } else {
        this.setEditorDocument('', '');
        this.editor?.setReadOnly(true);
        this.setSelectedState('', '', false, files.length ? 'Files loaded.' : 'No editable node files found.');
      }
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (isAbortError(error)) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to load files' });
    } finally {
      this.finishOperation(ticket);
    }
  }

  private async refreshFilesPreservingEditor(scope: ConnectionScope, quiet = false) {
    const ticket = this.beginOperation('list', scope);
    if (!quiet) {
      this.setState({ error: '', notice: false, status: 'Refreshing files...' });
    }

    try {
      const files = await this.fileOperations.list({ signal: ticket.signal, isCurrent: () => this.operationIsCurrent(ticket, scope) });
      if (!files) {
        return false;
      }
      this.refreshFileViews(files);
      const selectedMissing = Boolean(this.state.selectedPath)
        && !files.some((file) => file.path === this.state.selectedPath);
      if (selectedMissing) {
        this.operations.invalidate('open');
        this.documentSession.selectMissing(this.state.selectedPath);
        this.syncBusyState();
        const orphan = toFileView({ path: this.state.selectedPath }, this.state.selectedPath, this.state.selectedPath);
        orphan.missing = true;
        getJQuery().observable(this.state.files).refresh([...this.state.files, orphan]);
        this.projectDocumentState({
          notice: true,
          pickerPath: this.state.selectedPath,
          status: `${this.state.selectedPath} no longer exists on the node; the local buffer remains unsaved.`
        });
        return true;
      }
      this.setState(quiet
        ? { pickerPath: this.state.selectedPath }
        : {
            pickerPath: this.state.selectedPath,
            status: files.length ? 'Files refreshed.' : 'No editable node files found.'
          });
      return true;
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return false;
      }
      if (isAbortError(error)) {
        return false;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to refresh files' });
      return false;
    } finally {
      this.finishOperation(ticket);
    }
  }

  private async refreshFilesAfterRestart(scope: ConnectionScope, context?: NodeRestartRefreshContext): Promise<NodeRestartRefreshResult> {
    const selectedPath = this.state.selectedPath;
    const revision = this.documentSession.state.revision;
    const originalContent = this.documentSession.state.cleanContent;
    const contentAtStart = this.editor?.getDocument() ?? '';
    const dirtyAtStart = this.documentSession.state.dirty;
    const ticket = this.beginOperation('list', scope);
    if (context) this.restartBridge.track(context.expectation);
    if (!this.restartRefreshIsCurrent(scope, ticket, context)) {
      this.finishOperation(ticket);
      return { status: 'superseded', detail: 'The node reload refresh is no longer current.' };
    }
    this.setState({ error: '', status: context ? 'Refreshing view after node reload...' : 'Refreshing files...' });

    try {
      const files = await this.fileOperations.list({ signal: ticket.signal, isCurrent: () => this.restartRefreshIsCurrent(scope, ticket, context) });
      if (!files) {
        return { status: 'superseded', detail: 'The node reload refresh was superseded.' };
      }

      this.refreshFileViews(files);
      const currentPath = this.state.selectedPath;
      const currentContent = this.editor?.getDocument() ?? '';
      const selectionChanged = currentPath !== selectedPath;
      if (selectionChanged) {
        return this.localRefreshResult(currentContent);
      }

      const selectedMissing = Boolean(selectedPath)
        && !files.some((file) => file.path === selectedPath);
      if (selectedMissing) {
        this.operations.invalidate('open');
        this.documentSession.selectMissing(selectedPath);
        this.syncBusyState();
        const orphan = toFileView({ path: selectedPath }, selectedPath, selectedPath);
        orphan.missing = true;
        getJQuery().observable(this.state.files).refresh([...this.state.files, orphan]);
        this.projectDocumentState({
          notice: true,
          pickerPath: selectedPath,
          status: `${selectedPath} no longer exists on the node; the local buffer remains unsaved.`
        });
        return { status: 'conflict', detail: `${selectedPath} is missing on the node.` };
      }

      this.setState({
        pickerPath: selectedPath,
        status: files.length ? (context ? '' : 'Files refreshed.') : 'No editable node files found.'
      });

      if (!context || selectedPath !== 'script.py') {
        return this.localRefreshResult(this.editor?.getDocument() ?? '');
      }

      const remoteFile = files.find((file) => file.path === selectedPath);
      if (!remoteFile) {
        return { status: 'failed', detail: 'script.py was not available in the refreshed file list.' };
      }

      const contentTicket = this.beginOperation('open', scope);
      try {
        const remoteContent = await this.fileOperations.read(selectedPath, { signal: contentTicket.signal, isCurrent: () => this.restartRefreshIsCurrent(scope, ticket, context, contentTicket) });
        if (remoteContent === null) {
          return { status: 'superseded', detail: 'The script refresh was superseded.' };
        }

        const reconciliation = this.documentSession.reconcileRestart({
          path: selectedPath, revision, cleanContent: originalContent, contentAtStart, dirtyAtStart,
          remoteContent, remoteMetadata: { modified: remoteFile.modified, size: remoteFile.size }
        });
        if (reconciliation === 'verified') {
          this.setEditorDocument(remoteContent, selectedPath);
          this.editor?.setReadOnly(false);
          this.projectDocumentState({ error: '', notice: false, status: '' });
          this.refreshFileViews();
          this.updateAvailability();
          return { status: 'verified' };
        }
        if (reconciliation === 'dirty-preserved') {
          this.projectDocumentState({
            notice: true,
            status: 'View refreshed; newer local edits remain unsaved.'
          });
          this.refreshFileViews();
          this.updateAvailability();
          return { status: 'dirty-preserved', detail: 'Local editor changes were preserved.' };
        }

        this.projectDocumentState({
          notice: true,
          status: 'Node reloaded, but remote script.py changed; local edits remain preserved for explicit resolution.'
        });
        this.refreshFileViews();
        this.updateAvailability();
        return { status: 'conflict', detail: 'Remote script.py differs from the saved baseline.' };
      } catch (error) {
        if (!this.restartRefreshIsCurrent(scope, ticket, context, contentTicket)) {
          return { status: 'superseded', detail: 'The script refresh was superseded.' };
        }
        if (isAbortError(error)) {
          return { status: 'aborted', detail: 'The script refresh was canceled.' };
        }
        const detail = error instanceof Error ? error.message : 'Failed to refresh script.py';
        this.setState({ error: detail });
        return { status: 'failed', detail };
      } finally {
        this.finishOperation(contentTicket);
      }
    } catch (error) {
      if (!this.restartRefreshIsCurrent(scope, ticket, context)) {
        return { status: 'superseded', detail: 'The editor refresh was superseded.' };
      }
      if (isAbortError(error)) {
        return { status: 'aborted', detail: 'The editor refresh was canceled.' };
      }
      const detail = error instanceof Error ? error.message : 'Failed to refresh files';
      this.setState({ error: detail });
      return { status: 'failed', detail };
    } finally {
      this.finishOperation(ticket);
    }
  }

  private localRefreshResult(content: string): NodeRestartRefreshResult {
    const dirty = this.documentSession.state.dirty || content !== this.documentSession.state.cleanContent;
    return dirty
      ? { status: 'dirty-preserved', detail: 'Local editor changes were preserved.' }
      : { status: 'verified' };
  }

  private defaultFilePath(files: NodelFileEntry[]) {
    const configured = this.getAttribute('default-file') || 'script.py';
    return defaultEditorFile(files, configured);
  }

  private scriptFilePath() {
    return this.state.files.find((file) => file.path === 'script.py')?.path
      ?? this.state.files.find((file) => !file.legacy && isPortableNodeFilePath(file.path) && portableNodeFilePathKey(file.path) === 'script.py')?.path
      ?? 'script.py';
  }

  private setSelectedState(path: string, content: string, binary: boolean, status: string, modified?: string, size?: number) {
    this.documentSession.open(path, content, { modified, size }, {
      binary,
      legacy: Boolean(path && this.fileForPath(path)?.legacy),
      missing: false,
      canWrite: Boolean(path) && !binary && !(path && this.fileForPath(path)?.legacy)
    });
    this.projectDocumentState({
      error: '',
      notice: false,
      status
    });
    this.refreshFileViews();
    this.updateAvailability();
  }

  private async openFile(path: string, options: {
    skipDirtyPrompt?: boolean;
    trigger?: Element | null;
    expectedSourcePath?: string;
    expectedSourceRevision?: number;
  } = {}, scope = this.lifecycle.current) {
    if (!scope) {
      return;
    }
    const ticket = this.beginOperation('open', scope);
    const sourcePath = options.expectedSourcePath ?? this.state.selectedPath;
    const sourceRevision = options.expectedSourceRevision ?? this.documentSession.state.revision;
    if (sourcePath !== this.state.selectedPath || sourceRevision !== this.documentSession.state.revision) {
      this.finishOperation(ticket);
      return;
    }
    if (!options.skipDirtyPrompt && !await this.confirmDiscardChanges(options.trigger ?? null, ticket.signal)) {
      this.setState({ pickerPath: this.state.selectedPath });
      this.finishOperation(ticket);
      this.restoreTriggerFocus(options.trigger ?? null);
      return;
    }
    if (!this.operationIsCurrent(ticket, scope)
      || sourcePath !== this.state.selectedPath
      || sourceRevision !== this.documentSession.state.revision) {
      this.finishOperation(ticket);
      return;
    }

    this.setState({ error: '', notice: false, status: `Loading ${path}...` });

    try {
      const result = await this.fileOperations.open(path, this.state.files, { signal: ticket.signal, isCurrent: () => this.operationIsCurrent(ticket, scope) });
      if (result.kind === 'stale') {
        return;
      }
      if (sourcePath !== this.state.selectedPath || sourceRevision !== this.documentSession.state.revision) {
        this.setState({
          notice: true,
          pickerPath: this.state.selectedPath,
            status: `${result.path} loaded, but newer local edits remain. Choose the file again to discard them.`
        });
        return;
      }
      this.setEditorDocument(result.content, result.path);
      this.editor?.setReadOnly(result.kind === 'readonly' || result.file?.compatibility === 'legacy');
      this.setSelectedState(
        result.path,
        result.kind === 'readonly' ? '' : result.content,
        result.kind === 'readonly' ? result.binary : false,
        result.kind === 'readonly' ? result.message : result.file?.compatibility === 'legacy' ? 'Legacy file path opened read-only; mutation is disabled.' : '',
        result.file?.modified,
        result.file?.size
      );
      if (result.kind === 'readonly') {
        this.setState({ notice: true, status: result.message });
      } else if (result.file?.compatibility !== 'legacy') {
        this.editor?.focus();
      }
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (isAbortError(error)) {
        return;
      }
      this.setState({
        error: error instanceof Error ? error.message : `Failed to load ${path}`,
        pickerPath: this.state.selectedPath
      });
    } finally {
      this.finishOperation(ticket);
    }
  }

  private confirmDiscardChanges(trigger: Element | null, signal?: AbortSignal) {
    if (!this.state.dirty) {
      return Promise.resolve(true);
    }
    return requestConfirm(this, {
      title: 'Discard unsaved changes?',
      text: this.state.selectedPath
        ? `Discard unsaved changes to ${this.state.selectedPath}?`
        : 'Discard unsaved changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Cancel',
      tone: 'danger'
    }, trigger, signal);
  }

  private async reloadFiles(trigger: Element | null) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const path = this.state.selectedPath;
    const revision = this.documentSession.state.revision;
    if (!await this.confirmDiscardChanges(trigger, scope.signal)
      || !scope.isCurrent()
      || path !== this.state.selectedPath
      || revision !== this.documentSession.state.revision) {
      return;
    }
    await this.refreshFilesPreservingEditor(scope);
    if (!scope.isCurrent() || path !== this.state.selectedPath || revision !== this.documentSession.state.revision) {
      if (scope.isCurrent()) {
        this.setState({ notice: true, status: 'Files refreshed; newer local edits remain unchanged.' });
      }
      return;
    }
    if (path) {
      await this.openFile(path, {
        skipDirtyPrompt: true,
        expectedSourcePath: path,
        expectedSourceRevision: revision,
        trigger
      }, scope);
    }
  }

  private handleEditorChange = (content: string) => {
    if (this.suppressEditorChange || this.state.binary || this.state.legacy) {
      return;
    }
    this.documentSession.edit(content);
    const dirty = this.documentSession.state.dirty;
    if (dirty !== this.state.dirty || this.state.notice) {
      this.projectDocumentState({ notice: false, status: dirty ? 'Unsaved changes.' : 'No unsaved changes.' });
      this.refreshFileViews();
      this.updateAvailability();
    }
  };

  private handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('[data-editor-refresh]')) {
      void this.reloadFiles(target.closest('[data-editor-refresh]'));
      return;
    }

    if (target.closest('[data-editor-retry-import]')) {
      void this.retryEditorImport();
      return;
    }

    if (target.closest('[data-editor-toggle-add]')) {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: !this.state.adding, error: '', uploadFileName: '' });
      return;
    }

    if (target.closest('[data-editor-default]')) {
      void this.openFile(this.scriptFilePath(), { trigger: target.closest('[data-editor-default]') });
      return;
    }

    if (target.closest('[data-editor-save]')) {
      void this.saveSelectedFile();
      return;
    }

    if (target.closest('[data-editor-delete]')) {
      void this.deleteSelectedFile(target.closest('[data-editor-delete]'));
      return;
    }

    if (target.closest('[data-editor-cancel-add]')) {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: false, uploadFileName: '' });
      return;
    }

    if (target.closest('[data-editor-create-empty]')) {
      event.preventDefault();
      void this.createFileFromState(target.closest('[data-editor-create-empty]'));
      return;
    }

  };

  private async retryEditorImport() {
    const scope = this.lifecycle.current;
    if (!scope || this.editor) {
      return;
    }
    this.setState({ editorImportError: false, error: '', loading: true, status: 'Loading editor...' });
    await scope.run(async () => {
      await this.initializeCodeEditor(scope);
      if (scope.isCurrent() && this.state.files.length === 0) {
        await this.loadFiles(undefined, scope);
      }
    }, (error) => this.handleInitializationError(error));
  }

  private handleSubmit = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.matches('[data-editor-add-form]')) {
      event.preventDefault();
      void this.createFileFromState(event instanceof SubmitEvent ? event.submitter : null);
    }
  };

  private handleChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.matches('[data-editor-file-picker]')) {
      const token = Reflect.get(target, 'value');
      const selectedFile = typeof token === 'string'
        ? this.state.files.find((file) => fileOptionToken(file.path) === token)
        : undefined;
      if (!selectedFile) {
        this.setState({ pickerPath: '' });
        this.setState({ pickerPath: this.state.selectedPath });
        return;
      }
      const nextPath = selectedFile.path;
      this.setState({ pickerPath: nextPath });
      if (nextPath && nextPath !== this.state.selectedPath) {
        void this.openFile(nextPath, { trigger: target });
      }
      return;
    }

    const input = target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }

    if (!input.matches('[data-editor-upload]')) {
      return;
    }

    const file = input.files[0];
    this.resetUploadInput();
    this.prepareUpload(file);
  };

  private handleDragEnter = (event: DragEvent) => {
    if (!this.hasFilePayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (this.isValidFileDrag(event.dataTransfer)) {
      this.setDragActive(true);
    } else {
      this.clearDragState();
    }
  };

  private handleDragOver = (event: DragEvent) => {
    if (!this.hasFilePayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    const valid = this.isValidFileDrag(event.dataTransfer);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
    }
    this.setDragActive(valid);
  };

  private handleDragLeave = (event: DragEvent) => {
    if (event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) {
      return;
    }
    this.clearDragState();
  };

  private handleDrop = (event: DragEvent) => {
    if (!this.hasFilePayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.clearDragState();
    const fileItemCount = event.dataTransfer ? Array.from(event.dataTransfer.items).filter((item) => item.kind === 'file').length : 0;
    const result = this.uploadStaging.classify(this.uploadStaging.extract(event.dataTransfer), fileItemCount);
    if (result.kind === 'rejected') {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: false, uploadFileName: '' });
      this.reportError(result.message);
      return;
    }
    if (result.kind === 'accepted') this.prepareUpload(result.file);
  };

  private handleDragEnd = () => {
    this.clearDragState();
  };

  private hasFilePayload(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
      return false;
    }
    return Array.from(dataTransfer.types).includes('Files')
      || Array.from(dataTransfer.items).some((item) => item.kind === 'file')
      || dataTransfer.files.length > 0;
  }

  private isValidFileDrag(dataTransfer: DataTransfer | null) {
    if (!dataTransfer || this.state.loading || this.state.saving || this.state.deleting) {
      return false;
    }
    const itemCount = Array.from(dataTransfer.items).filter((item) => item.kind === 'file').length;
    const fileCount = dataTransfer.files.length;
    return (itemCount || fileCount) === 1;
  }

  private prepareUpload(file: File) {
    const staged = this.uploadStaging.stage(file, this.state.loading || this.state.saving || this.state.deleting);
    if (!staged.accepted) {
      this.clearSelectedUpload();
      this.reportError(staged.message);
      return;
    }
    const stage = staged.stage!;
    this.setState({ addFilePath: stage.path, adding: true, error: '', uploadFileName: stage.file.name });
    if (this.uploadFocusFrame !== null) {
      window.cancelAnimationFrame(this.uploadFocusFrame);
    }
    const scope = this.lifecycle.current;
    this.uploadFocusFrame = window.requestAnimationFrame(() => {
      this.uploadFocusFrame = null;
      if (!scope?.isCurrent()) {
        return;
      }
      const input = this.querySelector<HTMLInputElement>('[data-editor-add-path]');
      input?.focus();
      input?.select();
    });
  }

  private clearDragState() {
    if (this.state.dragActive) {
      this.setState({ dragActive: false });
    }
    this.stopDragCancellationListeners();
  }

  private setDragActive(active: boolean) {
    if (active !== this.state.dragActive) {
      this.setState({ dragActive: active });
    }
    if (active) {
      this.startDragCancellationListeners();
    } else {
      this.stopDragCancellationListeners();
    }
  }

  private startDragCancellationListeners() {
    if (this.dragCancellationListenersActive) {
      return;
    }
    this.dragCancellationListenersActive = true;
    document.addEventListener('keydown', this.handleDragCancellationKeyDown);
    window.addEventListener('blur', this.handleDragCancellation);
  }

  private stopDragCancellationListeners() {
    if (!this.dragCancellationListenersActive) {
      return;
    }
    this.dragCancellationListenersActive = false;
    document.removeEventListener('keydown', this.handleDragCancellationKeyDown);
    window.removeEventListener('blur', this.handleDragCancellation);
  }

  private handleDragCancellationKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.clearDragState();
    }
  };

  private handleDragCancellation = () => {
    this.clearDragState();
  };

  private resetUploadInput() {
    resetFileInput(this.querySelector<HTMLInputElement>('[data-editor-upload]'));
  }

  private clearSelectedUpload() {
    this.uploadStaging.clear();
    this.resetUploadInput();
    this.syncUnloadGuard();
  }

  private reportError(message: string) {
    this.setState({ error: message });
    this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message } }));
  }

  private async confirmCorrectiveScriptSave(
    trigger: Element | null,
    signal: AbortSignal,
    isCurrent: () => boolean
  ) {
    if (!this.restartBridge.correctiveWrite) {
      return true;
    }

    const confirmed = await requestConfirm(this, {
      title: 'Corrective script save?',
      text: 'The previous node reload was not confirmed. Save script.py again to replace the script and start a new reload expectation?',
      confirmLabel: 'Save and reload',
      cancelLabel: 'Cancel',
      tone: 'warning'
    }, trigger, signal);
    if (!confirmed && isCurrent()) {
      this.setState({ notice: true, status: 'Corrective save canceled; the previous reload remains unconfirmed.' });
    }
    return confirmed && isCurrent();
  }

  private installSavedScriptRevision(path: string, content: BodyInit, revision: number) {
    if (path !== 'script.py' || typeof content !== 'string' || this.state.selectedPath !== path) {
      return;
    }
    const newerEditsRemain = this.documentSession.state.revision !== revision || (this.editor?.getDocument() ?? '') !== content;
    this.documentSession.completeSave({ path, content, revision, currentContent: this.editor?.getDocument() ?? content });
    this.projectDocumentState({
      notice: newerEditsRemain,
      status: newerEditsRemain
        ? `Saved previous revision of ${path}; newer edits remain unsaved.`
        : `Saved ${path}.`
    });
    this.documentSession.invalidateMetadata();
    this.refreshFileViews();
  }

  async saveSelectedFile() {
    const scope = this.lifecycle.current;
    const selectedPath = this.state.selectedPath;
    if (!scope
      || !selectedPath
      || !this.documentSession.state.capabilities.canWrite
      || (!this.documentSession.state.dirty && !(selectedPath === 'script.py' && this.restartBridge.correctiveWrite))
      || this.state.deleting
      || this.operations.isActive('list')
      || this.operations.isActive('open')
      || this.operations.isActive('save')
      || this.operations.isActive('create')) {
      return;
    }

    if (selectedPath === 'script.py' && this.restartBridge.writeBlocked) {
      return;
    }
    const ticket = this.beginOperation('save', scope);
    const path = selectedPath;
    const content = this.editor?.getDocument() ?? '';
    const revision = this.documentSession.state.revision;
    const session = this.documentSession.snapshot();
    const isCurrent = () => this.operationIsCurrent(ticket, scope) && this.state.selectedPath === path;
    this.setState({ error: '', notice: false, status: `Checking ${path} for remote changes...` });
    try {
      if (path === 'script.py' && !await this.confirmCorrectiveScriptSave(
        this.querySelector('[data-editor-save]'),
        ticket.signal, isCurrent
      )) {
        return;
      }
      this.setState({ status: `Saving ${path}...` });
      const result = await this.fileOperations.checkAndSave(session, content, { signal: ticket.signal, isCurrent }, {
        confirm: (request) => requestConfirm(this, request, null, ticket.signal),
        scriptWrite: async (payload, signal) => {
          await this.restartBridge.saveScript(payload, {
            ...(signal ? { signal } : {}), isCurrent, save: (body, saveSignal) => editorFileApi.save('script.py', body, saveSignal),
            install: () => this.installSavedScriptRevision(path, payload, revision)
          });
        }
      });
      if (result.kind !== 'saved') {
        return;
      }
      if (this.state.selectedPath === path) {
        const newerEditsRemain = this.documentSession.state.revision !== revision || (this.editor?.getDocument() ?? '') !== content;
        this.documentSession.completeSave({ path, content, revision, currentContent: this.editor?.getDocument() ?? content });
        this.projectDocumentState({
          notice: newerEditsRemain,
          status: newerEditsRemain
            ? `Saved previous revision of ${path}; newer edits remain unsaved.`
            : `Saved ${path}.`
        });
        this.refreshFileViews();
      }
      this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path } }));
      if (path === 'script.py') {
        // The pre-save metadata is no longer a valid baseline. The confirmed
        // reload refresh obtains post-write metadata alongside its content
        // decision, while the pending state blocks another script save.
        this.documentSession.invalidateMetadata();
      } else {
        const refreshed = await this.refreshFilesPreservingEditor(scope, true);
        if (this.operationIsCurrent(ticket, scope) && this.state.selectedPath === path) {
          if (refreshed) {
            const refreshedFile = this.fileForPath(path);
            this.documentSession.updateMetadata({ modified: refreshedFile?.modified, size: refreshedFile?.size });
          } else {
            this.documentSession.invalidateMetadata();
          }
        }
      }
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to save ${path}` });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.finishOperation(ticket);
    }
  }

  private async createFileFromState(trigger: Element | null) {
    const scope = this.lifecycle.current;
    if (!scope || this.state.deleting || this.operations.isActive('save') || this.operations.isActive('create')) {
      return;
    }
    const path = this.state.addFilePath;
    if (isBinaryFile(path) && !this.uploadStaging.current) {
      this.setState({ error: 'Binary files must be uploaded from a local file.' });
      return;
    }
    const ticket = this.beginOperation('create', scope);
    const stage = this.uploadStaging.current;
    const requestIsCurrent = () => this.operationIsCurrent(ticket, scope)
      && this.state.addFilePath === path
      && this.uploadStaging.current === stage;
    this.setState({ error: '', notice: false, status: `Checking ${path}...` });
    try {
      const revision = this.documentSession.state.revision;
      const result = await this.fileOperations.createOrUpload(path, () => this.uploadStaging.contentFor(path), { signal: ticket.signal, isCurrent: requestIsCurrent }, {
        confirm: (request) => requestConfirm(this, request, trigger, ticket.signal),
        scriptWrite: async (content, signal) => {
          if (!await this.confirmCorrectiveScriptSave(trigger, ticket.signal, requestIsCurrent)) throw new Error('Corrective save canceled.');
          await this.restartBridge.saveScript(content, { ...(signal ? { signal } : {}), isCurrent: requestIsCurrent, save: (body, saveSignal) => editorFileApi.save('script.py', body, saveSignal), install: () => this.installSavedScriptRevision('script.py', content, revision) });
        }
      });
      if (result.kind !== 'created' && result.kind !== 'overwritten') return;
      const overwritten = result.kind === 'overwritten';
      let overwriteNotice = '';
      if (overwritten && this.documentSession.state.path === result.path && typeof result.content === 'string') {
        const completion = this.documentSession.completeSave({
          path: result.path, content: result.content, revision,
          currentContent: this.editor?.getDocument() ?? result.content
        });
        overwriteNotice = completion.newerEdits ? `Overwrote ${result.path}; current local edits remain unsaved.` : '';
        this.projectDocumentState({ notice: completion.newerEdits, status: overwriteNotice || `Overwrote ${result.path}.` });
        this.refreshFileViews();
      }
      this.clearSelectedUpload();
      this.setState({
        addFilePath: '',
        adding: false,
        notice: true,
        uploadFileName: '',
        status: overwriteNotice || `${overwritten ? 'Overwrote' : 'Created'} ${result.path}.`
      });
      this.dispatchEvent(new CustomEvent('nodel-editor-file-created', { bubbles: true, detail: { path: result.path } }));
      if (result.path === 'script.py') {
        this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path: result.path } }));
        this.documentSession.invalidateMetadata();
      } else {
        const refreshed = await this.refreshFilesPreservingEditor(scope, true);
        if (this.operationIsCurrent(ticket, scope)
          && this.state.selectedPath
          && this.state.selectedPath === result.path) {
          if (refreshed) {
            const refreshedFile = this.fileForPath(this.state.selectedPath);
            this.documentSession.updateMetadata({ modified: refreshedFile?.modified, size: refreshedFile?.size });
          } else {
            this.documentSession.invalidateMetadata();
          }
        }
      }
    } catch (error) {
      if (!requestIsCurrent()) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to create ${path}` });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.finishOperation(ticket);
      this.restoreTriggerFocus(trigger);
    }
  }

  private async deleteSelectedFile(trigger: Element | null) {
    const scope = this.lifecycle.current;
    if (!scope
      || this.operations.isActive('save')
      || this.operations.isActive('create')
      || this.operations.isActive('delete')) {
      return;
    }
    const path = this.state.selectedPath;
    if (!path
      || this.state.legacy
      || (isPortableNodeFilePath(path) && portableNodeFilePathKey(path) === 'script.py')) {
      return;
    }
    try {
      this.fileOperations.assertDeletable(this.documentSession.snapshot());
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : `Failed to delete ${path}`);
      return;
    }
    const revision = this.documentSession.state.revision;
    const session = this.documentSession.snapshot();
    const ticket = this.beginOperation('delete', scope);
    const confirmed = await requestConfirm(this, {
      title: 'Delete file?',
      text: this.state.dirty
        ? `Delete ${path}? Unsaved changes will be lost. This cannot be undone.`
        : `Delete ${path}? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger'
    }, trigger, ticket.signal);
    if (!confirmed || !this.operationIsCurrent(ticket, scope)
      || this.state.selectedPath !== path
      || this.documentSession.state.revision !== revision) {
      this.finishOperation(ticket);
      if (!confirmed) {
        this.restoreTriggerFocus(trigger);
      }
      return;
    }

    this.setState({ error: '', notice: false, status: `Deleting ${path}...` });
    try {
      const result = await this.fileOperations.checkAndDelete(session, {
        signal: ticket.signal,
        isCurrent: () => this.operationIsCurrent(ticket, scope) && this.state.selectedPath === path
      });
      if (result.kind !== 'deleted') {
        return;
      }
      if (this.state.selectedPath === path && this.documentSession.state.revision === revision) {
        this.setEditorDocument('', '');
        this.editor?.setReadOnly(true);
        this.setSelectedState('', '', false, `Deleted ${path}.`);
        this.setState({ notice: true, status: `Deleted ${path}.` });
      } else {
        this.documentSession.selectMissing(path);
        this.projectDocumentState({ notice: true, status: `Deleted ${path}; newer local document state remains open and unsaved.` });
      }
      this.dispatchEvent(new CustomEvent('nodel-editor-file-deleted', { bubbles: true, detail: { path } }));
      await this.refreshFilesPreservingEditor(scope, true);
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to delete ${path}` });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.finishOperation(ticket);
      if (confirmed) {
        this.restoreTriggerFocus(trigger);
      }
    }
  }

  private handleInitializationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize editor';
    if (this.linked) {
      this.setState({ editorImportError: !this.editor, error: message, loading: false });
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, message);
    }
  }
}

if (!customElements.get('nodel-editor')) {
  customElements.define('nodel-editor', NodelEditor);
}
