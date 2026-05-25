import type { NodelFileEntry } from '../api/nodel-types';
import { deleteNodeFile, getNodeFileContents, listNodeFiles, saveNodeFile } from '../api/nodel-host-client';
import type { NodelCodeEditor } from '../editor/codemirror-editor';
import { isBinaryFile, isEditableFile, validateNodeFilePath } from '../editor/file-types';
import { getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';

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
          <button data-editor-create-empty type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:loading || saving || deleting}">Create</button>
          <button data-editor-cancel-add type="button" class="nodel-button" data-link="disabled{:loading || saving || deleting}">Cancel</button>
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
  private linked = false;
  private originalContent = '';
  private selectedUpload: File | null = null;
  private state: EditorViewModel = {
    addFilePath: '',
    adding: false,
    binary: false,
    canDelete: false,
    canSave: false,
    deleting: false,
    dirty: false,
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
    void this.initialize();
  }

  disconnectedCallback() {
    this.abortController?.abort();
    this.abortController = null;
    this.removeEventListeners();
    this.editor?.destroy();
    this.editor = null;
    void unlinkTemplate(this);
    this.linked = false;
  }

  refreshAfterRestart() {
    return this.refreshFilesPreservingEditor();
  }

  attributeChangedCallback() {
    if (this.linked && !this.state.selectedPath) {
      void this.loadFiles();
    }
  }

  private async initialize() {
    if (!this.linked) {
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.bindEventListeners();
      const host = this.querySelector<HTMLElement>('[data-editor-host]');
      if (host) {
        const { createNodelCodeEditor } = await import('../editor/codemirror-editor');
        this.editor = createNodelCodeEditor({
          parent: host,
          readOnly: true,
          onChange: this.handleEditorChange,
          onSave: () => {
            void this.saveSelectedFile();
          }
        });
      }
    }

    await this.loadFiles();
  }

  private bindEventListeners() {
    this.addEventListener('click', this.handleClick);
    this.addEventListener('submit', this.handleSubmit);
    this.addEventListener('change', this.handleChange);
  }

  private removeEventListeners() {
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('change', this.handleChange);
  }

  private setState(values: Partial<EditorViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
    this.dataset.state = values.error ? 'error' : this.state.loading ? 'loading' : this.state.dirty ? 'dirty' : 'ready';
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

  private async loadFiles(preferredPath?: string) {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.setState({ error: '', loading: true, status: 'Loading files...' });
    this.updateAvailability();

    try {
      const files = sortFiles((await listNodeFiles({ signal: this.abortController.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
      this.refreshFileViews(files);
      this.setState({ loading: false, status: files.length ? 'Files loaded.' : 'No editable node files found.' });
      const nextPath = preferredPath ?? this.defaultFilePath(files);
      if (nextPath) {
        await this.openFile(nextPath, { skipDirtyPrompt: true });
      } else {
        this.editor?.setDocument('', '');
        this.editor?.setReadOnly(true);
        this.setSelectedState('', '', false, false, '');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to load files', loading: false });
    } finally {
      this.updateAvailability();
    }
  }

  private async refreshFilesPreservingEditor() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.setState({ error: '', loading: true, status: 'Refreshing files...' });
    this.updateAvailability();

    try {
      const files = sortFiles((await listNodeFiles({ signal: this.abortController.signal })).filter((file) => isEditableFile(file.path) || isBinaryFile(file.path)));
      this.refreshFileViews(files);
      this.setState({
        loading: false,
        pickerPath: this.state.selectedPath,
        status: files.length ? 'Files refreshed.' : 'No editable node files found.'
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : 'Failed to refresh files', loading: false });
    } finally {
      this.updateAvailability();
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

  private async openFile(path: string, options: { skipDirtyPrompt?: boolean } = {}) {
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
    this.abortController = new AbortController();
    this.setState({ error: '', loading: true, status: `Loading ${path}...` });
    this.updateAvailability();

    try {
      const content = await getNodeFileContents(path, { signal: this.abortController.signal });
      this.editor?.setDocument(content, path);
      this.editor?.setReadOnly(false);
      this.setSelectedState(path, content, false, false, '');
      this.editor?.focus();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({ error: error instanceof Error ? error.message : `Failed to load ${path}` });
    } finally {
      this.setState({ loading: false });
      this.updateAvailability();
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
      this.setState({ adding: !this.state.adding, error: '' });
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
      this.selectedUpload = null;
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

    this.selectedUpload = input.files[0];
    const nextPath = this.state.addFilePath || this.selectedUpload.name;
    this.setState({ addFilePath: nextPath, adding: true, uploadFileName: this.selectedUpload.name });
    void this.createFileFromState();
  };

  async saveSelectedFile() {
    if (!this.state.selectedPath || this.state.binary || !this.state.dirty) {
      return;
    }

    this.setState({ error: '', saving: true, status: `Saving ${this.state.selectedPath}...` });
    this.updateAvailability();
    try {
      const content = this.editor?.getDocument() ?? '';
      await saveNodeFile(this.state.selectedPath, content);
      this.originalContent = content;
      this.setState({ dirty: false, saving: false, status: `Saved ${this.state.selectedPath}.` });
      this.refreshFileViews();
      this.dispatchEvent(new CustomEvent('nodel-editor-file-saved', { bubbles: true, detail: { path: this.state.selectedPath } }));
      await this.loadFiles(this.state.selectedPath);
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : `Failed to save ${this.state.selectedPath}`, saving: false });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.updateAvailability();
    }
  }

  private async createFileFromState() {
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

    this.setState({ error: '', saving: true, status: `Creating ${path}...` });
    this.updateAvailability();
    try {
      const content = await this.uploadContentForPath(path);
      await saveNodeFile(path, content);
      this.selectedUpload = null;
      this.setState({ addFilePath: '', adding: false, saving: false, uploadFileName: '', status: `Created ${path}.` });
      this.dispatchEvent(new CustomEvent('nodel-editor-file-created', { bubbles: true, detail: { path } }));
      await this.loadFiles(path);
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : `Failed to create ${path}`, saving: false });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.updateAvailability();
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
      await deleteNodeFile(path);
      this.editor?.setDocument('', '');
      this.editor?.setReadOnly(true);
      this.setSelectedState('', '', false, false, `Deleted ${path}.`);
      this.dispatchEvent(new CustomEvent('nodel-editor-file-deleted', { bubbles: true, detail: { path } }));
      await this.loadFiles();
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : `Failed to delete ${path}` });
      this.dispatchEvent(new CustomEvent('nodel-editor-error', { bubbles: true, detail: { message: this.state.error } }));
    } finally {
      this.setState({ deleting: false });
      this.updateAvailability();
    }
  }
}

if (!customElements.get('nodel-editor')) {
  customElements.define('nodel-editor', NodelEditor);
}
