// @vitest-environment node

import { createHash } from 'node:crypto';
import { javaNodeNameEquals, javaSimpleNameKey } from '../src/features/topology/topology-simple-name';

// Goldens from getReducedForMatchingName() and equals() on SimpleName.java
// compiled with Nodel.java from local backend revision e720d279c63d, running
// Temurin 21.0.11 with Locale.setDefault(Locale.ROOT). No Java needed in CI.
describe('Java SimpleName topology compatibility', () => {
  const matches = [
    ['Crème Brûlée', 'CremeBrulee', 'cremebrulee'],
    ['Ärger über schöne Äpfel', 'Arger ueber schoene Apfel', 'argerueberschoeneapfel'],
    ['Dvořák, Æsir, Cœur, Straße, ẞ', 'Dvorak aesir coeur strasse ẞ', 'dvorakaesircoeurstrasseß'],
    ['Щука, Ёж, Юлия, Ъь', 'Shchuka Yozh Yuliya', 'shchukayozhyuliya'],
    ['東京—ＡＢＣ ١٢😀', '東京—ａｂｃ١٢😀', '東京—ａｂｃ١٢😀'],
    ['Սարք ԱԲԳ', 'սարք աբգ', 'սարքաբգ'],
    ["A.B_C:D/E'F-G+H\u007f", 'abcdefgh', 'abcdefgh'],
    ['Project (outer (inner // --) text) West -- retired', 'projectwest', 'projectwest'],
    ['A- -B / /C // tail', 'abc', 'abc'],
    ['A(-)-B/(nested)/C', 'abc', 'abc'],
    ['A)(unclosed', 'a', 'a'],
    ['\tA\u0000\u00a0B\u1680\u2003C\u2028\u2029\u202f\u205f\u3000D\r\n', 'abcd', 'abcd'],
    ['Iİıi K ǅ ǈ ǋ ǲ', 'iiii k ǆ ǉ ǌ ǳ', 'iiiikǆǉǌǳ'],
    ['ΟϹ', 'oϲ', 'oϲ'],
    ['\ua7c0', '\ua7c1', '\ua7c1'],
    ['()--ignored', 'Ъь /_ \u00a0', ''],
    ['', '---', '']
  ] as const;

  it.each(matches)('gives %j and %j the same key', (left, right, key) => {
    expect(javaSimpleNameKey(left)).toBe(key);
    expect(javaSimpleNameKey(right)).toBe(key);
    expect(javaNodeNameEquals(left, right)).toBe(true);
  });

  const differences = [
    ['Παράδειγμα: ΔξΠΒΜΨΣς', 'Paradigma DJksπβμψSS', 'πaradjeigmadjksπβμψss', 'paradigmadjkspvmpsss'],
    ['𐐀', '𐐨', '𐐀', '𐐨'], // Java lowers char units, not supplementary code points.
    ['A—B，C…D／E（F）', 'ABCD E F', 'a—b，c…d／e（f）', 'abcdef'],
    ['A\u0085\u180e\u200b\ufeffB', 'ab', 'a\u0085\u180e\u200b\ufeffb', 'ab'],
    ['Cafe\u0301', 'Café', 'cafe\u0301', 'cafe'], // No Unicode normalization.
    ['ﬀ', 'ff', 'ﬀ', 'ff'],
    ['\ua7cb', '\u0264', '\ua7cb', '\u0264'], // Unicode 16 added a casing pair absent in Java 21.
    ['A\ud800B\udc00', 'ab', 'a\ud800b\udc00', 'ab'],
    ['😀', '', '😀', ''],
    ['Ä', 'ä', 'a', 'ae']
  ] as const;

  it.each(differences)('keeps %j distinct from %j', (left, right, leftKey, rightKey) => {
    expect(javaSimpleNameKey(left)).toBe(leftKey);
    expect(javaSimpleNameKey(right)).toBe(rightKey);
    expect(javaNodeNameEquals(left, right)).toBe(false);
  });

  it('reduces the whole name without a length cut-off', () => {
    const name = 'Ö Gerät(A (nested) // --) Σ-9 '.repeat(8192);
    const key = 'oegeraets9'.repeat(8192);
    expect(javaSimpleNameKey(name)).toBe(key);
    expect(javaNodeNameEquals(name, key)).toBe(true);
    expect(javaNodeNameEquals(`${name} A`, `${name} B`)).toBe(false);
  });

  it('matches the Java oracle for every individual UTF-16 code unit', () => {
    // Oracle serialized key(String.valueOf((char) unit)) as UTF-16 unit hex
    // (four lowercase hex digits per output unit), followed by LF per input.
    const digest = createHash('sha256');
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      const key = javaSimpleNameKey(String.fromCharCode(unit));
      digest.update(`${Buffer.from(key, 'utf16le').swap16().toString('hex')}\n`);
    }
    expect(digest.digest('hex')).toBe('0988b8ee8d2a1642ad3263a2e3ca4bb35bfa7d93f1ac74701120d4379016bd40');
  });
});
