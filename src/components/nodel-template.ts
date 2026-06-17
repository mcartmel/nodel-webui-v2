const maxRepeat = 200;
const placeholderPattern = /{{\s*([A-Za-z0-9_-]+)\s*}}/g;

function clampRepeat(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(maxRepeat, Math.max(0, Math.trunc(value)));
}

function parseRepeat(value: string | null) {
  if (value === null) {
    return 1;
  }

  return clampRepeat(Number(value));
}

function parseNumberAttribute(value: string | null, fallback: number) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function kebabToCamel(value: string) {
  return value.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function replacePlaceholders(value: string, context: Record<string, string>) {
  return value.replace(placeholderPattern, (match, key: string) => context[key] ?? match);
}

function applyContext(node: Node, context: Record<string, string>) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const current = walker.currentNode;

    if (current.nodeType === Node.TEXT_NODE) {
      current.textContent = replacePlaceholders(current.textContent ?? '', context);
      continue;
    }

    if (current instanceof Element) {
      for (const attribute of Array.from(current.attributes)) {
        current.setAttribute(attribute.name, replacePlaceholders(attribute.value, context));
      }
    }
  }
}

export class NodelTemplate extends HTMLElement {
  private mutationObserver: MutationObserver | null = null;
  private renderedNodes: Node[] = [];
  private renderQueued = false;

  connectedCallback() {
    this.queueRender();
    this.mutationObserver = new MutationObserver(() => this.queueRender());
    this.mutationObserver.observe(this, {
      attributes: true,
      childList: true,
      subtree: false
    });
  }

  disconnectedCallback() {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.clearRenderedNodes();
  }

  private queueRender() {
    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (this.isConnected) {
        this.render();
      }
    });
  }

  private render() {
    this.clearRenderedNodes();
    const template = this.templateElement();
    const parent = this.parentNode;

    if (!template || !parent) {
      return;
    }

    const repeat = parseRepeat(this.getAttribute('repeat'));
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < repeat; index += 1) {
      const clone = template.content.cloneNode(true) as DocumentFragment;
      applyContext(clone, this.templateContext(index, repeat));
      fragment.appendChild(clone);
    }

    this.renderedNodes = Array.from(fragment.childNodes);
    parent.insertBefore(fragment, this.nextSibling);
    this.dispatchEvent(new CustomEvent('nodel-template-rendered', {
      bubbles: true,
      detail: { repeat }
    }));
  }

  private clearRenderedNodes() {
    for (const node of this.renderedNodes) {
      node.parentNode?.removeChild(node);
    }
    this.renderedNodes = [];
  }

  private templateElement() {
    const templateId = this.getAttribute('template')?.trim();
    if (templateId) {
      const resolved = document.getElementById(templateId.replace(/^#/, ''));
      return resolved instanceof HTMLTemplateElement ? resolved : null;
    }

    return Array.from(this.children).find((child): child is HTMLTemplateElement => child instanceof HTMLTemplateElement) ?? null;
  }

  private templateContext(index: number, repeat: number): Record<string, string> {
    const start = parseNumberAttribute(this.getAttribute('start'), 1);
    const step = parseNumberAttribute(this.getAttribute('step'), 1);
    const number = start + index * step;
    const formattedNumber = formatNumber(number);
    const name = this.getAttribute('name') ?? '';
    const context: Record<string, string> = {
      index: String(index),
      number: formattedNumber,
      name,
      item: `${name}${formattedNumber}`,
      repeat: String(repeat)
    };

    for (const attribute of Array.from(this.attributes)) {
      if (!attribute.name.startsWith('data-')) {
        continue;
      }

      const key = attribute.name.slice(5);
      context[key] = attribute.value;
      context[kebabToCamel(key)] = attribute.value;
    }

    return context;
  }
}

if (!customElements.get('nodel-template')) {
  customElements.define('nodel-template', NodelTemplate);
}
