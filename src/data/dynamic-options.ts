export interface DynamicOptionRecord {
  value: string;
  label: string;
}

export interface DynamicOptionIssue {
  index?: number;
  message: string;
}

export type DynamicOptionsState = 'static' | 'loading' | 'ready' | 'empty' | 'error';

export interface DynamicOptionsApplyResult {
  ok: boolean;
  state: DynamicOptionsState;
  count: number;
  issues: DynamicOptionIssue[];
  removedFocused: boolean;
  removedFocusedIndex: number;
  previousFocusedValue: string;
  retainedFocused: boolean;
}

const maxDynamicOptions = 200;

function scalarToString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function normalizeText(value: unknown) {
  const text = scalarToString(value);
  if (text === null || text.trim() === '') {
    return null;
  }
  return text;
}

function normalizeOptionItem(item: unknown, index: number): { option?: DynamicOptionRecord; issue?: DynamicOptionIssue } {
  if (item === null || item === undefined || Array.isArray(item)) {
    return { issue: { index, message: 'Option must be a scalar or object' } };
  }

  if (typeof item !== 'object') {
    const value = normalizeText(item);
    if (!value) {
      return { issue: { index, message: 'Option value is blank or unsupported' } };
    }
    return { option: { value, label: value } };
  }

  const record = item as Record<string, unknown>;
  if (!('label' in record)) {
    const label = normalizeText(record.value);
    let value = label;
    if (record.key !== undefined && record.key !== null && !(typeof record.key === 'string' && record.key.trim() === '')) {
      const key = normalizeText(record.key);
      if (!key) {
        return { issue: { index, message: 'v1 key/value option key must be a scalar value' } };
      }
      value = key;
    }
    if (!value || !label) {
      return { issue: { index, message: 'v1 key/value option requires a usable value label' } };
    }
    return { option: { value, label } };
  }

  const value = normalizeText(record.value);
  const label = 'label' in record ? normalizeText(record.label) : null;
  if (!value || !label) {
    return { issue: { index, message: 'Option object requires value and label scalars' } };
  }
  return { option: { value, label } };
}

export function normalizeDynamicOptions(payload: unknown): { ok: true; options: DynamicOptionRecord[] } | { ok: false; issues: DynamicOptionIssue[] } {
  if (!Array.isArray(payload)) {
    return { ok: false, issues: [{ message: 'Options payload must be an array' }] };
  }

  if (payload.length > maxDynamicOptions) {
    return { ok: false, issues: [{ message: `Options payload exceeds ${maxDynamicOptions} entries` }] };
  }

  const options: DynamicOptionRecord[] = [];
  const issues: DynamicOptionIssue[] = [];
  const seenValues = new Set<string>();

  payload.forEach((item, index) => {
    const result = normalizeOptionItem(item, index);
    if (result.issue) {
      issues.push(result.issue);
      return;
    }
    const option = result.option!;
    if (seenValues.has(option.value)) {
      issues.push({ index, message: 'Duplicate option value' });
      return;
    }
    seenValues.add(option.value);
    options.push(option);
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, options };
}

function setButtonLabel(node: HTMLElement, label: string) {
  const existingLabel = node.querySelector<HTMLElement>('[data-button-label]');
  if (existingLabel) {
    existingLabel.textContent = label;
    for (const extra of Array.from(node.querySelectorAll<HTMLElement>('[data-button-label]')).slice(1)) {
      extra.textContent = '';
    }
    return;
  }

  const content = node.querySelector<HTMLElement>('[data-button-content]');
  if (content) {
    content.textContent = '';
    const labelNode = document.createElement('span');
    labelNode.dataset.buttonLabel = '';
    labelNode.textContent = label;
    content.appendChild(labelNode);
    return;
  }

  node.textContent = label;
}

export class DynamicOptionsController {
  private fallbackNodes: HTMLElement[] = [];
  private generatedByValue = new Map<string, HTMLElement>();
  private dynamicApplied = false;
  private bindingActive = false;
  private state: DynamicOptionsState = 'static';

  constructor(private readonly container: HTMLElement, private readonly createOption: (option: DynamicOptionRecord) => HTMLElement) {}

  setBindingActive(active: boolean) {
    if (this.bindingActive === active) {
      return this.state;
    }

    this.captureFallbackNodes();
    this.bindingActive = active;
    if (!active) {
      this.restoreFallback();
      this.state = 'static';
      return this.state;
    }

    this.state = this.dynamicApplied ? this.state : 'loading';
    return this.state;
  }

  getState() {
    return this.state;
  }

  hasFallbackOptions() {
    this.captureFallbackNodes();
    return this.fallbackNodes.length > 0 && !this.dynamicApplied;
  }

  applyPayload(payload: unknown): DynamicOptionsApplyResult {
    const normalized = normalizeDynamicOptions(payload);
    if (!normalized.ok) {
      this.state = 'error';
      return { ok: false, state: this.state, count: this.currentOptions().length, issues: normalized.issues, removedFocused: false, removedFocusedIndex: -1, previousFocusedValue: '', retainedFocused: false };
    }

    const result = this.reconcile(normalized.options);
    this.dynamicApplied = true;
    this.state = normalized.options.length > 0 ? 'ready' : 'empty';
    return { ok: true, state: this.state, count: normalized.options.length, issues: [], ...result };
  }

  clear() {
    this.restoreFallback();
    this.bindingActive = false;
    this.state = 'static';
  }

  dispose() {
    this.clear();
  }

  private captureFallbackNodes() {
    if (this.fallbackNodes.length > 0 || this.dynamicApplied) {
      return;
    }
    this.fallbackNodes = this.currentOptions().filter((option) => !option.hasAttribute('data-nodel-dynamic-option'));
  }

  private currentOptions() {
    return Array.from(this.container.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.localName === 'nodel-button');
  }

  private optionValue(option: HTMLElement) {
    return option.getAttribute('value') ?? option.getAttribute('arg') ?? option.textContent?.trim() ?? '';
  }

  private restoreFallback() {
    for (const node of this.generatedByValue.values()) {
      node.remove();
    }
    this.generatedByValue.clear();
    for (const option of this.currentOptions()) {
      if (!this.fallbackNodes.includes(option)) {
        option.remove();
      }
    }
    for (const option of this.fallbackNodes) {
      this.container.appendChild(option);
    }
    this.dynamicApplied = false;
  }

  private reconcile(options: DynamicOptionRecord[]) {
    this.captureFallbackNodes();
    const activeElement = document.activeElement;
    const closestActiveOption = activeElement instanceof Element ? activeElement.closest<HTMLElement>('nodel-button') : null;
    const activeOption = closestActiveOption?.parentElement === this.container ? closestActiveOption : null;
    const current = this.currentOptions();
    const removedFocusedIndex = activeOption ? current.indexOf(activeOption) : -1;
    const previousFocusedValue = activeOption ? this.optionValue(activeOption) : '';
    const focusedFallbackWillBeRemoved = Boolean(activeOption && !this.dynamicApplied && this.fallbackNodes.includes(activeOption));

    if (!this.dynamicApplied) {
      for (const option of this.fallbackNodes) {
        option.remove();
      }
    }

    const nextValues = new Set(options.map((option) => option.value));
    for (const [value, node] of this.generatedByValue) {
      if (!nextValues.has(value)) {
        node.remove();
        this.generatedByValue.delete(value);
      }
    }

    options.forEach((option, index) => {
      let node = this.generatedByValue.get(option.value);
      if (!node) {
        node = this.createOption(option);
        node.dataset.nodelDynamicOption = '';
        this.generatedByValue.set(option.value, node);
      }
      node.setAttribute('value', option.value);
      setButtonLabel(node, option.label);
      const reference = this.container.children[index] ?? null;
      if (reference !== node) {
        this.container.insertBefore(node, reference);
      }
    });

    const removedFocused = focusedFallbackWillBeRemoved || Boolean(activeOption && activeOption.hasAttribute('data-nodel-dynamic-option') && !nextValues.has(previousFocusedValue));
    const retainedFocused = Boolean(activeOption && !removedFocused && nextValues.has(previousFocusedValue));
    return { removedFocused, removedFocusedIndex, previousFocusedValue, retainedFocused };
  }
}
