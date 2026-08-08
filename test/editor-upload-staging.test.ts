import { EditorUploadStaging } from '../src/editor/editor-upload-staging';

describe('EditorUploadStaging', () => {
  it('enforces busy, single-drop, and 1 MiB/8 MiB limits without decoding', () => {
    const staging = new EditorUploadStaging();
    const text = new File(['x'], 'a.txt'); Object.defineProperty(text, 'text', { value: vi.fn(async () => 'x') });
    expect(staging.stage(text, true).accepted).toBe(false);
    expect(staging.classify([text, new File(['x'], 'b.txt')]).kind).toBe('rejected');
    Object.defineProperty(text, 'size', { value: 1024 * 1024 + 1 });
    expect(staging.stage(text).accepted).toBe(false);
    expect(text.text).not.toHaveBeenCalled();
    const binary = new File(['x'], 'a.zip'); Object.defineProperty(binary, 'size', { value: 8 * 1024 * 1024 + 1 });
    expect(staging.stage(binary).accepted).toBe(false);
  });

  it('defers decoding until content is requested and clears/disposes staged files', async () => {
    const staging = new EditorUploadStaging(); const file = new File(['x'], 'a.txt'); const decode = vi.fn(async () => 'decoded'); Object.defineProperty(file, 'text', { value: decode });
    staging.stage(file);
    expect(decode).not.toHaveBeenCalled();
    await expect(staging.contentFor('a.txt')).resolves.toBe('decoded');
    staging.clear(); expect(staging.current).toBeNull();
    staging.stage(file); staging.dispose(); expect(staging.current).toBeNull();
  });

  it('rejects decoded text that grows above the edit limit', async () => {
    const staging = new EditorUploadStaging(); const file = new File(['x'], 'a.txt'); Object.defineProperty(file, 'size', { value: 1 }); Object.defineProperty(file, 'text', { value: vi.fn(async () => 'x'.repeat(1024 * 1024 + 1)) });
    staging.stage(file);
    await expect(staging.contentFor('a.txt')).rejects.toThrow('after decoding');
  });

  it('extracts fallback DataTransfer file items and accepts the same file after clearing', () => {
    const staging = new EditorUploadStaging(); const file = new File(['x'], 'same.txt');
    const transfer = { files: [], items: [{ kind: 'file', getAsFile: () => file }] } as unknown as DataTransfer;
    expect(staging.extract(transfer)).toEqual([file]);
    expect(staging.stage(file).accepted).toBe(true);
    staging.clear();
    expect(staging.stage(file).accepted).toBe(true);
  });
});
