import { isEditableFile } from './file-types';
import { MAX_NODE_FILE_UPLOAD_BYTES, MAX_NODE_TEXT_EDIT_BYTES } from '../utils/node-file-limits';

export interface UploadStage { file: File; path: string; maxBytes: number; }
export type UploadDropResult = { kind: 'accepted'; file: File } | { kind: 'rejected'; message: string } | { kind: 'ignored' };

export function uploadLimit(path: string) {
  return isEditableFile(path) || path === 'script.py' ? MAX_NODE_TEXT_EDIT_BYTES : MAX_NODE_FILE_UPLOAD_BYTES;
}

export class EditorUploadStaging {
  private staged: UploadStage | null = null;
  private disposed = false;

  get current() { return this.staged; }
  get hasStage() { return this.staged !== null; }

  extract(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) return [] as File[];
    if (dataTransfer.files.length) return Array.from(dataTransfer.files);
    return Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
  }

  classify(files: readonly File[], fileItemCount = files.length): UploadDropResult {
    if (files.length !== 1 || fileItemCount > 1) return { kind: 'rejected', message: 'Drop one file at a time.' };
    return { kind: 'accepted', file: files[0]! };
  }

  stage(file: File, busy = false) {
    if (this.disposed || busy) return { accepted: false, message: 'Wait for the current editor operation to finish before uploading.' };
    const maxBytes = uploadLimit(file.name);
    if (file.size > maxBytes) return { accepted: false, message: `${file.name} exceeds the ${maxBytes === MAX_NODE_TEXT_EDIT_BYTES ? '1 MiB' : '8 MiB'} upload limit.` };
    this.staged = { file, path: file.name, maxBytes };
    return { accepted: true as const, stage: this.staged };
  }

  async contentFor(path: string): Promise<BodyInit> {
    const stage = this.staged;
    if (!stage) return '';
    if (!isEditableFile(path) && path !== 'script.py') return stage.file;
    const content = await stage.file.text();
    if (new TextEncoder().encode(content).byteLength > MAX_NODE_TEXT_EDIT_BYTES) {
      throw new Error(`${stage.file.name} exceeds the 1 MiB text-upload limit after decoding.`);
    }
    return content;
  }

  clear() { this.staged = null; }
  dispose() { this.disposed = true; this.clear(); }
}
