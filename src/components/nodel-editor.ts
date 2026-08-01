import type { NodelFileEntry } from '../api/nodel-types';
import { deleteNodeFile, getNodeFileContents, listNodeFiles, saveNodeFile } from '../api/nodel-host-client';
import type { NodelCodeEditor } from '../editor/codemirror-editor';
import { isBinaryFile, isEditableFile, validateNodeFilePath } from '../editor/file-types';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { loadCodeEditorModule } from '../utils/dynamic-imports';
import { renderComponentError } from '../utils/render-component-error';
import { resetFileInput } from '../utils/file-input';

interface EditorFileView extends NodelFileEntry {
  active: boolean;
  binary: boolean;
  dirty: boolean;
  kindLabel: string;
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
            <option value="{{>path}}" data-link="selected{:active}">{^{>path}}{^{if dirty}} *{{/if}}</option>
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
      <div role="status" aria-live="polite" aria-atomic="true" class="nodel-editor-status" data-link="class{:error ? 'nodel-editor-status is-error' : 'nodel-editor-status'} hidden{:!error && !loading && !saving && !deleting}">
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
  };
}

export class NodelEditor extends HTMLElement {
  static get observedAttributes() {
    return ['default-file'];
  }

  private abortController: AbortController | null = null;
  private editor: NodelCodeEditor | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private linked = false;
  private originalContent = '';
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
      this.setState({
        addFilePath: '',
        adding: false,
        binary: false,
        canDelete: false,
        canSave: false,
        deleting: false,
        dirty: false,
        loading: false,
        pickerPath: '',
        saving: false,
        selectedPath: '',
        status: '',
        uploadFileName: ''
      });
    }
    this.lifecycle.disconnect();
    this.abortController?.abort();
    this.abortController = null;
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
  }

  private refreshFileViews(files: NodelFileEntry[] = this.state.files) {
    const next = sortFiles(files).map((file) => toFileView(file, this.state.selectedPath, this.state.dirty ? this.state.selectedPath : ''));
    getJQuery().observable(this.state.files).refresh(next);
  }

  private updateAvailability() {
    const busy = this.state.loading || this.state.saving || this.state.deleting;
    this.setState({
      canDelete: Boolean(this.state.selectedPath && this.state.selectedPath !== 'script.py' && !busy),
      canSave: Boolean(this.state.selectedPath && this.state.dirty && !this.state.binary && !busy)
    });
  }

  private async loadFiles(preferredPath?: string, scope = this.lifecycle.current) {
    if (!scope) {
      return;
    }
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.setState({ error: '', loading: true, status: 'Loading files...' });
    this.updateAvailability();

    try {
      const files = sortFiles((await listNodeFiles({ signal: controller.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      this.refreshFileViews(files);
      const nextPath = preferredPath ?? this.defaultFilePath(files);
      if (nextPath) {
        await this.openFile(nextPath, { skipDirtyPrompt: true }, scope);
      } else {
        this.editor?.setDocument('', '');
        this.editor?.setReadOnly(true);
        this.setState({ loading: false, status: files.length ? 'Files loaded.' : 'No editable node files found.' });
        this.setSelectedState('', '', false, false, '');
      }
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to load files', loading: false });
    } finally {
      scope.signal.removeEventListener('abort', abort);
      if (this.abortController === controller) {
        this.abortController = null;
      }
      if (scope.isCurrent()) {
        this.updateAvailability();
      }
    }
  }

  private async refreshFilesPreservingEditor(scope: ConnectionScope) {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.setState({ error: '', loading: true, status: 'Refreshing files...' });
    this.updateAvailability();

    try {
      const files = sortFiles((await listNodeFiles({ signal: controller.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      this.refreshFileViews(files);
      this.setState({
        loading: false,
        pickerPath: this.state.selectedPath,
        status: files.length ? 'Files refreshed.' : 'No editable node files found.'
      });
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to refresh files', loading: false });
    } finally {
      scope.signal.removeEventListener('abort', abort);
      if (this.abortController === controller) {
        this.abortController = null;
      }
      if (scope.isCurrent()) {
        this.updateAvailability();
      }
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

  private setSelectedState(path: string, content: string, binary: boolean, dirty: boolean, status: string) {
    this.originalContent = content;
    this.setState({
      binary,
      dirty,
      error: '',
      selectedPath: path,
      pickerPath: path,
      status
    });
    this.refreshFileViews();
    this.updateAvailability();
  }

  private async openFile(path: string, options: { skipDirtyPrompt?: boolean } = {}, scope = this.lifecycle.current) {
    if (!scope) {
      return;
    }
    if (!options.skipDirtyPrompt && !this.confirmDiscardChanges()) {
      this.setState({ pickerPath: this.state.selectedPath });
      return;
    }

    if (isBinaryFile(path)) {
      this.editor?.setDocument(binaryPlaceholder, path);
      this.editor?.setReadOnly(true);
      this.setSelectedState(path, '', true, false, 'Binary file preview is not available.');
      return;
    }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.setState({ error: '', loading: true, status: `Loading ${path}...` });
    this.updateAvailability();

    try {
      const content = await getNodeFileContents(path, { signal: controller.signal });
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      this.editor?.setDocument(content, path);
      this.editor?.setReadOnly(false);
      this.setSelectedState(path, content, false, false, '');
      this.editor?.focus();
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to load ${path}` });
    } finally {
      scope.signal.removeEventListener('abort', abort);
      const ownsRequest = this.abortController === controller;
      if (ownsRequest) {
        this.abortController = null;
      }
      if (scope.isCurrent() && ownsRequest) {
        this.setState({ loading: false });
        this.updateAvailability();
      }
    }
  }

  private confirmDiscardChanges() {
    return !this.state.dirty || window.confirm('Discard unsaved changes?');
  }

  private handleEditorChange = (content: string) => {
    if (this.state.binary) {
      return;
    }
    const dirty = content !== this.originalContent;
    if (dirty !== this.state.dirty) {
      this.setState({ dirty, status: dirty ? 'Unsaved changes.' : 'No unsaved changes.' });
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
      if (this.confirmDiscardChanges()) {
        void this.loadFiles(this.state.selectedPath);
      }
      return;
    }

    if (target.closest('[data-editor-toggle-add]')) {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: !this.state.adding, error: '', uploadFileName: '' });
      return;
    }

    if (target.closest('[data-editor-default]')) {
      void this.openFile('script.py');
      return;
    }

    if (target.closest('[data-editor-save]')) {
      void this.saveSelectedFile();
      return;
    }

    if (target.closest('[data-editor-delete]')) {
      void this.deleteSelectedFile();
      return;
    }

    if (target.closest('[data-editor-cancel-add]')) {
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: false, uploadFileName: '' });
      return;
    }

    if (target.closest('[data-editor-create-empty]')) {
      event.preventDefault();
      void this.createFileFromState();
      return;
    }

  };

  private handleSubmit = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.matches('[data-editor-add-form]')) {
      event.preventDefault();
      void this.createFileFromState();
    }
  };

  private handleChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.matches('[data-editor-file-picker]')) {
      const nextPath = target.selectedOptions.item(0)?.getAttribute('value') ?? this.state.pickerPath;
      this.setState({ pickerPath: nextPath });
      if (nextPath && nextPath !== this.state.selectedPath) {
        void this.openFile(nextPath);
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
  }

  private reportError(message: string) {
    this.setState({ error: message });
    this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message } }));
  }

  async saveSelectedFile() {
    const scope = this.lifecycle.current;
    if (!scope || !this.state.selectedPath || this.state.binary || !this.state.dirty || this.state.saving) {
      return;
    }

    const path = this.state.selectedPath;
    this.setState({ error: '', saving: true, status: `Saving ${path}...` });
    this.updateAvailability();
    try {
      const content = this.editor?.getDocument() ?? '';
      await saveNodeFile(path, content, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.originalContent = content;
      this.setState({ dirty: false, saving: false, status: `Saved ${path}.` });
      this.refreshFileViews();
      this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path } }));
      await this.loadFiles(path, scope);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to save ${path}`, saving: false });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      if (scope.isCurrent()) {
        this.updateAvailability();
      }
    }
  }

  private async createFileFromState() {
    const scope = this.lifecycle.current;
    if (!scope || this.state.saving) {
      return;
    }
    const path = this.state.addFilePath.trim();
    const validation = validateNodeFilePath(path);
    if (validation) {
      this.setState({ error: validation });
      return;
    }

    if (isBinaryFile(path) && !this.selectedUpload) {
      this.setState({ error: 'Binary files must be uploaded from a local file.' });
      return;
    }

    if (!this.confirmDiscardChanges()) {
      return;
    }

    this.setState({ error: '', saving: true, status: `Creating ${path}...` });
    this.updateAvailability();
    try {
      const content = await this.uploadContentForPath(path);
      if (!scope.isCurrent()) {
        return;
      }
      await saveNodeFile(path, content, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.clearSelectedUpload();
      this.setState({ addFilePath: '', adding: false, saving: false, uploadFileName: '', status: `Created ${path}.` });
      this.dispatchEvent(new CustomEvent('nodel-editor-file-created', { bubbles: true, detail: { path } }));
      await this.loadFiles(path, scope);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to create ${path}`, saving: false });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      if (scope.isCurrent()) {
        this.updateAvailability();
      }
    }
  }

  private async uploadContentForPath(path: string): Promise<BodyInit> {
    if (!this.selectedUpload) {
      return '';
    }

    if (path === 'script.py' || isEditableFile(path)) {
      return this.selectedUpload.text();
    }

    return this.selectedUpload;
  }

  private async deleteSelectedFile() {
    const scope = this.lifecycle.current;
    if (!scope || this.state.deleting) {
      return;
    }
    const path = this.state.selectedPath;
    if (!path || path === 'script.py') {
      return;
    }

    if (!window.confirm(`Delete ${path}?`)) {
      return;
    }

    this.setState({ deleting: true, error: '', status: `Deleting ${path}...` });
    this.updateAvailability();
    try {
      await deleteNodeFile(path, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.editor?.setDocument('', '');
      this.editor?.setReadOnly(true);
      this.setSelectedState('', '', false, false, `Deleted ${path}.`);
      this.dispatchEvent(new CustomEvent('nodel-editor-file-deleted', { bubbles: true, detail: { path } }));
      await this.loadFiles(undefined, scope);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to delete ${path}` });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      if (scope.isCurrent()) {
        this.setState({ deleting: false });
        this.updateAvailability();
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
