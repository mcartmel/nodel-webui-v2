import {
  assertUsableNodeName,
  getHostFromAddress,
  getNodePathName,
  isUsableNodeName,
  NODE_NAME_EMPTY_REDUCTION_ERROR,
  NODE_NAME_UNSUPPORTED_CHARACTER_ERROR,
  reduceNodeNameForPath
} from '../src/utils/node-name';
import { localNodePath } from '../src/utils/urls';

describe('node URL name helpers', () => {
  it('decodes valid node paths and safely rejects malformed percent encoding', () => {
    expect(getNodePathName('/nodes/Display%20One/nodel.html')).toBe('Display One');
    expect(getNodePathName('/nodes/Display+Two/nodel.html')).toBe('Display Two');
    expect(getNodePathName('/nodes/%E0%A4%A/nodel.html')).toBeNull();
    expect(getNodePathName('/nodes/%/nodel.html')).toBeNull();
  });

  it('returns an empty host instead of throwing for malformed addresses', () => {
    expect(getHostFromAddress('https://display.test/nodes/Display/')).toBe('display.test');
    expect(getHostFromAddress('http://[invalid')).toBe('');
  });

  it('matches Java Nodel.reduce(char) for spaces, comments, and display names', () => {
    expect(reduceNodeNameForPath('Living Room')).toBe('LivingRoom');
    expect(reduceNodeNameForPath('Node\ufeff')).toBe('Node\ufeff');
    expect(reduceNodeNameForPath('Node\u00a0')).toBe('Node');
    expect(reduceNodeNameForPath('\u00a0')).toBe('');
    expect(reduceNodeNameForPath('Display (Rack A)//deprecated')).toBe('Display');
    expect(reduceNodeNameForPath('Node 😀')).toBe('Node😀');
  });

  it('requires names used for local paths to have a non-empty Java reduction', () => {
    expect(() => assertUsableNodeName('\u00a0')).toThrow(NODE_NAME_EMPTY_REDUCTION_ERROR);
    expect(assertUsableNodeName('\ufeff')).toBe('\ufeff');
    expect(assertUsableNodeName('Nodel \u4e2d\u6587')).toBe('Nodel \u4e2d\u6587');
    expect(assertUsableNodeName('Node\u00a0')).toBe('Node\u00a0');
  });

  it('keeps backend astral names display-only instead of deriving local mutation URLs', () => {
    const backendName = 'Node \ud83d\ude00';

    expect(reduceNodeNameForPath(backendName)).toBe('Node\ud83d\ude00');
    expect(isUsableNodeName(backendName)).toBe(false);
    expect(() => assertUsableNodeName(backendName)).toThrow(NODE_NAME_UNSUPPORTED_CHARACTER_ERROR);
    expect(() => localNodePath(backendName)).toThrow(NODE_NAME_UNSUPPORTED_CHARACTER_ERROR);
  });

  it('rejects C0, C1, and DEL controls in newly authored names', () => {
    for (const control of ['\u0000', '\u001f', '\u007f', '\u0080', '\u009f']) {
      const name = `Node${control}Name`;
      expect(isUsableNodeName(name)).toBe(false);
      expect(() => assertUsableNodeName(name)).toThrow(NODE_NAME_UNSUPPORTED_CHARACTER_ERROR);
    }
  });
});
