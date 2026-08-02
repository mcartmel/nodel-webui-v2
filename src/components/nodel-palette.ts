import { parseActionBindings } from '../data/action-bindings';
import {
  actionErrorMessage,
  actionName,
  buildActionPayload,
  dispatchControlActionError,
  executeActionPhases
} from '../data/control-actions';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { accessibleLabelText, syncHostAccessibleLabel } from '../utils/accessibility';
import { normalizeFromList, normalizeTone, normalizeVariant, syncInheritedAttributes, truthy } from '../utils/control-values';
import './nodel-button';
import { colorsEqual, formatColor, nodelColorFormats, parseColor, type NodelColor, type NodelColorFormat } from '../utils/color';

type PaletteShape = 'square' | 'rounded' | 'circle';
type PaletteLabels = 'auto' | 'show' | 'hide';
type PalettePicker = 'off' | 'native';
type PaletteValueField = 'readonly' | 'editable' | 'hidden';
type PaletteArgType = 'string' | 'json';
type PaletteActionPhase = 'select' | 'live' | 'commit';

const shapes: PaletteShape[] = ['square', 'rounded', 'circle'];
const labelModes: PaletteLabels[] = ['auto', 'show', 'hide'];
const pickerModes: PalettePicker[] = ['off', 'native'];
const valueFieldModes: PaletteValueField[] = ['readonly', 'editable', 'hidden'];
const argTypes: PaletteArgType[] = ['string', 'json'];
const defaultLiveInterval = 100;
const minimumLiveInterval = 50;
const maximumLiveInterval = 1000;

function normalizeColumns(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(12, parsed)) : null;
}

function looksLikeColor(value: string) {
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)
    || /^rgba?\(/i.test(trimmed)
    || /^hsla?\(/i.test(trimmed)
    || /^[a-z]+$/i.test(trimmed);
}

export class NodelPalette extends HTMLElement {
  static observedAttributes = ['label', 'aria-label', 'aria-labelledby', 'value', 'action', 'actions', 'join', 'arg-type', 'columns', 'shape', 'picker', 'value-field', 'format', 'custom-label', 'show-labels', 'allow-deselect', 'live', 'live-interval', 'variant', 'tone', 'disabled', 'signal', 'signals', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone', 'confirm-mode', 'confirm-code-signal'];

  private shellReady = false;
  private gridNode: HTMLElement | null = null;
  private customNode: HTMLInputElement | null = null;
  private customButton: HTMLButtonElement | null = null;
  private customValueLabel: HTMLLabelElement | null = null;
  private customValueNode: HTMLInputElement | null = null;
  private customErrorNode: HTMLElement | null = null;
  private canonicalColor: NodelColor = { r: 255, g: 255, b: 255, a: 1 };
  private customInvalid = false;
  private customDraftActive = false;
  private selectionToken = 0;
  private liveTimer: number | null = null;
  private lastLiveDispatchAt = 0;
  private pendingLiveSelection: { value: string; source: HTMLElement } | null = null;
  private inheritedOptionAttributes = new WeakMap<HTMLElement, Map<string, string>>();
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleOptionClick, true);
    this.customNode?.addEventListener('input', this.handleCustomInput);
    this.customNode?.addEventListener('change', this.handleCustomInteractionEnd);
    this.customValueNode?.addEventListener('input', this.handleCustomValueInput);
    this.customValueNode?.addEventListener('change', this.handleCustomInteractionEnd);
    this.customValueNode?.addEventListener('keydown', this.handleCustomValueKeyDown);
    this.customButton?.addEventListener('click', this.handleCustomSelect);
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.removeEventListener('click', this.handleOptionClick, true);
    this.customNode?.removeEventListener('input', this.handleCustomInput);
    this.customNode?.removeEventListener('change', this.handleCustomInteractionEnd);
    this.customValueNode?.removeEventListener('input', this.handleCustomValueInput);
    this.customValueNode?.removeEventListener('change', this.handleCustomInteractionEnd);
    this.customValueNode?.removeEventListener('keydown', this.handleCustomValueKeyDown);
    this.customButton?.removeEventListener('click', this.handleCustomSelect);
    this.cancelLiveSelection();
    this.selectionToken += 1;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }
    const children = Array.from(this.childNodes);
    this.innerHTML = `
      <div class="nodel-palette-shell">
        <div class="nodel-palette-grid"></div>
        <div class="nodel-palette-custom" hidden>
          <label class="nodel-palette-custom-label">
            <span data-custom-label>Custom</span>
            <input type="color" class="nodel-palette-custom-input" value="#ffffff" />
          </label>
          <label class="nodel-palette-value-label">
            <span>Colour value</span>
            <input type="text" class="nodel-palette-value-input nodel-field" spellcheck="false" />
          </label>
          <button type="button" class="nodel-palette-custom-button">Select</button>
          <span class="nodel-palette-value-error" role="alert" hidden>Enter a valid hex, RGB, HSL, or HSV colour.</span>
        </div>
      </div>
    `;
    this.gridNode = this.querySelector('.nodel-palette-grid');
    this.customNode = this.querySelector('.nodel-palette-custom-input');
    this.customButton = this.querySelector('.nodel-palette-custom-button');
    this.customValueLabel = this.querySelector('.nodel-palette-value-label');
    this.customValueNode = this.querySelector('.nodel-palette-value-input');
    this.customErrorNode = this.querySelector('.nodel-palette-value-error');
    for (const child of children) {
      if (child instanceof HTMLElement && child.localName === 'nodel-button') {
        this.gridNode?.appendChild(child);
      }
    }
    this.shellReady = true;
  }

  private options() {
    return Array.from(this.gridNode?.children ?? []).filter((child): child is HTMLElement => child.localName === 'nodel-button');
  }

  private optionValue(option: HTMLElement) {
    return option.getAttribute('value') ?? option.getAttribute('arg') ?? option.getAttribute('color') ?? option.textContent?.trim() ?? '';
  }

  private optionColor(option: HTMLElement) {
    const color = option.getAttribute('color') ?? option.getAttribute('value') ?? '';
    return looksLikeColor(color) ? color : '';
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const shape = normalizeFromList(this.getAttribute('shape'), shapes, 'rounded');
    const showLabels = normalizeFromList(this.getAttribute('show-labels'), labelModes, 'auto');
    const picker = normalizeFromList(this.getAttribute('picker'), pickerModes, 'off');
    const valueField = normalizeFromList(this.getAttribute('value-field'), valueFieldModes, 'readonly');
    const disabled = this.hasAttribute('disabled');
    const accessibleLabel = accessibleLabelText(this);
    const value = this.getAttribute('value') ?? '';
    const parsedValue = parseColor(value);
    if (parsedValue && !this.customDraftActive) {
      this.canonicalColor = parsedValue;
    }
    const format = normalizeFromList(this.getAttribute('format'), nodelColorFormats, 'hex') as NodelColorFormat;
    const liveInterval = this.liveInterval();
    const customWrap = this.querySelector<HTMLElement>('.nodel-palette-custom');
    const customLabel = this.querySelector<HTMLElement>('[data-custom-label]');
    const columns = normalizeColumns(this.getAttribute('columns'));

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.shape = shape;
    this.dataset.showLabels = showLabels;
    this.dataset.picker = picker;
    this.dataset.valueField = valueField;
    this.dataset.disabled = String(disabled);
    this.dataset.value = value;
    this.dataset.format = format;
    this.dataset.live = String(this.hasAttribute('live'));
    this.dataset.liveInterval = String(liveInterval);
    if (columns !== null) {
      this.style.setProperty('--nodel-palette-columns', String(columns));
    } else {
      this.style.removeProperty('--nodel-palette-columns');
    }

    customWrap!.hidden = picker !== 'native';
    this.customValueLabel!.hidden = valueField === 'hidden';
    const customLabelText = this.getAttribute('custom-label') ?? '';
    customLabel!.hidden = !customLabelText;
    customLabel!.textContent = customLabelText;
    this.setAttribute('role', 'group');
    syncHostAccessibleLabel(this);
    this.customNode!.setAttribute('aria-label', customLabelText || (accessibleLabel ? `${accessibleLabel} custom colour` : 'Custom colour'));
    this.customNode!.disabled = disabled;
    this.customValueNode!.disabled = disabled;
    this.customValueNode!.readOnly = valueField !== 'editable';
    if (valueField !== 'editable' && this.customInvalid) {
      this.customInvalid = false;
      this.customDraftActive = false;
    }
    this.customButton!.disabled = disabled || this.customInvalid;
    this.customValueNode!.setAttribute('aria-invalid', String(this.customInvalid));
    this.customErrorNode!.hidden = !this.customInvalid;
    const canonicalHex = formatColor(this.canonicalColor, 'hex');
    this.customNode!.value = canonicalHex.slice(0, 7);
    if ((document.activeElement !== this.customValueNode || valueField !== 'editable') && !this.customInvalid) {
      this.customValueNode!.value = formatColor(this.canonicalColor, format);
    }
    this.style.setProperty('--nodel-palette-custom', canonicalHex);

    for (const option of this.options()) {
      const optionValue = this.optionValue(option);
      const color = this.optionColor(option);
      const active = value !== '' && (optionValue === value || colorsEqual(parseColor(optionValue), parsedValue));
      option.dataset.paletteOption = '';
      option.dataset.paletteSwatch = color ? 'true' : 'false';
      option.setAttribute('size', option.getAttribute('size') ?? 'md');
      option.style.setProperty('--nodel-palette-swatch', color || 'transparent');
      if (option.getAttribute('border')) {
        option.style.setProperty('--nodel-palette-swatch-border', option.getAttribute('border') ?? '');
      }
      syncInheritedAttributes(option, this.inheritedOptionAttributes, active, { variant, tone });
      if (active) {
        option.setAttribute('active', '');
      } else {
        option.removeAttribute('active');
      }
      if (disabled) {
        option.setAttribute('aria-disabled', 'true');
      } else {
        option.removeAttribute('aria-disabled');
      }
    }
  }

  private async selectValue(nextRawValue: string, source: HTMLElement = this, phase: PaletteActionPhase = 'select') {
    if (this.hasAttribute('disabled')) {
      return;
    }
    const token = ++this.selectionToken;
    const currentValue = this.getAttribute('value') ?? '';
    const parsed = parseColor(nextRawValue);
    const canonicalValue = parsed ? formatColor(parsed, 'hex') : nextRawValue;
    const sameValue = currentValue === nextRawValue || colorsEqual(parseColor(currentValue), parsed);
    const nextValue = sameValue && this.hasAttribute('allow-deselect') ? '' : canonicalValue;
    const argType = normalizeFromList(this.getAttribute('arg-type'), argTypes, 'string');
    const format = normalizeFromList(this.getAttribute('format'), nodelColorFormats, 'hex') as NodelColorFormat;
    const payloadResult = parsed && nextValue
      ? { ok: true as const, payload: { arg: formatColor(parsed, format) }, arg: formatColor(parsed, format) }
      : buildActionPayload(nextValue, argType);
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: phase === 'select' ? 'select' : 'commit' });
    const action = actionName(bindings, this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '');
    if (!payloadResult.ok) {
      dispatchControlActionError(this, { eventName: 'nodel-palette-error', action, phase, value: nextValue, payload: {}, committed: phase !== 'live', live: phase === 'live', error: payloadResult.error });
      return;
    }
    const payload = payloadResult.payload;
    const confirmSource = shouldConfirm(source) ? source : this;

    if (phase === 'live' && shouldConfirm(confirmSource)) {
      return;
    }

    if (phase !== 'live' && shouldConfirm(confirmSource)) {
      const confirmed = await requestConfirm(confirmSource, confirmRequestFromAttributes(confirmSource, { title: 'Confirm colour', text: `Select ${nextValue || 'colour'}?`, tone: 'info' }), source.querySelector('button') ?? this.customButton);
      if (!confirmed) {
        return;
      }
    }

    if (token !== this.selectionToken || !this.isConnected) {
      return;
    }

    if (bindings.length === 0) {
      this.customDraftActive = false;
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, phase, nextValue, payload);
      return;
    }

    try {
      const execution = await executeActionPhases(bindings, [phase], payload);
      if (token !== this.selectionToken || !this.isConnected) {
        return;
      }
      if (execution.failures.length > 0) {
        dispatchControlActionError(this, { eventName: 'nodel-palette-error', action, phase, value: nextValue, payload, arg: payloadResult.arg, committed: phase !== 'live', live: phase === 'live', failures: execution.failures });
        return;
      }
      this.customDraftActive = false;
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, phase, nextValue, payload, execution.results);
    } catch (error) {
      if (token !== this.selectionToken || !this.isConnected) {
        return;
      }
      dispatchControlActionError(this, { eventName: 'nodel-palette-error', action, phase, value: nextValue, payload, arg: payloadResult.arg, committed: phase !== 'live', live: phase === 'live', error: actionErrorMessage(error) });
    }
  }

  private dispatchChange(action: string, phase: PaletteActionPhase, value: string, payload: Record<string, unknown>, results: unknown[] = []) {
    this.dispatchEvent(new CustomEvent('nodel-palette-change', { bubbles: true, detail: { action, phase, phases: [phase], value, arg: payload.arg, payload, results, failures: [], committed: phase !== 'live', live: phase === 'live' } }));
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      'custom-color': (value) => this.applyCustomDraft(value, false),
      disabled: (value) => truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value),
      value: (value) => {
        this.customDraftActive = false;
        this.customInvalid = false;
        this.setAttribute('value', value);
      }
    }, { join: this.getAttribute('join'), aggregators: { disabled: { evaluate: truthy } } });
  }

  private optionFromEvent(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const option = target.closest<HTMLElement>('nodel-button');
    return option && option.parentElement === this.gridNode ? option : null;
  }

  private handleOptionClick = (event: Event) => {
    const option = this.optionFromEvent(event);
    if (!option) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.selectValue(this.optionValue(option), option);
  };

  private handleCustomInput = () => {
    if (!this.customNode) {
      return;
    }
    this.applyCustomDraft(this.customNode.value, true);
  };

  private handleCustomValueInput = () => {
    if (this.customValueNode && this.valueFieldMode() === 'editable') {
      this.applyCustomDraft(this.customValueNode.value, true);
    }
  };

  private handleCustomValueKeyDown = (event: KeyboardEvent) => {
    if (this.valueFieldMode() === 'editable' && event.key === 'Enter' && !this.customInvalid) {
      event.preventDefault();
      this.commitCustomValue();
    }
  };

  private handleCustomInteractionEnd = () => {
    if (this.hasAttribute('live') && !this.customInvalid) {
      this.commitCustomValue();
    } else {
      this.flushLiveSelection();
    }
  };

  private handleCustomSelect = () => {
    const nativeValue = !this.customDraftActive && this.customNode ? parseColor(this.customNode.value) : null;
    if (nativeValue) {
      this.canonicalColor = nativeValue;
      this.customInvalid = false;
    }
    if (!this.customInvalid) {
      if (this.hasAttribute('live')) {
        this.commitCustomValue();
      } else {
        void this.selectValue(formatColor(this.canonicalColor, 'hex'), this.customButton ?? this);
      }
    }
  };

  private applyCustomDraft(value: string, scheduleLive: boolean) {
    const parsed = parseColor(value);
    if (!parsed) {
      this.customInvalid = true;
      this.syncCustomValidation();
      return;
    }
    this.customInvalid = false;
    this.customDraftActive = true;
    this.canonicalColor = parsed;
    const format = normalizeFromList(this.getAttribute('format'), nodelColorFormats, 'hex') as NodelColorFormat;
    const canonicalHex = formatColor(parsed, 'hex');
    if (this.customNode) {
      this.customNode.value = canonicalHex.slice(0, 7);
    }
    if (this.customValueNode && document.activeElement !== this.customValueNode) {
      this.customValueNode.value = formatColor(parsed, format);
    }
    this.style.setProperty('--nodel-palette-custom', canonicalHex);
    this.syncCustomValidation();
    if (scheduleLive && this.hasAttribute('live')) {
      this.scheduleLiveSelection(canonicalHex, this.customButton ?? this);
    }
  }

  private commitCustomValue() {
    this.flushLiveSelection();
    void this.selectValue(formatColor(this.canonicalColor, 'hex'), this.customButton ?? this, 'commit');
  }

  private liveInterval() {
    const parsed = Number.parseInt(this.getAttribute('live-interval') ?? '', 10);
    return Number.isFinite(parsed) ? Math.min(maximumLiveInterval, Math.max(minimumLiveInterval, parsed)) : defaultLiveInterval;
  }

  private valueFieldMode() {
    return normalizeFromList(this.getAttribute('value-field'), valueFieldModes, 'readonly');
  }

  private syncCustomValidation() {
    this.customValueNode?.setAttribute('aria-invalid', String(this.customInvalid));
    if (this.customErrorNode) {
      this.customErrorNode.hidden = !this.customInvalid;
    }
    if (this.customButton) {
      this.customButton.disabled = this.hasAttribute('disabled') || this.customInvalid;
    }
  }

  private scheduleLiveSelection(value: string, source: HTMLElement) {
    this.pendingLiveSelection = { value, source };
    const remaining = Math.max(0, this.liveInterval() - (Date.now() - this.lastLiveDispatchAt));
    if (remaining === 0 && this.liveTimer === null) {
      this.dispatchPendingLiveSelection();
      return;
    }
    if (this.liveTimer === null) {
      this.liveTimer = window.setTimeout(() => {
        this.liveTimer = null;
        this.dispatchPendingLiveSelection();
      }, remaining);
    }
  }

  private dispatchPendingLiveSelection() {
    const pending = this.pendingLiveSelection;
    if (!pending) {
      return;
    }
    this.pendingLiveSelection = null;
    this.lastLiveDispatchAt = Date.now();
    void this.selectValue(pending.value, pending.source, 'live');
  }

  private flushLiveSelection() {
    if (this.liveTimer !== null) {
      window.clearTimeout(this.liveTimer);
      this.liveTimer = null;
    }
    this.dispatchPendingLiveSelection();
  }

  private cancelLiveSelection() {
    if (this.liveTimer !== null) {
      window.clearTimeout(this.liveTimer);
      this.liveTimer = null;
    }
    this.pendingLiveSelection = null;
  }
}

if (!customElements.get('nodel-palette')) {
  customElements.define('nodel-palette', NodelPalette);
}
