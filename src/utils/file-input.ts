export function resetFileInput(input: HTMLInputElement | null) {
  if (input?.type === 'file') {
    input.value = '';
  }
}
