export async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

export function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitFor(
  predicate: () => boolean,
  options: { attempts?: number; intervalMs?: number; message?: string } = {}
) {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 0;

  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) {
      return;
    }

    await flush();

    if (intervalMs > 0) {
      await delay(intervalMs);
    }
  }

  throw new Error(options.message ?? 'Timed out waiting for condition');
}
