export class NodelPage extends HTMLElement {
  static observedAttributes = ['title'];

  private shellReady = false;
  private groupPage = false;
  private contentNode: HTMLElement | null = null;

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.groupPage = children.some(
        (child) => child instanceof HTMLElement && child.localName === 'nodel-page'
      );

      this.dataset.navGroupPage = String(this.groupPage);
      this.innerHTML = this.groupPage
        ? `<div data-page-content class="contents"></div>`
        : `
          <section data-page-content class="nodel-shell space-y-6 pb-6 pt-6">
          </section>
        `;
      this.contentNode = this.querySelector('[data-page-content]');
      this.shellReady = true;
      if (this.contentNode) {
        for (const child of children) {
          this.contentNode.appendChild(child);
        }
      }
    }
  }
}

if (!customElements.get('nodel-page')) {
  customElements.define('nodel-page', NodelPage);
}
