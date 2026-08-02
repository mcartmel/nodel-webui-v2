import { throwIfAborted } from '../src/api/http-transport';
import { boundedErrorMessage, errorMessage, isAbortError } from '../src/utils/errors';
import { hasOwn, isRecord, setOwn } from '../src/utils/records';

describe('error and record utilities', () => {
  it('normalizes empty, whitespace, non-error, and bounded messages', () => {
    expect(errorMessage(new Error('  '), 'Fallback')).toBe('Fallback');
    expect(errorMessage('not an Error', 'Fallback')).toBe('Fallback');
    expect(boundedErrorMessage(new Error('  first\nsecond\tthird  '), 'Fallback')).toBe('first second third');
    expect(boundedErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(boundedErrorMessage(new Error('123456'), 'Fallback', 4)).toBe('1234');
  });

  it('preserves custom abort reasons while classifying abort errors centrally', () => {
    const controller = new AbortController();
    const reason = new Error('custom cancellation');
    controller.abort(reason);

    expect(() => throwIfAborted(controller.signal)).toThrow(reason);
    expect(isAbortError(reason)).toBe(false);
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('ordinary failure'))).toBe(false);
  });

  it('rejects null and arrays and safely assigns prototype-like keys', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(hasOwn({ inherited: false }, 'missing')).toBe(false);

    const target: Record<string, unknown> = {};
    setOwn(target, '__proto__', { safe: true });
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expect(target.__proto__).toEqual({ safe: true });
    expect(hasOwn(target, '__proto__')).toBe(true);
  });
});
