export const MAX_NODE_TEXT_EDIT_BYTES = 1024 * 1024;
export const MAX_NODE_FILE_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_NODE_DUPLICATE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_NODE_DUPLICATE_TOTAL_BYTES = 32 * 1024 * 1024;

export class NodeFileTooLargeError extends Error {
  constructor(public readonly path: string, public readonly maxBytes: number, label = 'text-edit') {
    super(`${path} exceeds the ${formatFileSize(maxBytes)} ${label} limit`);
    this.name = 'NodeFileTooLargeError';
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KiB`;
  }
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}
