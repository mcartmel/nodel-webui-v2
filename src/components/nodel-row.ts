export class NodelRow extends HTMLElement {
  private shellReady = false;
  private rowNode: HTMLElement | null = null;

  connectedCallback() {
    this.render();
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.innerHTML = `
        <div data-row class="grid grid-cols-12 gap-4"></div>
      `;
      this.rowNode = this.querySelector('[data-row]');
      this.shellReady = true;
      if (this.rowNode) {
        for (const child of children) {
          this.rowNode.appendChild(child);
        }
      }
    }
  }
}

if (!customElements.get('nodel-row')) {
  customElements.define('nodel-row', NodelRow);
}
