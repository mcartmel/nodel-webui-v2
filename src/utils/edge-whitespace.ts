/**
 * Trims the whitespace Java point-name handling accepts at string edges.
 * Deliberately excludes U+FEFF, which Java treats as an identifier character.
 */
const javaEdgeWhitespace = /^[\u0009-\u000d\u0020\p{Zs}\p{Zl}\p{Zp}]+|[\u0009-\u000d\u0020\p{Zs}\p{Zl}\p{Zp}]+$/gu;

export function trimPointReference(value: string) {
  return value.replace(javaEdgeWhitespace, '');
}
