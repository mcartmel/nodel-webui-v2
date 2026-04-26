const unicodematch = /[^\p{L}\p{N}]/gu;

export function reduceNodeNameForPath(name: string): string {
  let reduced = '';
  let lastChar = '';
  let commentLevel = 0;

  for (let i = 0; i < name.length; i += 1) {
    const c = name.charAt(i);

    if (c === '(') {
      commentLevel += 1;
    } else if (commentLevel > 0) {
      if (c === ')') commentLevel -= 1;
    } else if ((c === '-' && lastChar === '-') || (c === '/' && lastChar === '/')) {
      break;
    } else if (c.replace(unicodematch, '') !== '') {
      reduced += c;
    } else if (c.charCodeAt(0) > 127 && !/\s/.test(c)) {
      reduced += c;
    }

    lastChar = c;
  }

  return reduced;
}

export function getSimpleName(name: string): string {
  const match = /^(.+?)(?:\(| \(|$)/i.exec(name);
  return match ? match[1] : name;
}

export function getVerySimpleName(name: string): string {
  return reduceNodeNameForPath(name);
}

export function getHostFromAddress(address: string): string {
  return new URL(address, window.location.origin).host;
}

export function getCurrentHostOrigin(): string {
  return window.location.origin;
}
