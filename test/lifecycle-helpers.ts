export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

export async function rapidReconnect(
  element: HTMLElement,
  reconnect: () => Promise<void> | void,
  count = 3
) {
  for (let index = 0; index < count; index += 1) {
    element.remove();
    document.body.append(element);
    await reconnect();
  }
}
