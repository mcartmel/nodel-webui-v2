import type { NodelFileEntry } from '../api/nodel-types';
import { deleteNodeFile, getNodeFileContents, listNodeFiles, saveNodeFile } from '../api/nodel-host-client';
import { requestConfirm } from '../data/confirm';
import type { NodelCodeEditor } from '../editor/codemirror-editor';
import { EditorOperationCoordinator, type EditorOperationKind, type EditorOperationTicket } from '../editor/editor-operation-coordinator';
import { isBinaryFile, isEditableFile, validateNodeFilePath } from '../editor/file-types';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { loadCodeEditorModule } from '../utils/dynamic-imports';
import { renderComponentError } from '../utils/render-component-error';
import { resetFileInput } from '../utils/file-input';
import { formatFileSize, MAX_NODE_FILE_UPLOAD_BYTES, MAX_NODE_TEXT_EDIT_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';
import { canonicalNodeFilePath, portableNodeFilePathKey } from '../utils/node-file-path';

interface EditorFileView extends NodelFileEntry {
  active: boolean;
  binary: boolean;
  dirty: boolean;
  kindLabel: string;
  missing: boolean;
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
  error: string;
  files: EditorFileView[];
  loading: boolean;
  notice: boolean;
  pickerPath: string;
  saving: boolean;
  selectedPath: string;
  status: string;
  uploadFileName: string;
}

const binaryPlaceholder = 'Binary file - preview not available.';

const template = `
  <div class="nodel-editor space-y-3" data-link="class{:error ? 'nodel-editor space-y-3 is-error' : 'nodel-editor space-y-3'}">
    <div class="nodel-editor-toolbar flex flex-wrap items-center gap-2">
      <div class="nodel-editor-picker-wrap min-w-0 flex-1">
        <select data-editor-file-picker aria-label="File" class="nodel-editor-picker nodel-field w-full" data-link="value{:pickerPath trigger=true} disabled{:loading || saving || deleting}">
          {^{for files}}
            <option value="{{>path}}" data-link="selected{:active}">{^{>path}}{^{if missing}} (local buffer){{else sizeLabel}} ({^{>sizeLabel}}){{/if}}{^{if dirty}} *{{/if}}</option>
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
      <div role="status" aria-live="polite" aria-atomic="true" class="nodel-editor-status" data-link="class{:error ? 'nodel-editor-status is-error' : 'nodel-editor-status'} hidden{:!error && !notice && !loading && !saving && !deleting}">
        {^{if error}}
          {^{>error}}
        {{else}}
          {^{>status}}
        {{/if}}
      </div>
      <section class="nodel-editor-main min-w-0">
        <div data-editor-host class="nodel-editor-host"></div>
      </section>
      <div data-editor-drop-target class="nodel-editor-drop-target" data-link="hidden{:!dragActive}" aria-hidden="true">
        <span>Drop one file to upload</span>
      </div>
    </div>
  </div>
`;

function sortFiles(files: NodelFileEntry[]) {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

function toFileView(file: NodelFileEntry, selectedPath: string, dirtyPath: string): EditorFileView {
  const binary = isBinaryFile(file.path);
  const active = file.path === selectedPath;
  const dirty = file.path === dirtyPath;
  return {
    ...file,
    active,
    binary,
    dirty,
    kindLabel: binary ? 'binary' : 'text',
    missing: false,
    sizeLabel: typeof file.size === 'number' ? formatFileSize(file.size) : '',
  };
}

export class NodelEditor extends HTMLElement {
  static get observedAttributes() {
    return ['default-file'];
  }

  private operations = new EditorOperationCoordinator();
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
  private uploadFocusFrame: number | null = null;
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
    error: '',
    files: [],
    loading: false,
    notice: false,
    pickerPath: '',
    saving: false,
    selectedPath: '',
    status: 'Loading files...',
    uploadFileName: ''
  };

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
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
        loading: false,
        notice: false,
        pickerPath: '',
        saving: false,
        selectedPath: '',
        status: '',
        uploadFileName: ''
      });
    }
    this.operations.invalidateAll();
    this.lifecycle.disconnect();
    this.syncBusyState();
    this.removeEventListeners();
    this.clearSelectedUpload();
    if (this.uploadFocusFrame !== null) {
      window.cancelAnimationFrame(this.uploadFocusFrame);
      this.uploadFocusFrame = null;
    }
    this.linked = false;
  }

  refreshAfterRestart() {
    const scope = this.lifecycle.current;
    return scope ? this.refreshFilesPreservingEditor(scope) : Promise.resolve();
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
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    this.bindEventListeners();
    scope.own(() => this.removeEventListeners());
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
    }

    await this.loadFiles(undefined, scope);
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
    this.dataset.state = this.state.error ? 'error' : this.state.loading ? 'loading' : this.state.dirty ? 'dirty' : 'ready';
    this.syncUnloadGuard();
  }

  private refreshFileViews(files: NodelFileEntry[] = this.state.files) {
    const next = sortFiles(files).map((file) => toFileView(file, this.state.selectedPath, this.state.dirty ? this.state.selectedPath : ''));
    getJQuery().observable(this.state.files).refresh(next);
  }

  private updateAvailability() {
    const busy = this.state.loading || this.state.saving || this.state.deleting;
    this.setState({
      canDelete: Boolean(this.state.selectedPath && portableNodeFilePathKey(this.state.selectedPath) !== 'script.py' && !busy),
      canSave: Boolean(this.state.selectedPath && this.state.dirty && !this.state.binary && !busy)
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
    const key = canonicalNodeFilePath(path);
    return this.state.files.find((file) => canonicalNodeFilePath(file.path) === key);
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
      const files = sortFiles((await listNodeFiles({ signal: ticket.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
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
      if (error instanceof DOMException && error.name === 'AbortError') {
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
      const files = sortFiles((await listNodeFiles({ signal: ticket.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
      if (!this.operationIsCurrent(ticket, scope)) {
        return false;
      }
      this.refreshFileViews(files);
      const selectedMissing = Boolean(this.state.selectedPath)
        && !files.some((file) => canonicalNodeFilePath(file.path) === canonicalNodeFilePath(this.state.selectedPath));
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
      if (error instanceof DOMException && error.name === 'AbortError') {
        return false;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to refresh files' });
      return false;
    } finally {
      this.finishOperation(ticket);
    }
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
      ?? this.state.files.find((file) => portableNodeFilePathKey(file.path) === 'script.py')?.path
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

    if (portableNodeFilePathKey(resolvedPath) === 'script.py' && resolvedPath !== 'script.py') {
      applyReadOnlyDocument(
        `${resolvedPath} is a case-only script.py alias and cannot be edited safely across supported hosts.`,
        'Case-only script.py aliases are read-only in the browser editor.'
      );
      this.finishOperation(ticket);
      return;
    }

    if (isBinaryFile(resolvedPath)) {
      applyReadOnlyDocument('Binary file preview is not available.', binaryPlaceholder);
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
      const content = await getNodeFileContents(resolvedPath, { signal: ticket.signal }, MAX_NODE_TEXT_EDIT_BYTES);
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
      this.editor?.setReadOnly(false);
      this.setSelectedState(resolvedPath, content, false, false, '', file?.modified, file?.size);
      this.editor?.focus();
    } catch (error) {
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
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
    if (this.suppressEditorChange || this.state.binary) {
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
      const nextPath = target.selectedOptions.item(0)?.getAttribute('value') ?? this.state.pickerPath;
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

  async saveSelectedFile() {
    const scope = this.lifecycle.current;
    if (!scope
      || !this.state.selectedPath
      || this.state.binary
      || !this.state.dirty
      || this.state.deleting
      || this.operations.isActive('list')
      || this.operations.isActive('open')
      || this.operations.isActive('save')
      || this.operations.isActive('create')) {
      return;
    }

    const path = this.state.selectedPath;
    const content = this.editor?.getDocument() ?? '';
    if (new TextEncoder().encode(content).byteLength > MAX_NODE_TEXT_EDIT_BYTES) {
      this.reportError(`${path} exceeds the ${formatFileSize(MAX_NODE_TEXT_EDIT_BYTES)} text-upload limit.`);
      return;
    }
    const revision = this.documentRevision;
    const originalContent = this.originalContent;
    const openedModified = this.openedModified;
    const openedSize = this.openedSize;
    const metadataBaselineValid = this.metadataBaselineValid;
    const ticket = this.beginOperation('save', scope);
    this.setState({ error: '', notice: false, status: `Checking ${path} for remote changes...` });
    try {
      const files = await listNodeFiles({ signal: ticket.signal });
      if (!this.operationIsCurrent(ticket, scope)) {
        return;
      }
      let remoteFile = files.find((file) => canonicalNodeFilePath(file.path) === canonicalNodeFilePath(path));
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
        remoteFile = refreshedFiles.find((file) => canonicalNodeFilePath(file.path) === canonicalNodeFilePath(path));
        if (remoteFile) {
          throw new Error(`${path} was recreated on the node while confirmation was pending. Refresh before saving.`);
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
      await saveNodeFile(path, content, { signal: ticket.signal });
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
    const requestedCanonicalPath = canonicalNodeFilePath(path);
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
      const exactExisting = files.find((file) => canonicalNodeFilePath(file.path) === requestedCanonicalPath);
      const portableMatches = files.filter((file) => portableNodeFilePathKey(file.path) === requestedPortableKey);
      if (!exactExisting && portableMatches.length > 1) {
        throw new Error(`${path} is ambiguous because multiple case variants already exist on the node.`);
      }
      const existing = exactExisting ?? portableMatches[0];
      const targetPath = existing?.path ?? path;
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
      const refreshedExact = refreshedFiles.find((file) => canonicalNodeFilePath(file.path) === canonicalNodeFilePath(targetPath));
      const refreshedPortable = refreshedFiles.filter((file) => portableNodeFilePathKey(file.path) === requestedPortableKey);
      if (!existing && refreshedPortable.length > 0) {
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
      this.setState({ status: `${existing ? 'Overwriting' : 'Creating'} ${targetPath}...` });
      await saveNodeFile(targetPath, content, { signal: ticket.signal });
      if (!requestIsCurrent()) {
        return;
      }
      let overwriteNotice = '';
      if (this.state.selectedPath && canonicalNodeFilePath(this.state.selectedPath) === canonicalNodeFilePath(targetPath) && typeof content === 'string') {
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
      const refreshed = await this.refreshFilesPreservingEditor(scope, true);
      if (this.operationIsCurrent(ticket, scope)
        && this.state.selectedPath
        && canonicalNodeFilePath(this.state.selectedPath) === canonicalNodeFilePath(targetPath)) {
        if (refreshed) {
          const refreshedFile = this.fileForPath(this.state.selectedPath);
          this.openedModified = refreshedFile?.modified;
          this.openedSize = refreshedFile?.size;
          this.metadataBaselineValid = true;
        } else {
          this.metadataBaselineValid = false;
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
    if (!path || path === 'script.py') {
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
      const remoteFile = files.find((file) => canonicalNodeFilePath(file.path) === canonicalNodeFilePath(path));
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
      this.setState({ error: message, loading: false });
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, message);
    }
  }
}

if (!customElements.get('nodel-editor')) {
  customElements.define('nodel-editor', NodelEditor);
}
