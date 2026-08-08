export interface EditorDocumentMetadata {
  modified?: string | undefined;
  size?: number | undefined;
}

export interface EditorDocumentCapabilities {
  binary: boolean;
  legacy: boolean;
  missing: boolean;
  canWrite: boolean;
}

export interface EditorDocumentState {
  path: string;
  content: string;
  cleanContent: string;
  metadata: EditorDocumentMetadata;
  metadataBaselineValid: boolean;
  revision: number;
  dirty: boolean;
  capabilities: EditorDocumentCapabilities;
}

export type EditorDocumentSnapshot = EditorDocumentState;

export interface SaveCompletion {
  path: string;
  content: string;
  revision: number;
  currentContent: string;
}

export type RestartReconciliation = 'verified' | 'dirty-preserved' | 'conflict';

export interface RestartReconciliationInput {
  path: string;
  revision: number;
  cleanContent: string;
  contentAtStart: string;
  dirtyAtStart: boolean;
  remoteContent: string;
  remoteMetadata?: EditorDocumentMetadata;
}

const emptyCapabilities: EditorDocumentCapabilities = {
  binary: false,
  legacy: false,
  missing: false,
  canWrite: false
};

export class EditorDocumentSession {
  private value: EditorDocumentState = {
    path: '', content: '', cleanContent: '', metadata: {}, metadataBaselineValid: false,
    revision: 0, dirty: false, capabilities: emptyCapabilities
  };

  get state(): Readonly<EditorDocumentState> { return this.value; }

  snapshot(): EditorDocumentSnapshot {
    return {
      ...this.value,
      metadata: { ...this.value.metadata },
      capabilities: { ...this.value.capabilities }
    };
  }

  open(path: string, content: string, metadata: EditorDocumentMetadata = {}, capabilities: Partial<EditorDocumentCapabilities> = {}) {
    const binary = capabilities.binary ?? false;
    const legacy = capabilities.legacy ?? false;
    this.value = {
      path, content, cleanContent: content, metadata: { ...metadata }, metadataBaselineValid: Boolean(path),
      revision: this.value.revision + 1, dirty: false,
      capabilities: {
        binary, legacy, missing: capabilities.missing ?? false,
        canWrite: capabilities.canWrite ?? (Boolean(path) && !binary && !legacy)
      }
    };
    return this.state;
  }

  clear() { return this.open('', '', {}, emptyCapabilities); }

  edit(content: string) {
    this.value = { ...this.value, content, revision: this.value.revision + 1, dirty: content !== this.value.cleanContent };
    return this.state;
  }

  // The DOM editor may normalize content while being installed. It is not an edit.
  projectContent(content: string) {
    this.value = { ...this.value, content, dirty: content !== this.value.cleanContent };
    return this.state;
  }

  revert() {
    this.value = { ...this.value, content: this.value.cleanContent, revision: this.value.revision + 1, dirty: false };
    return this.state;
  }

  updateMetadata(metadata: EditorDocumentMetadata) {
    this.value = { ...this.value, metadata: { ...metadata }, metadataBaselineValid: Boolean(this.value.path) };
    return this.state;
  }

  invalidateMetadata() {
    this.value = { ...this.value, metadata: {}, metadataBaselineValid: false };
    return this.state;
  }

  selectMissing(path = this.value.path) {
    const capabilities = { ...this.value.capabilities, missing: true };
    capabilities.canWrite = Boolean(path) && !capabilities.binary && !capabilities.legacy;
    this.value = {
      ...this.value, path, metadata: {}, metadataBaselineValid: false,
      revision: this.value.revision + 1, dirty: true, capabilities
    };
    return this.state;
  }

  completeSave(save: SaveCompletion, metadata?: EditorDocumentMetadata) {
    if (save.path !== this.value.path) return { ...this.state, newerEdits: false };
    const newerEdits = this.value.revision !== save.revision || save.currentContent !== save.content;
    this.value = {
      ...this.value,
      cleanContent: save.content,
      metadata: metadata === undefined ? {} : { ...metadata },
      metadataBaselineValid: metadata !== undefined,
      dirty: newerEdits,
      capabilities: { ...this.value.capabilities, missing: false }
    };
    return { ...this.state, newerEdits };
  }

  reconcileRestart(input: RestartReconciliationInput): RestartReconciliation {
    const unchanged = this.value.path === input.path
      && this.value.revision === input.revision
      && !input.dirtyAtStart
      && !this.value.dirty
      && this.value.content === input.contentAtStart
      && input.contentAtStart === input.cleanContent;
    if (unchanged) {
      this.open(input.path, input.remoteContent, input.remoteMetadata, this.value.capabilities);
      return 'verified';
    }
    if (input.remoteContent === input.cleanContent) {
      if (input.remoteMetadata) this.updateMetadata(input.remoteMetadata);
      return 'dirty-preserved';
    }
    // Keep the local buffer but make the unresolved remote divergence explicit.
    this.value = { ...this.value, metadata: {}, metadataBaselineValid: false, dirty: true };
    return 'conflict';
  }
}
