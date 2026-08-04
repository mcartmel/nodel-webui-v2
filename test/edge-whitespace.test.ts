import { trimPointReference } from '../src/utils/edge-whitespace';

describe('trimPointReference', () => {
  it('trims ASCII and Java space separators without trimming U+FEFF', () => {
    expect(trimPointReference('\t \u00a0\u2007\u2028Power\uFEFF\u2029 ')).toBe('Power\uFEFF');
    expect(trimPointReference('\uFEFFPower\uFEFF')).toBe('\uFEFFPower\uFEFF');
  });
});
