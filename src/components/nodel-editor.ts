import type { NodelFileEntry } from '../api/nodel-types';
import { deleteNodeFile, getNodeFileContents, listNodeFiles, saveNodeFile } from '../api/nodel-host-client';
import { requestConfirm } from '../data/confirm';
import {
  cancelNodeRestartExpectation,
  activateNodeRestartExpectation,
  commitNodeRestartExpectation,
  getNodeRestartExpectation,
  getNodeRestartScriptWriteState,
  isNodeRestartExpectationPreparedForWrite,
  NodeRestartScriptWriteBlockedError,
  prepareNodeRestartExpectation,
  subscribeNodeRestart,
  type NodeRestartEvent,
  type NodeRestartExpectation,
  type NodeRestartExpectationState,
  type NodeRestartRefreshContext,
  type NodeRestartRefreshResult,
  NodeRestartExpectationObsoleteError,
  type PreparedNodeRestartExpectation
} from '../data/node-restart-source';
import type { NodelCodeEditor, NodelDiagnosticsSummary } from '../editor/codemirror-editor';
import { isBinaryFile, isEditableFile, validateNodeFilePath } from '../editor/file-types';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { loadCodeEditorModule } from '../utils/dynamic-imports';
import { renderComponentError } from '../utils/render-component-error';
import { resetFileInput } from '../utils/file-input';
import { formatFileSize, MAX_NODE_FILE_UPLOAD_BYTES, MAX_NODE_TEXT_EDIT_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';
import { isPortableNodeFilePath, nodeFileAliasKey, portableNodeFilePathKey } from '../utils/node-file-path';
import { isAbortError } from '../utils/errors';
import { LatestOperationCoordinator, type LatestOperationTicket } from '../utils/latest-operation-coordinator';

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

const binaryPlaceholder = 'Binary file - preview not available.';
const EDITOR_TRANSIENT_NOTICE_MS = 3500;

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
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
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
  private originalContent = '';
  private openedModified: string | undefined;
  private openedSize: number | undefined;
  private metadataBaselineValid = false;
  private documentRevision = 0;
  private suppressEditorChange = false;
  private unloadGuardActive = false;
  private selectedUpload: File | null = null;
  private scriptExpectationGeneration: number | null = null;
  private scriptExpectationId: number | null = null;
  private preparationExpectationId: number | null = null;
  private scriptExpectationOwned = false;
  private ownedPreparedExpectation: PreparedNodeRestartExpectation | null = null;
  private scriptReloadState: NodeRestartExpectationState = 'idle';
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
    const scope = this.lifecycle.connect();
    if (scope) {
      scope.own(subscribeNodeRestart(this.handleRestartEvent));
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    if (this.linked) {
      getJQuery().observable(this.state.files).refresh([]);
      this.originalContent = '';
      this.openedModified = undefined;
      this.openedSize = undefined;
      this.metadataBaselineValid = false;
      this.setState({
        addFilePath: '',
        adding: false,
        binary: false,
        canDelete: false,
        canSave: false,
        deleting: false,
        dirty: false,
        editorAssistEnabled: false,
        editorDiagnosticStatus: '',
        editorImportError: false,
        legacy: false,
        loading: false,
        notice: false,
        pickerPath: '',
        reloadStatus: '',
        saving: false,
        selectedPath: '',
        status: '',
        uploadFileName: ''
      });
    }
    this.operations.invalidateAll();
    const expectation = this.ownedPreparedExpectation;
    if (expectation && expectation.id === this.preparationExpectationId && this.scriptExpectationOwned) {
      cancelNodeRestartExpectation(expectation);
    }
    this.scriptExpectationOwned = false;
    this.ownedPreparedExpectation = null;
    this.scriptExpectationGeneration = null;
    this.scriptExpectationId = null;
    this.preparationExpectationId = null;
    this.scriptReloadState = 'idle';
    this.lifecycle.disconnect();
    this.syncBusyState();
    this.clearSelectedUpload();
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
    if (this.scriptExpectationId !== context.expectation.id
      || this.scriptExpectationGeneration !== context.expectation.generation) {
      return false;
    }
    const current = getNodeRestartExpectation();
    return current === null
      || (current.id === context.expectation.id
        && current.generation === context.expectation.generation);
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
    this.syncCurrentRestartExpectation();
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
    if (event.type === 'expected-preparing') {
      this.preparationExpectationId = event.expectation.id;
      this.scriptExpectationOwned = false;
      this.scriptReloadState = 'pending';
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }
    if (event.type === 'expected-pending' && this.acceptRestartExpectation(event.expectation.id)) {
      this.scriptExpectationId = event.expectation.id;
      this.scriptExpectationGeneration = event.expectation.generation;
      this.preparationExpectationId = null;
      this.scriptReloadState = event.expectation.state;
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }

    if (event.type === 'expected-timeout' && this.acceptRestartExpectation(event.expectation.id)) {
      this.scriptExpectationId = event.expectation.id;
      this.scriptExpectationGeneration = event.expectation.generation;
      this.scriptReloadState = event.expectation.state;
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }

    if (event.type === 'expected-confirmed' && this.acceptRestartExpectation(event.expectation.id)) {
      this.scriptExpectationId = event.expectation.id;
      this.scriptExpectationGeneration = event.expectation.generation;
      this.scriptReloadState = event.expectation.state;
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }

    if (event.type === 'expected-verified' && this.acceptRestartExpectation(event.expectation.id)) {
      this.scriptExpectationId = event.expectation.id;
      this.scriptExpectationGeneration = event.expectation.generation;
      this.scriptExpectationOwned = false;
      this.scriptReloadState = event.expectation.state;
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }

    if (event.type === 'expected-verification-failed' && this.acceptRestartExpectation(event.expectation.id)) {
      this.scriptExpectationId = event.expectation.id;
      this.scriptExpectationGeneration = event.expectation.generation;
      this.scriptReloadState = event.expectation.state;
      this.setState({ reloadStatus: '' });
      this.updateAvailability();
      return;
    }

    if (event.type === 'expected-superseded' && event.expectation.id === this.scriptExpectationId) {
      this.scriptExpectationGeneration = null;
      this.scriptExpectationId = null;
      this.scriptReloadState = 'idle';
      this.setState({ reloadStatus: '' });
      this.syncCurrentRestartExpectation();
      this.updateAvailability();
    }
    if (event.type === 'expected-superseded' && event.expectation.id === this.preparationExpectationId) {
      this.scriptExpectationOwned = false;
      this.ownedPreparedExpectation = null;
      this.preparationExpectationId = null;
      this.scriptReloadState = 'idle';
      this.setState({ reloadStatus: '' });
      this.syncCurrentRestartExpectation();
      this.updateAvailability();
    }
  };

  private acceptRestartExpectation(expectationId: number) {
    return this.scriptExpectationId === null || this.scriptExpectationId === expectationId;
  }

  private syncCurrentRestartExpectation() {
    const expectation = getNodeRestartExpectation();
    if (!expectation || expectation.state === 'idle') {
      return;
    }

    this.scriptExpectationOwned = false;
    this.scriptExpectationGeneration = expectation.generation;
    this.scriptExpectationId = expectation.id;
    this.scriptReloadState = expectation.state;
    this.setState({ reloadStatus: '' });
    this.updateAvailability();
  }

  private refreshFileViews(files: NodelFileEntry[] = this.state.files) {
    const next = sortFiles(files).map((file) => toFileView(file, this.state.selectedPath, this.state.dirty ? this.state.selectedPath : ''));
    getJQuery().observable(this.state.files).refresh(next);
  }

  private updateAvailability() {
    const busy = this.state.loading || this.state.saving || this.state.deleting;
    const restartWriteState = getNodeRestartScriptWriteState();
    const scriptReloadPending = this.state.selectedPath === 'script.py'
      && (restartWriteState === 'preparing'
        || restartWriteState === 'pending'
        || restartWriteState === 'refreshing'
        || this.scriptReloadState === 'pending'
        || this.scriptReloadState === 'refreshing');
    const correctiveScriptSave = this.state.selectedPath === 'script.py'
      && (restartWriteState === 'unconfirmed' || this.scriptReloadState === 'unconfirmed');
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
    const shouldGuard = this.isConnected && (this.state.dirty || this.state.adding || this.selectedUpload !== null);
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
    this.documentRevision += 1;
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
      const files = sortFiles((await listNodeFiles({ signal: ticket.signal })).filter(editorListsFile));
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      this.refreshFileViews(files);
      const nextPath = preferredPath ?? this.defaultFilePath(files);
      if (nextPath) {
        await this.openFile(nextPath, { skipDirtyPrompt: true }, scope);
      } else {
        this.setEditorDocument('', '');
        this.editor?.setReadOnly(true);
        this.setSelectedState('', '', false, false, files.length ? 'Files loaded.' : 'No editable node files found.');
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
      const files = sortFiles((await listNodeFiles({ signal: ticket.signal })).filter(editorListsFile));
      if (!this.operationIsCurrent(ticket, scope)) {
        return false;
      }
      this.refreshFileViews(files);
      const selectedMissing = Boolean(this.state.selectedPath)
        && !files.some((file) => file.path === this.state.selectedPath);
      if (selectedMissing) {
        this.operations.invalidate('open');
        this.documentRevision += 1;
        this.syncBusyState();
        const orphan = toFileView({ path: this.state.selectedPath }, this.state.selectedPath, this.state.selectedPath);
        orphan.missing = true;
        getJQuery().observable(this.state.files).refresh([...this.state.files, orphan]);
        this.setState({
          dirty: true,
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
    const revision = this.documentRevision;
    const originalContent = this.originalContent;
    const contentAtStart = this.editor?.getDocument() ?? '';
    const dirtyAtStart = this.state.dirty;
    const ticket = this.beginOperation('list', scope);
    const currentExpectation = context ? getNodeRestartExpectation() : null;
    if (context && currentExpectation
      && (currentExpectation.id !== context.expectation.id
        || currentExpectation.generation !== context.expectation.generation)) {
      this.finishOperation(ticket);
      return { status: 'superseded', detail: 'The node reload refresh is no longer current.' };
    }
    if (context && this.scriptExpectationId === null) {
      this.scriptExpectationId = context.expectation.id;
      this.scriptExpectationGeneration = context.expectation.generation;
      this.scriptReloadState = context.expectation.state;
    }
    if (!this.restartRefreshIsCurrent(scope, ticket, context)) {
      this.finishOperation(ticket);
      return { status: 'superseded', detail: 'The node reload refresh is no longer current.' };
    }
    this.setState({ error: '', status: context ? 'Refreshing view after node reload...' : 'Refreshing files...' });

    try {
      const files = sortFiles((await listNodeFiles({ signal: ticket.signal })).filter(editorListsFile));
      if (!this.restartRefreshIsCurrent(scope, ticket, context)) {
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
        this.documentRevision += 1;
        this.openedModified = undefined;
        this.openedSize = undefined;
        this.metadataBaselineValid = false;
        this.syncBusyState();
        const orphan = toFileView({ path: selectedPath }, selectedPath, selectedPath);
        orphan.missing = true;
        getJQuery().observable(this.state.files).refresh([...this.state.files, orphan]);
        this.setState({
          dirty: true,
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
        const remoteContent = await getNodeFileContents(selectedPath, { signal: contentTicket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
        if (!this.restartRefreshIsCurrent(scope, ticket, context, contentTicket)) {
          return { status: 'superseded', detail: 'The script refresh was superseded.' };
        }

        const unchangedClean = selectedPath === this.state.selectedPath
          && revision === this.documentRevision
          && !dirtyAtStart
          && !this.state.dirty
          && contentAtStart === originalContent
          && (this.editor?.getDocument() ?? '') === contentAtStart;
        if (unchangedClean) {
          this.setEditorDocument(remoteContent, selectedPath);
          this.editor?.setReadOnly(false);
          this.setSelectedState(selectedPath, remoteContent, false, false, '', remoteFile.modified, remoteFile.size);
          this.setState({ notice: false, status: '' });
          return { status: 'verified' };
        }

        const localContent = this.editor?.getDocument() ?? '';
        if (remoteContent === originalContent) {
          this.openedModified = remoteFile.modified;
          this.openedSize = remoteFile.size;
          this.metadataBaselineValid = true;
          const dirty = localContent !== this.originalContent || this.state.dirty;
          this.setState({
            dirty,
            notice: true,
            status: 'View refreshed; newer local edits remain unsaved.'
          });
          this.refreshFileViews();
          this.updateAvailability();
          return { status: 'dirty-preserved', detail: 'Local editor changes were preserved.' };
        }

        this.metadataBaselineValid = false;
        this.openedModified = undefined;
        this.openedSize = undefined;
        this.setState({
          dirty: true,
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
    const dirty = this.state.dirty || content !== this.originalContent;
    return dirty
      ? { status: 'dirty-preserved', detail: 'Local editor changes were preserved.' }
      : { status: 'verified' };
  }

  private defaultFilePath(files: NodelFileEntry[]) {
    const configured = this.getAttribute('default-file') || 'script.py';
    return files.find((file) => file.path === configured)?.path
      ?? files.find((file) => file.path === 'script.py')?.path
      ?? files.find((file) => isEditableFile(file.path))?.path
      ?? files[0]?.path
      ?? '';
  }

  private scriptFilePath() {
    return this.state.files.find((file) => file.path === 'script.py')?.path
      ?? this.state.files.find((file) => !file.legacy && isPortableNodeFilePath(file.path) && portableNodeFilePathKey(file.path) === 'script.py')?.path
      ?? 'script.py';
  }

  private setSelectedState(path: string, content: string, binary: boolean, dirty: boolean, status: string, modified?: string, size?: number) {
    this.originalContent = content;
    this.openedModified = modified;
    this.openedSize = size;
    this.metadataBaselineValid = Boolean(path);
    this.setState({
      binary,
      dirty,
      error: '',
      legacy: Boolean(path && this.fileForPath(path)?.legacy),
      notice: false,
      selectedPath: path,
      pickerPath: path,
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
    const sourceRevision = options.expectedSourceRevision ?? this.documentRevision;
    if (sourcePath !== this.state.selectedPath || sourceRevision !== this.documentRevision) {
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
      || sourceRevision !== this.documentRevision) {
      this.finishOperation(ticket);
      return;
    }

    const file = this.fileForPath(path);
    const resolvedPath = file?.path ?? path;
    const legacy = file?.legacy === true;
    const applyReadOnlyDocument = (message: string, placeholder: string) => {
      if (!this.operationIsCurrent(ticket, scope)
        || sourcePath !== this.state.selectedPath
        || sourceRevision !== this.documentRevision) {
        return;
      }
      this.setEditorDocument(placeholder, resolvedPath);
      this.editor?.setReadOnly(true);
      this.setSelectedState(resolvedPath, '', true, false, message, file?.modified, file?.size);
      this.setState({ notice: true, status: message });
    };

    if (!file && !isPortableNodeFilePath(resolvedPath)) {
      this.setState({ error: 'Legacy file paths can only be opened from the current file list.', pickerPath: this.state.selectedPath });
      this.finishOperation(ticket);
      return;
    }

    if (isPortableNodeFilePath(resolvedPath) && portableNodeFilePathKey(resolvedPath) === 'script.py' && resolvedPath !== 'script.py') {
      applyReadOnlyDocument(
        `${resolvedPath} is a case-only script.py alias and cannot be edited safely across supported hosts.`,
        'Case-only script.py aliases are read-only in the browser editor.'
      );
      this.finishOperation(ticket);
      return;
    }

    if (isBinaryFile(resolvedPath)) {
      applyReadOnlyDocument(legacy ? 'Legacy binary file paths are read-only; preview is not available.' : 'Binary file preview is not available.', binaryPlaceholder);
      this.finishOperation(ticket);
      return;
    }

    if (typeof file?.size === 'number' && file.size > MAX_NODE_TEXT_EDIT_BYTES) {
      applyReadOnlyDocument(
        `${resolvedPath} is too large to edit (limit ${formatFileSize(MAX_NODE_TEXT_EDIT_BYTES)}); download or manage it externally.`,
        'File is too large to edit in the browser.'
      );
      this.finishOperation(ticket);
      return;
    }

    this.setState({ error: '', notice: false, status: `Loading ${resolvedPath}...` });

    try {
      const content = await getNodeFileContents(file?.legacy ? file.readEntry : resolvedPath, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (sourcePath !== this.state.selectedPath || sourceRevision !== this.documentRevision) {
        this.setState({
          notice: true,
          pickerPath: this.state.selectedPath,
          status: `${resolvedPath} loaded, but newer local edits remain. Choose the file again to discard them.`
        });
        return;
      }
      this.setEditorDocument(content, resolvedPath);
      this.editor?.setReadOnly(legacy);
      this.setSelectedState(
        resolvedPath,
        content,
        false,
        false,
        legacy ? 'Legacy file path opened read-only; mutation is disabled.' : '',
        file?.modified,
        file?.size
      );
      if (!legacy) {
        this.editor?.focus();
      }
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (isAbortError(error)) {
        return;
      }
      if (error instanceof NodeFileTooLargeError) {
        applyReadOnlyDocument(
          `${resolvedPath} is too large to edit (limit ${formatFileSize(MAX_NODE_TEXT_EDIT_BYTES)}); download or manage it externally.`,
          'File is too large to edit in the browser.'
        );
        return;
      }
      this.setState({
        error: error instanceof Error ? error.message : `Failed to load ${resolvedPath}`,
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
    const revision = this.documentRevision;
    if (!await this.confirmDiscardChanges(trigger, scope.signal)
      || !scope.isCurrent()
      || path !== this.state.selectedPath
      || revision !== this.documentRevision) {
      return;
    }
    await this.refreshFilesPreservingEditor(scope);
    if (!scope.isCurrent() || path !== this.state.selectedPath || revision !== this.documentRevision) {
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
    this.documentRevision += 1;
    const dirty = content !== this.originalContent;
    if (dirty !== this.state.dirty || this.state.notice) {
      this.setState({ dirty, notice: false, status: dirty ? 'Unsaved changes.' : 'No unsaved changes.' });
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
    const files = this.filesFromTransfer(event.dataTransfer);
    if (files.length !== 1 || fileItemCount > 1) {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: false, uploadFileName: '' });
      this.reportError('Drop one file at a time.');
      return;
    }
    this.prepareUpload(files[0]);
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

  private filesFromTransfer(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
      return [];
    }
    const files = Array.from(dataTransfer.files);
    if (files.length > 0) {
      return files;
    }
    return Array.from(dataTransfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }

  private prepareUpload(file: File) {
    if (this.state.loading || this.state.saving || this.state.deleting) {
      this.reportError('Wait for the current editor operation to finish before uploading.');
      return;
    }
    const maxBytes = isEditableFile(file.name) ? MAX_NODE_TEXT_EDIT_BYTES : MAX_NODE_FILE_UPLOAD_BYTES;
    if (file.size > maxBytes) {
      this.clearSelectedUpload();
      this.reportError(`${file.name} exceeds the ${formatFileSize(maxBytes)} upload limit.`);
      return;
    }
    this.clearSelectedUpload();
    this.selectedUpload = file;
    this.setState({ addFilePath: file.name, adding: true, error: '', uploadFileName: file.name });
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
    this.selectedUpload = null;
    this.resetUploadInput();
    this.syncUnloadGuard();
  }

  private reportError(message: string) {
    this.setState({ error: message });
    this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message } }));
  }

  private currentScriptWriteState() {
    return getNodeRestartScriptWriteState();
  }

  private async confirmCorrectiveScriptSave(
    trigger: Element | null,
    signal: AbortSignal,
    isCurrent: () => boolean
  ) {
    const writeState = this.currentScriptWriteState();
    if (writeState !== 'unconfirmed' && this.scriptReloadState !== 'unconfirmed') {
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

  private async saveScriptFile(
    content: BodyInit,
    ticket: EditorOperationTicket,
    scope: ConnectionScope,
    beforeActivate: () => void
  ) {
    if (this.currentScriptWriteState() === 'pending'
      || this.currentScriptWriteState() === 'refreshing'
      || this.currentScriptWriteState() === 'preparing'
      || this.scriptReloadState === 'pending'
      || this.scriptReloadState === 'refreshing') {
      throw new NodeRestartScriptWriteBlockedError();
    }

    let prepared: PreparedNodeRestartExpectation | null = null;
    let committedExpectation: NodeRestartExpectation | null = null;
    let committed = false;
    try {
      try {
        prepared = await prepareNodeRestartExpectation({ signal: ticket.signal });
      } catch (error) {
        if (error instanceof NodeRestartScriptWriteBlockedError) {
          throw error;
        }
        const detail = error instanceof Error ? error.message : 'The node reload baseline could not be read.';
        throw new Error(`Could not capture the node reload baseline; script.py was not saved. ${detail}`);
      }
      if (!this.operationIsCurrent(ticket, scope)) {
        throw new NodeRestartExpectationObsoleteError();
      }

      this.preparationExpectationId = prepared.id;
      this.scriptExpectationOwned = true;
      this.ownedPreparedExpectation = prepared;
      this.scriptReloadState = 'pending';
      this.updateAvailability();
      if (!isNodeRestartExpectationPreparedForWrite(prepared)) {
        throw new NodeRestartExpectationObsoleteError();
      }
      await saveNodeFile('script.py', content, { signal: ticket.signal });
      if (!this.operationIsCurrent(ticket, scope)) {
        throw new NodeRestartExpectationObsoleteError();
      }

      committedExpectation = commitNodeRestartExpectation(prepared, false);
      if (!committedExpectation) {
        throw new NodeRestartExpectationObsoleteError();
      }
      beforeActivate();
      if (!activateNodeRestartExpectation(committedExpectation.id, committedExpectation.generation)) {
        throw new NodeRestartExpectationObsoleteError();
      }
      committed = true;
      this.scriptExpectationOwned = false;
      this.ownedPreparedExpectation = null;
      return committedExpectation;
    } catch (error) {
      if (committedExpectation && !committed) {
        cancelNodeRestartExpectation(committedExpectation);
      } else if (prepared && !committed) {
        cancelNodeRestartExpectation(prepared);
        this.restoreRestartStateAfterPreparation(prepared);
      }
      throw error;
    }
  }

  private restoreRestartStateAfterPreparation(prepared: PreparedNodeRestartExpectation) {
    if (this.preparationExpectationId !== prepared.id) {
      return;
    }
    this.scriptExpectationOwned = false;
    this.ownedPreparedExpectation = null;
    this.preparationExpectationId = null;
    this.scriptReloadState = 'idle';
    this.setState({ reloadStatus: '' });
    this.syncCurrentRestartExpectation();
    this.updateAvailability();
  }

  private installSavedScriptRevision(path: string, content: BodyInit, revision: number) {
    if (path !== 'script.py' || typeof content !== 'string' || this.state.selectedPath !== path) {
      return;
    }
    this.originalContent = content;
    const newerEditsRemain = this.documentRevision !== revision || (this.editor?.getDocument() ?? '') !== content;
    this.setState({
      dirty: newerEditsRemain,
      notice: newerEditsRemain,
      status: newerEditsRemain
        ? `Saved previous revision of ${path}; newer edits remain unsaved.`
        : `Saved ${path}.`
    });
    this.openedModified = undefined;
    this.openedSize = undefined;
    this.metadataBaselineValid = false;
    this.refreshFileViews();
  }

  async saveSelectedFile() {
    const scope = this.lifecycle.current;
    const selectedPath = this.state.selectedPath;
    const isScriptPath = selectedPath === 'script.py';
    const globalWriteState = this.currentScriptWriteState();
    const correctiveScriptSave = isScriptPath
      && (globalWriteState === 'unconfirmed' || this.scriptReloadState === 'unconfirmed');
    if (!scope
      || !selectedPath
      || this.state.binary
      || this.state.legacy
      || (!this.state.dirty && !correctiveScriptSave)
      || this.state.deleting
      || this.operations.isActive('list')
      || this.operations.isActive('open')
      || this.operations.isActive('save')
      || this.operations.isActive('create')) {
      return;
    }

    const path = selectedPath;
    const isScriptSave = path === 'script.py';
    if (isScriptSave && (this.currentScriptWriteState() === 'pending'
      || this.currentScriptWriteState() === 'refreshing'
      || this.currentScriptWriteState() === 'preparing'
      || this.scriptReloadState === 'pending'
      || this.scriptReloadState === 'refreshing')) {
      return;
    }
    const ticket = this.beginOperation('save', scope);
    let content = '';
    let revision = 0;
    let originalContent = '';
    let openedModified: string | undefined;
    let openedSize: number | undefined;
    let metadataBaselineValid = false;
    this.setState({ error: '', notice: false, status: `Checking ${path} for remote changes...` });
    try {
      if (isScriptSave && !await this.confirmCorrectiveScriptSave(
        this.querySelector('[data-editor-save]'),
        ticket.signal,
        () => this.operationIsCurrent(ticket, scope)
      )) {
        return;
      }

      content = this.editor?.getDocument() ?? '';
      if (new TextEncoder().encode(content).byteLength > MAX_NODE_TEXT_EDIT_BYTES) {
        throw new Error(`${path} exceeds the ${formatFileSize(MAX_NODE_TEXT_EDIT_BYTES)} text-upload limit.`);
      }
      revision = this.documentRevision;
      originalContent = this.originalContent;
      openedModified = this.openedModified;
      openedSize = this.openedSize;
      metadataBaselineValid = this.metadataBaselineValid;

      const files = await listNodeFiles({ signal: ticket.signal });
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      let remoteFile = files.find((file) => file.path === path);
      if (!remoteFile) {
        const recreate = await requestConfirm(this, {
          title: 'Recreate missing file?',
          text: `${path} no longer exists on the node. Recreate it from this local buffer?`,
          confirmLabel: 'Recreate',
          cancelLabel: 'Cancel',
          tone: 'warning'
        }, null, ticket.signal);
        if (!recreate
          || !this.operationIsCurrent(ticket, scope)
          || this.state.selectedPath !== path
          || this.documentRevision !== revision) {
          return;
        }
        const refreshedFiles = await listNodeFiles({ signal: ticket.signal });
        if (!this.operationIsCurrent(ticket, scope)) {
          return;
        }
        remoteFile = refreshedFiles.find((file) => file.path === path);
        if (remoteFile) {
          throw new Error(`${path} was recreated on the node while confirmation was pending. Refresh before saving.`);
        }
        const aliasKey = nodeFileAliasKey(path);
        const alias = aliasKey ? refreshedFiles.find((file) => nodeFileAliasKey(file.path) === aliasKey) : undefined;
        if (alias) {
          throw new Error(`${path} now has a case- or NFC-equivalent alias (${alias.path}). Refresh before saving.`);
        }
      }
      if (remoteFile && metadataBaselineValid && openedModified !== remoteFile.modified) {
        throw new Error(`${path} changed on the node after it was opened. Refresh before saving.`);
      }
      if (remoteFile && metadataBaselineValid && openedSize !== remoteFile.size) {
        throw new Error(`${path} changed on the node after it was opened. Refresh before saving.`);
      }
      if (remoteFile) {
        const remoteContent = await getNodeFileContents(path, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
        if (!this.operationIsCurrent(ticket, scope)) {
          return;
        }
        if (remoteContent !== originalContent) {
          throw new Error(`${path} changed on the node after it was opened. Refresh before saving.`);
        }
      }

      this.setState({ status: `Saving ${path}...` });
      if (isScriptSave) {
        await this.saveScriptFile(content, ticket, scope, () => {
          this.installSavedScriptRevision(path, content, revision);
        });
      } else {
        await saveNodeFile(path, content, { signal: ticket.signal });
      }
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (this.state.selectedPath === path) {
        this.originalContent = content;
        const newerEditsRemain = this.documentRevision !== revision || (this.editor?.getDocument() ?? '') !== content;
        this.setState({
          dirty: newerEditsRemain,
          notice: newerEditsRemain,
          status: newerEditsRemain
            ? `Saved previous revision of ${path}; newer edits remain unsaved.`
            : `Saved ${path}.`
        });
        this.refreshFileViews();
      }
      this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path } }));
      if (isScriptSave) {
        // The pre-save metadata is no longer a valid baseline. The confirmed
        // reload refresh obtains post-write metadata alongside its content
        // decision, while the pending state blocks another script save.
        this.openedModified = undefined;
        this.openedSize = undefined;
        this.metadataBaselineValid = false;
      } else {
        const refreshed = await this.refreshFilesPreservingEditor(scope, true);
        if (this.operationIsCurrent(ticket, scope) && this.state.selectedPath === path) {
          if (refreshed) {
            const refreshedFile = this.fileForPath(path);
            this.openedModified = refreshedFile?.modified;
            this.openedSize = refreshedFile?.size;
            this.metadataBaselineValid = true;
          } else {
            this.metadataBaselineValid = false;
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
    const validation = validateNodeFilePath(path);
    if (validation) {
      this.setState({ error: validation });
      return;
    }

    if (isBinaryFile(path) && !this.selectedUpload) {
      this.setState({ error: 'Binary files must be uploaded from a local file.' });
      return;
    }
    const upload = this.selectedUpload;
    if (upload) {
      const maxBytes = isEditableFile(path) ? MAX_NODE_TEXT_EDIT_BYTES : MAX_NODE_FILE_UPLOAD_BYTES;
      if (upload.size > maxBytes) {
        this.setState({ error: `${upload.name} exceeds the ${formatFileSize(maxBytes)} upload limit.` });
        return;
      }
    }

    const ticket = this.beginOperation('create', scope);
    const requestedPortableKey = portableNodeFilePathKey(path);
    const requestIsCurrent = () => this.operationIsCurrent(ticket, scope)
      && this.state.addFilePath === path
      && this.selectedUpload === upload;
    let restoreFocusAfterConfirmation = false;
    this.setState({ error: '', notice: false, status: `Checking ${path}...` });
    try {
      const files = await listNodeFiles({ signal: ticket.signal });
      if (!requestIsCurrent()) {
        return;
      }
      const exactExisting = files.find((file) => file.path === path);
      const aliasMatches = files.filter((file) => nodeFileAliasKey(file.path) === requestedPortableKey);
      if (!exactExisting && aliasMatches.length > 1) {
        throw new Error(`${path} is ambiguous because multiple case variants already exist on the node.`);
      }
      const existing = exactExisting ?? aliasMatches[0];
      const targetPath = existing?.path ?? path;
      if (existing?.compatibility === 'legacy') {
        throw new Error(`${existing.path} is a legacy file path and cannot be overwritten.`);
      }
      if (portableNodeFilePathKey(targetPath) === 'script.py' && targetPath !== 'script.py') {
        throw new Error(`${targetPath} is a case-only script.py alias and cannot be overwritten safely.`);
      }
      let existingContent: string | undefined;
      if (existing) {
        if (isBinaryFile(existing.path) && existing.modified === undefined && existing.size === undefined) {
          throw new Error(`${existing.path} has no metadata for safe overwrite verification; manage it externally.`);
        }
        if (isEditableFile(existing.path)) {
          if (typeof existing.size === 'number' && existing.size > MAX_NODE_TEXT_EDIT_BYTES) {
            throw new Error(`${existing.path} is too large to verify safely before overwrite.`);
          }
          existingContent = await getNodeFileContents(existing.path, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
          if (!requestIsCurrent()) {
            return;
          }
        }
        const overwrite = await requestConfirm(this, {
          title: 'Overwrite existing file?',
          text: `${existing.path} already exists. Replace it?`,
          confirmLabel: 'Overwrite',
          cancelLabel: 'Cancel',
          tone: 'danger'
        }, trigger, ticket.signal);
        if (!overwrite) {
          this.restoreTriggerFocus(trigger);
          return;
        }
        if (!requestIsCurrent()) {
          return;
        }
        restoreFocusAfterConfirmation = true;
      }

      const refreshedFiles = await listNodeFiles({ signal: ticket.signal });
      if (!requestIsCurrent()) {
        return;
      }
      const refreshedExact = refreshedFiles.find((file) => file.path === targetPath);
      const refreshedAliases = refreshedFiles.filter((file) => nodeFileAliasKey(file.path) === requestedPortableKey);
      if (!existing && refreshedAliases.length > 0) {
        throw new Error(`${path} was created on the node while this operation was pending. Review it before overwriting.`);
      }
      if (existing) {
        if (!refreshedExact) {
          throw new Error(`${existing.path} changed while overwrite confirmation was pending. Review the file list and try again.`);
        }
        if (existing.modified !== refreshedExact.modified) {
          throw new Error(`${existing.path} changed while overwrite confirmation was pending. Review it before overwriting.`);
        }
        if (existing.size !== refreshedExact.size) {
          throw new Error(`${existing.path} changed while overwrite confirmation was pending. Review it before overwriting.`);
        }
        if (existingContent !== undefined) {
          const refreshedContent = await getNodeFileContents(existing.path, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
          if (!requestIsCurrent()) {
            return;
          }
          if (existingContent !== refreshedContent) {
            throw new Error(`${existing.path} changed while overwrite confirmation was pending. Review it before overwriting.`);
          }
        }
      }

      const content = await this.uploadContentForPath(targetPath, upload);
      if (!requestIsCurrent()) {
        return;
      }
      const isScriptSave = targetPath === 'script.py';
      if (isScriptSave && !await this.confirmCorrectiveScriptSave(trigger, ticket.signal, requestIsCurrent)) {
        return;
      }
      this.setState({ status: `${existing ? 'Overwriting' : 'Creating'} ${targetPath}...` });
      if (isScriptSave) {
        const revision = this.documentRevision;
        await this.saveScriptFile(content, ticket, scope, () => {
          this.installSavedScriptRevision(targetPath, content, revision);
        });
      } else {
        await saveNodeFile(targetPath, content, { signal: ticket.signal });
      }
      if (!requestIsCurrent()) {
        return;
      }
      let overwriteNotice = '';
      if (this.state.selectedPath === targetPath && typeof content === 'string') {
        this.originalContent = content;
        const dirty = (this.editor?.getDocument() ?? '') !== content;
        overwriteNotice = dirty ? `Overwrote ${targetPath}; current local edits remain unsaved.` : '';
        this.setState({
          dirty,
          notice: dirty,
          status: overwriteNotice || `Overwrote ${targetPath}.`
        });
        this.refreshFileViews();
      }
      this.clearSelectedUpload();
      this.setState({
        addFilePath: '',
        adding: false,
        notice: true,
        uploadFileName: '',
        status: overwriteNotice || (existing ? `Overwrote ${targetPath}.` : `Created ${targetPath}.`)
      });
      this.dispatchEvent(new CustomEvent('nodel-editor-file-created', { bubbles: true, detail: { path: targetPath } }));
      if (isScriptSave) {
        this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path: targetPath } }));
        this.openedModified = undefined;
        this.openedSize = undefined;
        this.metadataBaselineValid = false;
      } else {
        const refreshed = await this.refreshFilesPreservingEditor(scope, true);
        if (this.operationIsCurrent(ticket, scope)
          && this.state.selectedPath
          && this.state.selectedPath === targetPath) {
          if (refreshed) {
            const refreshedFile = this.fileForPath(this.state.selectedPath);
            this.openedModified = refreshedFile?.modified;
            this.openedSize = refreshedFile?.size;
            this.metadataBaselineValid = true;
          } else {
            this.metadataBaselineValid = false;
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
      if (restoreFocusAfterConfirmation) {
        this.restoreTriggerFocus(trigger);
      }
    }
  }

  private async uploadContentForPath(path: string, upload: File | null): Promise<BodyInit> {
    if (!upload) {
      return '';
    }

    if (path === 'script.py' || isEditableFile(path)) {
      const content = await upload.text();
      if (new TextEncoder().encode(content).byteLength > MAX_NODE_TEXT_EDIT_BYTES) {
        throw new Error(`${upload.name} exceeds the ${formatFileSize(MAX_NODE_TEXT_EDIT_BYTES)} text-upload limit after decoding.`);
      }
      return content;
    }

    return upload;
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
    if (this.state.binary && this.openedModified === undefined && this.openedSize === undefined) {
      this.reportError(`${path} has no metadata for safe delete verification; manage it externally.`);
      return;
    }
    const revision = this.documentRevision;
    const openedModified = this.openedModified;
    const openedSize = this.openedSize;
    const metadataBaselineValid = this.metadataBaselineValid;
    const originalContent = this.originalContent;
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
      || this.documentRevision !== revision) {
      this.finishOperation(ticket);
      if (!confirmed) {
        this.restoreTriggerFocus(trigger);
      }
      return;
    }

    this.setState({ error: '', notice: false, status: `Deleting ${path}...` });
    try {
      const files = await listNodeFiles({ signal: ticket.signal });
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      const remoteFile = files.find((file) => file.path === path);
      if (!remoteFile) {
        throw new Error(`${path} no longer exists on the node. Refresh before deleting.`);
      }
      if (metadataBaselineValid && openedModified !== remoteFile.modified) {
        throw new Error(`${path} changed on the node after it was opened. Refresh before deleting.`);
      }
      if (metadataBaselineValid && openedSize !== remoteFile.size) {
        throw new Error(`${path} changed on the node after it was opened. Refresh before deleting.`);
      }
      if (isEditableFile(path)) {
        const remoteContent = await getNodeFileContents(path, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
        if (!this.operationIsCurrent(ticket, scope)) {
          return;
        }
        if (remoteContent !== originalContent) {
          throw new Error(`${path} changed on the node after it was opened. Refresh before deleting.`);
        }
      }
      await deleteNodeFile(path, { signal: ticket.signal });
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (this.state.selectedPath === path && this.documentRevision === revision) {
        this.setEditorDocument('', '');
        this.editor?.setReadOnly(true);
        this.setSelectedState('', '', false, false, `Deleted ${path}.`);
        this.setState({ notice: true, status: `Deleted ${path}.` });
      } else {
        this.setState({ dirty: true, notice: true, status: `Deleted ${path}; newer local document state remains open and unsaved.` });
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
