export class NodelControlSpace extends HTMLElement {
  connectedCallback() {
    this.setAttribute('aria-hidden', 'true');
  }
}

if (!customElements.get('nodel-control-space')) {
  customElements.define('nodel-control-space', NodelControlSpace);
}
