import { getToolkit } from '../api/nodel-host-client';
import type { NodelToolkitResponse } from '../api/nodel-types';
import { registerNodelOneShotSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import type { NodelCodeEditor } from '../editor/codemirror-editor';

export class NodelToolkit extends HTMLElement {
  private editor: NodelCodeEditor | null = null;
  private editorHost: HTMLElement | null = null;
  private source: NodelSourceSubscription<NodelToolkitResponse> | null = null;
  private statusNode: HTMLElement | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';
  private state: NodelSourceState<NodelToolkitResponse> = {
    loading: true,
    data: null,
    error: '',
    active: false,
    updatedAt: null
  };

  connectedCallback() {
    if (!this.sourceKey) {
      NodelToolkit.nextSourceId += 1;
      this.sourceKey = `nodel-toolkit-${NodelToolkit.nextSourceId}`;
    }

    this.renderShell();
    void this.initializeEditor();
    this.bindSource();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    this.editor?.destroy();
    this.editor = null;
    this.editorHost = null;
    this.statusNode = null;
  }

  private bindSource() {
    this.source?.dispose();
    const source = registerNodelOneShotSource<NodelToolkitResponse>({
      key: this.sourceKey,
      fetcher: (signal) => getToolkit({ signal }),
      visibleOnly: true
    });

    this.source = source.subscribe(this, (state) => {
      this.state = state;
      this.renderState();
    });
  }

  private renderShell() {
    this.innerHTML = `
      <div class="nodel-toolkit space-y-3">
        <div data-toolkit-status class="nodel-alert nodel-alert-md" role="status">Loading toolkit...</div>
        <div data-toolkit-editor class="nodel-toolkit-editor nodel-editor-host"></div>
      </div>
    `;
    this.statusNode = this.querySelector('[data-toolkit-status]');
    this.editorHost = this.querySelector('[data-toolkit-editor]');
    this.renderState();
  }

  private async initializeEditor() {
    if (!this.editorHost || this.editor) {
      return;
    }

    const { createNodelCodeEditor } = await import('../editor/codemirror-editor');
    if (!this.isConnected || !this.editorHost) {
      return;
    }

    this.editor = createNodelCodeEditor({
      parent: this.editorHost,
      path: 'nodetoolkit.py',
      readOnly: true
    });
    this.renderState();
  }

  private renderState() {
    const script = typeof this.state.data?.script === 'string' ? this.state.data.script : '';
    const loaded = Boolean(script);
    this.dataset.state = this.state.error ? 'error' : this.state.loading ? 'loading' : loaded ? 'ready' : 'empty';

    if (this.statusNode) {
      if (this.state.error) {
        this.statusNode.hidden = false;
        this.statusNode.className = 'nodel-alert nodel-alert-danger nodel-alert-md';
        this.statusNode.textContent = this.state.error;
      } else if (this.state.loading || !loaded) {
        this.statusNode.hidden = false;
        this.statusNode.className = 'nodel-alert nodel-alert-md';
        this.statusNode.textContent = this.state.loading ? 'Loading toolkit...' : 'Toolkit reference unavailable.';
      } else {
        this.statusNode.hidden = true;
      }
    }

    if (this.editor && loaded) {
      this.editor.setDocument(script, 'nodetoolkit.py');
    } else if (this.editor && this.state.error) {
      this.editor.setDocument(`# ${this.state.error}`, 'nodetoolkit.py');
    }
  }
}

if (!customElements.get('nodel-toolkit')) {
  customElements.define('nodel-toolkit', NodelToolkit);
}
