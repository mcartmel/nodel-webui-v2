import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { accessibleLabelText, syncHostAccessibleLabel } from '../utils/accessibility';
import { apiErrorMessage, formatBindingFailures, normalizeFromList, normalizeTone, normalizeVariant, parseTypedArg, truthy } from '../utils/control-values';
import './nodel-button';

type PaletteShape = 'square' | 'rounded' | 'circle';
type PaletteLabels = 'auto' | 'show' | 'hide';
type PalettePicker = 'off' | 'native';
type PaletteArgType = 'string' | 'json';

const shapes: PaletteShape[] = ['square', 'rounded', 'circle'];
const labelModes: PaletteLabels[] = ['auto', 'show', 'hide'];
const pickerModes: PalettePicker[] = ['off', 'native'];
const argTypes: PaletteArgType[] = ['string', 'json'];

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
  static observedAttributes = ['label', 'aria-label', 'aria-labelledby', 'value', 'action', 'actions', 'join', 'arg-type', 'columns', 'shape', 'picker', 'format', 'custom-label', 'show-labels', 'allow-deselect', 'variant', 'tone', 'disabled', 'signal', 'signals', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'];

  private shellReady = false;
  private gridNode: HTMLElement | null = null;
  private customNode: HTMLInputElement | null = null;
  private customButton: HTMLButtonElement | null = null;
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleOptionClick, true);
    this.customNode?.addEventListener('input', this.handleCustomInput);
    this.customButton?.addEventListener('click', this.handleCustomSelect);
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.removeEventListener('click', this.handleOptionClick, true);
    this.customNode?.removeEventListener('input', this.handleCustomInput);
    this.customButton?.removeEventListener('click', this.handleCustomSelect);
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
          <button type="button" class="nodel-palette-custom-button">Select</button>
        </div>
      </div>
    `;
    this.gridNode = this.querySelector('.nodel-palette-grid');
    this.customNode = this.querySelector('.nodel-palette-custom-input');
    this.customButton = this.querySelector('.nodel-palette-custom-button');
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
    const disabled = this.hasAttribute('disabled');
    const accessibleLabel = accessibleLabelText(this);
    const value = this.getAttribute('value') ?? '';
    const customWrap = this.querySelector<HTMLElement>('.nodel-palette-custom');
    const customLabel = this.querySelector<HTMLElement>('[data-custom-label]');
    const columns = normalizeColumns(this.getAttribute('columns'));

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.shape = shape;
    this.dataset.showLabels = showLabels;
    this.dataset.picker = picker;
    this.dataset.disabled = String(disabled);
    this.dataset.value = value;
    if (columns !== null) {
      this.style.setProperty('--nodel-palette-columns', String(columns));
    } else {
      this.style.removeProperty('--nodel-palette-columns');
    }

    customWrap!.hidden = picker !== 'native';
    const customLabelText = this.getAttribute('custom-label') ?? '';
    customLabel!.hidden = !customLabelText;
    customLabel!.textContent = customLabelText;
    this.setAttribute('role', 'group');
    syncHostAccessibleLabel(this);
    this.customNode!.setAttribute('aria-label', customLabelText || (accessibleLabel ? `${accessibleLabel} custom colour` : 'Custom colour'));
    this.customNode!.disabled = disabled;
    this.customButton!.disabled = disabled;

    for (const option of this.options()) {
      const optionValue = this.optionValue(option);
      const color = this.optionColor(option);
      const active = value !== '' && optionValue === value;
      option.dataset.paletteOption = '';
      option.dataset.paletteSwatch = color ? 'true' : 'false';
      option.setAttribute('size', option.getAttribute('size') ?? 'md');
      option.style.setProperty('--nodel-palette-swatch', color || 'transparent');
      if (option.getAttribute('border')) {
        option.style.setProperty('--nodel-palette-swatch-border', option.getAttribute('border') ?? '');
      }
      if (active) {
        option.setAttribute('active', '');
        option.setAttribute('variant', option.getAttribute('variant') ?? variant);
        option.setAttribute('tone', option.getAttribute('tone') ?? tone);
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

  private async selectValue(nextRawValue: string, source: HTMLElement = this) {
    if (this.hasAttribute('disabled')) {
      return;
    }
    const currentValue = this.getAttribute('value') ?? '';
    const nextValue = currentValue === nextRawValue && this.hasAttribute('allow-deselect') ? '' : nextRawValue;
    const argType = normalizeFromList(this.getAttribute('arg-type'), argTypes, 'string');
    const payload = { arg: parseTypedArg(nextValue, argType) };
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'select' });
    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';
    const confirmSource = shouldConfirm(source) ? source : this;

    if (shouldConfirm(confirmSource)) {
      const confirmed = await requestConfirm(confirmSource, confirmRequestFromAttributes(confirmSource, { title: 'Confirm colour', text: `Select ${nextValue || 'colour'}?`, tone: 'info' }));
      if (!confirmed) {
        return;
      }
    }

    if (bindings.length === 0) {
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, nextValue, payload);
      return;
    }

    try {
      const execution = await callActionBindings(bindings, 'select', payload);
      if (execution.failures.length > 0) {
        const detail = formatBindingFailures(execution.failures);
        this.dispatchEvent(new CustomEvent('nodel-palette-error', { bubbles: true, detail: { action, value: nextValue, payload, failures: execution.failures, error: detail } }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, nextValue, payload, execution.results);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-palette-error', { bubbles: true, detail: { action, value: nextValue, payload, error: message } }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    }
  }

  private dispatchChange(action: string, value: string, payload: { arg: unknown }, results: unknown[] = []) {
    this.dispatchEvent(new CustomEvent('nodel-palette-change', { bubbles: true, detail: { action, value, arg: payload.arg, payload, results } }));
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      'custom-color': (value) => { if (this.customNode && /^#[0-9a-f]{6}$/i.test(value)) this.customNode.value = value; },
      disabled: (value) => truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value),
      value: (value) => this.setAttribute('value', value)
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

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, { bubbles: true, detail }));
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
    if (this.customNode) {
      this.style.setProperty('--nodel-palette-custom', this.customNode.value);
    }
  };

  private handleCustomSelect = () => {
    if (this.customNode) {
      void this.selectValue(this.customNode.value, this.customButton ?? this);
    }
  };
}

if (!customElements.get('nodel-palette')) {
  customElements.define('nodel-palette', NodelPalette);
}
