import { generateHostIconDataUri } from '../src/icons/host-identicon';

describe('host identicon', () => {
  it('generates deterministic data URIs', () => {
    const iconA = generateHostIconDataUri('localhost:8085');
    const iconB = generateHostIconDataUri('localhost:8085');
    const iconC = generateHostIconDataUri('otherhost:8085');

    expect(iconA).toBe(iconB);
    expect(iconA).not.toBe(iconC);
    expect(iconA.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
