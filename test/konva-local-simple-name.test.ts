// @vitest-environment node

import { createHash } from 'node:crypto';
import { javaNodeNameEquals, javaSimpleNameKey } from '../src/experiments/konva-canvas/local-simple-name';

describe('Java SimpleName compatibility used by local graph identity', () => {
  it.each([
    ['Crème Brûlée', 'CremeBrulee', 'cremebrulee'],
    ['Ärger über schöne Äpfel', 'Arger ueber schoene Apfel', 'argerueberschoeneapfel'],
    ['Щука, Ёж, Юлия, Ъь', 'Shchuka Yozh Yuliya', 'shchukayozhyuliya'],
    ['Project (outer (inner // --) text) West -- retired', 'projectwest', 'projectwest'],
    ['A- -B / /C // tail', 'abc', 'abc'],
    ['Cafe\u0301', 'Cafe\u0301', 'cafe\u0301']
  ])('reduces %j and %j to the Java oracle key', (left, right, key) => {
    expect(javaSimpleNameKey(left)).toBe(key);
    expect(javaSimpleNameKey(right)).toBe(key);
    expect(javaNodeNameEquals(left, right)).toBe(true);
  });

  it.each([
    ['𐐀', '𐐨'],
    ['A—B，C…D／E（F）', 'ABCD E F'],
    ['Cafe\u0301', 'Café'],
    ['A\ua7cb', 'A\u0264'],
    ['Ä', 'ä']
  ])('does not conflate Java-distinct %j and %j', (left, right) => {
    expect(javaNodeNameEquals(left, right)).toBe(false);
  });

  it('matches the archived Java 21 oracle for every UTF-16 code unit', () => {
    const digest = createHash('sha256');
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      const key = javaSimpleNameKey(String.fromCharCode(unit));
      digest.update(`${Buffer.from(key, 'utf16le').swap16().toString('hex')}\n`);
    }
    expect(digest.digest('hex')).toBe('0988b8ee8d2a1642ad3263a2e3ca4bb35bfa7d93f1ac74701120d4379016bd40');
  });
});
