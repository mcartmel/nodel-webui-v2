import { fetchOk, postJson } from './http-transport';

export async function createNode(value: string, base?: string, init?: RequestInit): Promise<unknown> {
  const payload: Record<string, string> = { value };
  if (base) {
    payload.base = base;
  }

  return postJson('/REST/newNode', payload, init);
}

export async function renameCurrentNode(value: string, init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/rename', {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify({ value })
  });
}

export async function restartCurrentNode(init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/restart', init);
}

export async function removeCurrentNode(init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/remove?confirm=true', init);
}
