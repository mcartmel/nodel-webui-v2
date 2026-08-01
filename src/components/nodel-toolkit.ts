import { getToolkit } from '../api/nodel-host-client';
import type { NodelToolkitResponse } from '../api/nodel-types';
import { registerNodelOneShotSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import type { NodelCodeEditor } from '../editor/codemirror-editor';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { loadCodeEditorModule } from '../utils/dynamic-imports';

export class NodelToolkit extends HTMLElement {
  private editor: NodelCodeEditor | null = null;
  private editorHost: HTMLElement | null = null;
  private editorError = '';
  private source: NodelSourceSubscription<NodelToolkitResponse> | null = null;
  private statusNode: HTMLElement | null = null;
  private lastRenderedScript = '';
  private lastRenderedError = '';
  private lifecycle = new ComponentLifecycle();
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

    const scope = this.lifecycle.connect();
    if (!scope) {
      return;
    }
    this.renderShell();
    void scope.run(() => this.initializeEditor(scope), (error) => this.renderEditorError(error));
    this.bindSource(scope);
  }

  disconnectedCallback() {
    this.lifecycle.disconnect();
    this.editor?.destroy();
    this.editor = null;
    this.editorHost = null;
    this.editorError = '';
    this.statusNode = null;
    this.lastRenderedScript = '';
    this.lastRenderedError = '';
  }

  private bindSource(scope: ConnectionScope) {
    const source = registerNodelOneShotSource<NodelToolkitResponse>({
      key: this.sourceKey,
      fetcher: (signal) => getToolkit({ signal }),
      visibleOnly: true
    });

    const subscription = source.subscribe(this, scope.guard((state) => {
      this.state = state;
      this.renderState();
    }));
    this.source = subscription;
    scope.own(() => {
      subscription.dispose();
      if (this.source === subscription) {
        this.source = null;
      }
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

  private async initializeEditor(scope: ConnectionScope) {
    if (!this.editorHost || this.editor) {
      return;
    }

    const host = this.editorHost;
    const { createNodelCodeEditor } = await loadCodeEditorModule();
    if (!scope.isCurrent() || this.editorHost !== host || this.editor) {
      return;
    }

    this.editor = createNodelCodeEditor({
      parent: host,
      ariaLabel: 'Toolkit source',
      path: 'nodetoolkit.py',
      readOnly: true,
      onError: scope.guard((error) => this.renderEditorError(error))
    });
    this.editorError = '';
    this.lastRenderedScript = '';
    this.lastRenderedError = '';
    this.renderState();
  }

  private renderEditorError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load toolkit editor';
    this.editorError = message;
    this.renderState();
  }

  private renderState() {
    const script = typeof this.state.data?.script === 'string' ? this.state.data.script : '';
    const loaded = Boolean(script);
    const error = this.editorError || this.state.error;
    this.dataset.state = error ? 'error' : this.state.loading ? 'loading' : loaded ? 'ready' : 'empty';

    if (this.statusNode) {
      if (error) {
        this.statusNode.hidden = false;
        this.statusNode.className = 'nodel-alert nodel-alert-danger nodel-alert-md';
        this.statusNode.textContent = error;
      } else if (this.state.loading || !loaded) {
        this.statusNode.hidden = false;
        this.statusNode.className = 'nodel-alert nodel-alert-md';
        this.statusNode.textContent = this.state.loading ? 'Loading toolkit...' : 'Toolkit reference unavailable.';
      } else {
        this.statusNode.hidden = true;
      }
    }

    if (this.editor && error && error !== this.lastRenderedError) {
      this.editor.setDocument(`# ${error}`, 'nodetoolkit.py');
      this.lastRenderedError = error;
      this.lastRenderedScript = '';
    } else if (this.editor && !error && loaded && script !== this.lastRenderedScript) {
      this.editor.setDocument(script, 'nodetoolkit.py');
      this.lastRenderedScript = script;
      this.lastRenderedError = '';
    }
  }
}

if (!customElements.get('nodel-toolkit')) {
  customElements.define('nodel-toolkit', NodelToolkit);
}
