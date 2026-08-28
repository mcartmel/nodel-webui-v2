import { trimPointReference } from './edge-whitespace';

/** Validates the strict action-list grammar used by nodel-shortcut. */
export function isStrictActionBindingList(value: string | null | undefined, phase = 'trigger') {
  if (value == null || value.length === 0) return value == null;
  return value.split(/[;,]/).every((part) => {
    const item = trimPointReference(part);
    if (!item) return false;
    const separator = item.lastIndexOf(':');
    if (separator === 0 || separator === item.length - 1) return false;
    const action = trimPointReference(separator < 0 ? item : item.slice(0, separator));
    const bindingPhase = separator < 0 ? phase : trimPointReference(item.slice(separator + 1));
    return Boolean(action) && bindingPhase === phase;
  });
}
