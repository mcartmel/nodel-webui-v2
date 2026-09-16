export function cssBackgroundUrl(value: string | null) {
  // Preserve existing URL escapes while encoding characters that can break a quoted CSS value.
  // eslint-disable-next-line no-control-regex
  return value ? `url("${value.replace(/[\\"\u0000-\u001f\u007f]/g, encodeURIComponent)}")` : 'none';
}
