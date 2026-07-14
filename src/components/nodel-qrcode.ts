import { create, type QRCode } from 'qrcode';
import { createSignalBindingController } from '../data/signal-bindings';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_SIZE = 128;
const MIN_SIZE = 64;
const MAX_SIZE = 1024;
const QUIET_ZONE_MODULES = 4;
const ERROR_MESSAGE = 'QR code unavailable';

let qrcodeIdCounter = 0;

function normalizeSize(value: string | null) {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return DEFAULT_SIZE;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SIZE;
  }

  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(parsed)));
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(name: K) {
  return document.createElementNS(SVG_NAMESPACE, name);
}

export class NodelQRCode extends HTMLElement {
  static observedAttributes = ['value', 'size', 'help', 'label', 'aria-label', 'aria-labelledby', 'signal', 'signals'];

  private connected = false;
  private shellReady = false;
  private svgNode: SVGSVGElement | null = null;
  private pathNode: SVGPathElement | null = null;
  private helpNode: HTMLElement | null = null;
  private errorNode: HTMLElement | null = null;
  private helpId = '';
  private errorId = '';
  private encodedValue: string | null = null;
  private matrix: QRCode | null = null;
  private state: 'empty' | 'ready' | 'error' = 'empty';
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.connected = true;
    this.ensureShell();
    this.syncSignalSubscription();
    this.renderValue(true);
    this.renderMetadata();
  }

  disconnectedCallback() {
    this.connected = false;
    this.signalBindings.dispose();
  }

  attributeChangedCallback(name: string) {
    if (!this.connected) {
      return;
    }

    if (name === 'signal' || name === 'signals') {
      this.syncSignalSubscription();
    }

    if (name === 'value') {
      this.renderValue();
    } else if (name === 'size') {
      this.renderValue();
      this.renderMetadata();
    } else {
      this.renderMetadata();
    }
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    this.helpId = `nodel-qrcode-help-${++qrcodeIdCounter}`;
    this.errorId = `nodel-qrcode-error-${qrcodeIdCounter}`;

    const frame = document.createElement('div');
    frame.className = 'nodel-qrcode-frame';

    this.svgNode = createSvgElement('svg');
    this.svgNode.classList.add('nodel-qrcode-svg');
    frame.appendChild(this.svgNode);

    this.helpNode = document.createElement('div');
    this.helpNode.className = 'nodel-qrcode-help';
    this.helpNode.id = this.helpId;
    this.helpNode.hidden = true;

    this.errorNode = document.createElement('div');
    this.errorNode.className = 'nodel-qrcode-error';
    this.errorNode.id = this.errorId;
    this.errorNode.setAttribute('role', 'status');
    this.errorNode.setAttribute('aria-live', 'polite');
    this.errorNode.hidden = true;

    this.replaceChildren(frame, this.helpNode, this.errorNode);
    this.shellReady = true;
  }

  private renderValue(force = false) {
    this.ensureShell();
    const value = this.getAttribute('value') ?? '';
    const size = normalizeSize(this.getAttribute('size'));
    this.dataset.size = String(size);
    this.style.setProperty('--nodel-qrcode-size', `${size}px`);

    if (!force && value === this.encodedValue) {
      this.renderMatrix(size);
      return;
    }

    this.encodedValue = value;
    this.matrix = null;

    if (value === '') {
      this.state = 'empty';
      this.renderMatrix(size);
      this.renderMetadata();
      return;
    }

    try {
      this.matrix = create(value, { errorCorrectionLevel: 'H' });
      this.state = 'ready';
    } catch {
      this.state = 'error';
      this.dispatchEvent(new CustomEvent('nodel-qrcode-error', {
        bubbles: true,
        detail: { message: ERROR_MESSAGE, reason: 'encoding-failed' }
      }));
    }

    this.renderMatrix(size);
    this.renderMetadata();
  }

  private renderMatrix(size: number) {
    if (!this.svgNode) {
      return;
    }

    const moduleCount = this.matrix?.modules.size ?? 0;
    const viewBoxSize = moduleCount + QUIET_ZONE_MODULES * 2;
    this.svgNode.replaceChildren();
    this.svgNode.setAttribute('width', String(size));
    this.svgNode.setAttribute('height', String(size));
    this.svgNode.setAttribute('viewBox', `0 0 ${viewBoxSize || 1} ${viewBoxSize || 1}`);
    this.svgNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svgNode.setAttribute('shape-rendering', 'crispEdges');

    const background = createSvgElement('rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', 'white');
    this.svgNode.appendChild(background);

    this.pathNode = null;
    if (!this.matrix) {
      return;
    }

    const path = createSvgElement('path');
    const commands: string[] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        if (this.matrix.modules.get(row, column)) {
          const x = column + QUIET_ZONE_MODULES;
          const y = row + QUIET_ZONE_MODULES;
          commands.push(`M${x} ${y}h1v1h-1z`);
        }
      }
    }
    path.setAttribute('d', commands.join(' '));
    path.setAttribute('fill', 'black');
    path.setAttribute('stroke', 'none');
    this.svgNode.appendChild(path);
    this.pathNode = path;
  }

  private renderMetadata() {
    if (!this.svgNode || !this.helpNode || !this.errorNode) {
      return;
    }

    const label = this.getAttribute('label') ?? '';
    const explicitAriaLabel = this.getAttribute('aria-label');
    const labelledBy = this.getAttribute('aria-labelledby');
    const help = this.getAttribute('help') ?? '';
    const hasHelp = help !== '';

    this.dataset.state = this.state;
    this.helpNode.textContent = help;
    this.helpNode.hidden = !hasHelp;
    this.errorNode.textContent = this.state === 'error' ? ERROR_MESSAGE : '';
    this.errorNode.hidden = this.state !== 'error';

    this.svgNode.setAttribute('role', 'img');
    if (labelledBy) {
      this.svgNode.setAttribute('aria-labelledby', labelledBy);
      this.svgNode.removeAttribute('aria-label');
    } else {
      this.svgNode.removeAttribute('aria-labelledby');
      this.svgNode.setAttribute('aria-label', explicitAriaLabel || label || 'QR code');
    }

    if (hasHelp) {
      this.svgNode.setAttribute('aria-describedby', this.helpId);
    } else {
      this.svgNode.removeAttribute('aria-describedby');
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => this.setSignalAttribute('value', value),
      help: (value) => this.setSignalAttribute('help', value),
      label: (value) => this.setSignalAttribute('label', value)
    });
  }

  private setSignalAttribute(name: 'value' | 'help' | 'label', value: string) {
    if (name === 'value') {
      this.setAttribute(name, value);
    } else if (value) {
      this.setAttribute(name, value);
    } else {
      this.removeAttribute(name);
    }
  }
}

if (!customElements.get('nodel-qrcode')) {
  customElements.define('nodel-qrcode', NodelQRCode);
}
