import type { NodelFileEntry } from '../api/nodel-types';
import { NodeFileTooLargeError, MAX_NODE_TEXT_EDIT_BYTES } from '../utils/node-file-limits';
import { isPortableNodeFilePath, nodeFileAliasKey, portableNodeFilePathKey } from '../utils/node-file-path';
import { isBinaryFile, isEditableFile, validateNodeFilePath } from './file-types';
import type { EditorDocumentSnapshot } from './editor-document-session';

export interface EditorFileApi {
  list(signal?: AbortSignal): Promise<NodelFileEntry[]>;
  read(path: string | NodelFileEntry, signal?: AbortSignal, maxBytes?: number): Promise<string>;
  save(path: string, content: BodyInit, signal?: AbortSignal): Promise<unknown>;
  delete(path: string, signal?: AbortSignal): Promise<unknown>;
}

export interface OperationContext { signal?: AbortSignal; isCurrent(): boolean; }
export interface EditorConfirm { (request: { title: string; text: string; confirmLabel: string; cancelLabel: string; tone: 'warning' | 'danger' }): Promise<boolean>; }

export function sortedEditorFiles(files: NodelFileEntry[], include: (file: NodelFileEntry) => boolean = () => true) {
  return files.filter(include).sort((a, b) => a.path.localeCompare(b.path));
}
export function defaultEditorFile(files: NodelFileEntry[], configured = 'script.py') {
  return files.find((file) => file.path === configured)?.path ?? files.find((file) => file.path === 'script.py')?.path
    ?? files.find((file) => isEditableFile(file.path))?.path ?? files[0]?.path ?? '';
}

export type OpenResult =
  | { kind: 'editable'; path: string; content: string; file?: NodelFileEntry | undefined }
  | { kind: 'readonly'; path: string; content: string; message: string; file?: NodelFileEntry | undefined; binary: boolean; legacy: boolean }
  | { kind: 'stale' };
export type WorkflowResult = { kind: 'saved' | 'deleted'; path: string } | { kind: 'cancelled' | 'stale' };
export interface CreateWorkflowResult { kind: 'created' | 'overwritten'; path: string; content: BodyInit; }

const binaryPlaceholder = 'Binary file - preview not available.';
const tooLargeMessage = (path: string) => `${path} is too large to edit (limit 1 MiB); download or manage it externally.`;
const changedMessage = (path: string, action: 'saving' | 'deleting') => `${path} changed on the node after it was opened. Refresh before ${action}.`;

export class EditorFileOperations {
  constructor(private readonly api: EditorFileApi, private readonly include: (file: NodelFileEntry) => boolean) {}

  async list(context: OperationContext) {
    const files = sortedEditorFiles(await this.api.list(context.signal), this.include);
    return context.isCurrent() ? files : null;
  }

  async read(path: string | NodelFileEntry, context: OperationContext) {
    const content = await this.api.read(path, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
    return context.isCurrent() ? content : null;
  }

  async open(path: string, files: readonly NodelFileEntry[], context: OperationContext): Promise<OpenResult> {
    const file = files.find((candidate) => candidate.path === path);
    const resolvedPath = file?.path ?? path;
    const legacy = file?.compatibility === 'legacy';
    if (!file && !isPortableNodeFilePath(resolvedPath)) throw new Error('Legacy file paths can only be opened from the current file list.');
    if (isPortableNodeFilePath(resolvedPath) && portableNodeFilePathKey(resolvedPath) === 'script.py' && resolvedPath !== 'script.py') {
      return { kind: 'readonly', path: resolvedPath, content: 'Case-only script.py aliases are read-only in the browser editor.', message: `${resolvedPath} is a case-only script.py alias and cannot be edited safely across supported hosts.`, file, binary: true, legacy: Boolean(legacy) };
    }
    if (isBinaryFile(resolvedPath)) {
      return { kind: 'readonly', path: resolvedPath, content: binaryPlaceholder, message: legacy ? 'Legacy binary file paths are read-only; preview is not available.' : 'Binary file preview is not available.', file, binary: true, legacy: Boolean(legacy) };
    }
    if (typeof file?.size === 'number' && file.size > MAX_NODE_TEXT_EDIT_BYTES) {
      return { kind: 'readonly', path: resolvedPath, content: 'File is too large to edit in the browser.', message: tooLargeMessage(resolvedPath), file, binary: true, legacy: Boolean(legacy) };
    }
    try {
      const content = await this.api.read(file?.compatibility === 'legacy' ? file : resolvedPath, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
      return context.isCurrent() ? { kind: 'editable', path: resolvedPath, content, file } : { kind: 'stale' };
    } catch (error) {
      if (error instanceof NodeFileTooLargeError) return { kind: 'readonly', path: resolvedPath, content: 'File is too large to edit in the browser.', message: tooLargeMessage(resolvedPath), file, binary: true, legacy: Boolean(legacy) };
      throw error;
    }
  }

  async refresh(session: EditorDocumentSnapshot, context: OperationContext) {
    const files = await this.list(context);
    if (!files) return { kind: 'stale' as const };
    const selected = files.find((file) => file.path === session.path);
    return { kind: selected || !session.path ? 'present' as const : 'missing' as const, files, selected };
  }

  async checkAndSave(
    session: EditorDocumentSnapshot, content: string, context: OperationContext,
    options: { confirm: EditorConfirm; scriptWrite?(content: BodyInit, signal?: AbortSignal): Promise<void> }
  ): Promise<WorkflowResult> {
    const { path } = session;
    if (new TextEncoder().encode(content).byteLength > MAX_NODE_TEXT_EDIT_BYTES) throw new Error(`${path} exceeds the 1 MiB text-upload limit.`);
    let files = await this.api.list(context.signal);
    if (!context.isCurrent()) return { kind: 'stale' };
    let remote = files.find((file) => file.path === path);
    if (!remote) {
      const recreate = await options.confirm({ title: 'Recreate missing file?', text: `${path} no longer exists on the node. Recreate it from this local buffer?`, confirmLabel: 'Recreate', cancelLabel: 'Cancel', tone: 'warning' });
      if (!recreate) return { kind: 'cancelled' };
      if (!context.isCurrent()) return { kind: 'stale' };
      files = await this.api.list(context.signal);
      if (!context.isCurrent()) return { kind: 'stale' };
      remote = files.find((file) => file.path === path);
      if (remote) throw new Error(`${path} was recreated on the node while confirmation was pending. Refresh before saving.`);
      const alias = files.find((file) => nodeFileAliasKey(file.path) === nodeFileAliasKey(path));
      if (alias) throw new Error(`${path} now has a case- or NFC-equivalent alias (${alias.path}). Refresh before saving.`);
    }
    if (remote && session.metadataBaselineValid && (session.metadata.modified !== remote.modified || session.metadata.size !== remote.size)) throw new Error(changedMessage(path, 'saving'));
    if (remote) {
      const remoteContent = await this.api.read(path, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
      if (!context.isCurrent()) return { kind: 'stale' };
      if (remoteContent !== session.cleanContent) throw new Error(changedMessage(path, 'saving'));
    }
    if (path === 'script.py' && options.scriptWrite) await options.scriptWrite(content, context.signal);
    else await this.api.save(path, content, context.signal);
    return context.isCurrent() ? { kind: 'saved', path } : { kind: 'stale' };
  }

  async createOrUpload(
    requestedPath: string, content: () => Promise<BodyInit>, context: OperationContext,
    options: { confirm: EditorConfirm; scriptWrite?(content: BodyInit, signal?: AbortSignal): Promise<void> }
  ): Promise<WorkflowResult | CreateWorkflowResult> {
    const validation = validateNodeFilePath(requestedPath);
    if (validation) throw new Error(validation);
    const files = await this.api.list(context.signal);
    if (!context.isCurrent()) return { kind: 'stale' };
    const aliasKey = nodeFileAliasKey(requestedPath);
    const exact = files.find((file) => file.path === requestedPath);
    const aliases = files.filter((file) => nodeFileAliasKey(file.path) === aliasKey);
    if (!exact && aliases.length > 1) throw new Error(`${requestedPath} is ambiguous because multiple case variants already exist on the node.`);
    const existing = exact ?? aliases[0];
    const path = existing?.path ?? requestedPath;
    if (existing?.compatibility === 'legacy') throw new Error(`${existing.path} is a legacy file path and cannot be overwritten.`);
    if (portableNodeFilePathKey(path) === 'script.py' && path !== 'script.py') throw new Error(`${path} is a case-only script.py alias and cannot be overwritten safely.`);
    let originalContent: string | undefined;
    if (existing) {
      if (isBinaryFile(path) && existing.modified === undefined && existing.size === undefined) throw new Error(`${path} has no metadata for safe overwrite verification; manage it externally.`);
      if (isEditableFile(path)) {
        if (typeof existing.size === 'number' && existing.size > MAX_NODE_TEXT_EDIT_BYTES) throw new Error(`${path} is too large to verify safely before overwrite.`);
        originalContent = await this.api.read(path, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
        if (!context.isCurrent()) return { kind: 'stale' };
      }
      const confirmed = await options.confirm({ title: 'Overwrite existing file?', text: `${path} already exists. Replace it?`, confirmLabel: 'Overwrite', cancelLabel: 'Cancel', tone: 'danger' });
      if (!confirmed) return { kind: 'cancelled' };
      if (!context.isCurrent()) return { kind: 'stale' };
    }
    const refreshed = await this.api.list(context.signal);
    if (!context.isCurrent()) return { kind: 'stale' };
    const current = refreshed.find((file) => file.path === path);
    const refreshedAliases = refreshed.filter((file) => nodeFileAliasKey(file.path) === aliasKey);
    if (!existing && refreshedAliases.length) throw new Error(`${requestedPath} was created on the node while this operation was pending. Review it before overwriting.`);
    if (existing && !current) throw new Error(`${path} changed while overwrite confirmation was pending. Review the file list and try again.`);
    if (existing && current && (current.modified !== existing.modified || current.size !== existing.size)) throw new Error(`${path} changed while overwrite confirmation was pending. Review it before overwriting.`);
    if (originalContent !== undefined) {
      const currentContent = await this.api.read(path, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
      if (!context.isCurrent()) return { kind: 'stale' };
      if (currentContent !== originalContent) throw new Error(`${path} changed while overwrite confirmation was pending. Review it before overwriting.`);
    }
    const payload = await content(); // Decode only after overwrite confirmation and race checks.
    if (!context.isCurrent()) return { kind: 'stale' };
    if (path === 'script.py' && options.scriptWrite) await options.scriptWrite(payload, context.signal);
    else await this.api.save(path, payload, context.signal);
    return context.isCurrent() ? { kind: existing ? 'overwritten' : 'created', path, content: payload } : { kind: 'stale' };
  }

  async checkAndDelete(session: EditorDocumentSnapshot, context: OperationContext): Promise<WorkflowResult> {
    const { path } = session;
    this.assertDeletable(session);
    const files = await this.api.list(context.signal);
    if (!context.isCurrent()) return { kind: 'stale' };
    const remote = files.find((file) => file.path === path);
    if (!remote) throw new Error(`${path} no longer exists on the node. Refresh before deleting.`);
    if (session.metadataBaselineValid && (session.metadata.modified !== remote.modified || session.metadata.size !== remote.size)) throw new Error(changedMessage(path, 'deleting'));
    if (isEditableFile(path)) {
      const content = await this.api.read(path, context.signal, MAX_NODE_TEXT_EDIT_BYTES);
      if (!context.isCurrent()) return { kind: 'stale' };
      if (content !== session.cleanContent) throw new Error(changedMessage(path, 'deleting'));
    }
    await this.api.delete(path, context.signal);
    return context.isCurrent() ? { kind: 'deleted', path } : { kind: 'stale' };
  }

  assertDeletable(session: EditorDocumentSnapshot) {
    if (session.capabilities.binary && session.metadata.modified === undefined && session.metadata.size === undefined) {
      throw new Error(`${session.path} has no metadata for safe delete verification; manage it externally.`);
    }
  }
}
