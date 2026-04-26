import Identicon from 'identicon.js';
import XXH from 'xxhashjs';

export function generateHostIcon(host: string): string {
  const hash = XXH.h64(host, 0x4e6f64656c).toString(16).padStart(16, '0');
  return new Identicon(hash, {
    background: [255, 255, 255, 0],
    margin: 0.1,
    size: 20,
    format: 'svg'
  }).toString();
}

export function generateHostIconDataUri(host: string): string {
  return `data:image/svg+xml;base64,${generateHostIcon(host)}`;
}
