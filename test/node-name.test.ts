import { getHostFromAddress, getNodePathName } from '../src/utils/node-name';

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
});
