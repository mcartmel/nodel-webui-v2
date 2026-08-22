import '../src/components/nodel-row';
import '../src/components/nodel-column';
import '../src/components/nodel-page';
import { flush } from './helpers';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test fixture value');
  return value;
}

describe('nodel-column responsive spans', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nodel-row>
        <nodel-column span="12" sm="6" md="4" lg="3" xl="2" 2xl="1">
          <p>Responsive column</p>
        </nodel-column>
      </nodel-row>
    `;
  });

  it('sets CSS variables for Tailwind-style responsive spans', async () => {
    await customElements.whenDefined('nodel-column');
    await Promise.resolve();

    const column = document.querySelector('nodel-column') as HTMLElement;

    expect(column.dataset.span).toBe('12');
    expect(column.getAttribute('data-sm')).toBe('6');
    expect(column.getAttribute('data-md')).toBe('4');
    expect(column.getAttribute('data-lg')).toBe('3');
    expect(column.getAttribute('data-xl')).toBe('2');
    expect(column.getAttribute('data-2xl')).toBe('1');
    expect(column.style.getPropertyValue('--nodel-column-span')).toBe('12');
    expect(column.style.getPropertyValue('--nodel-column-sm')).toBe('6');
    expect(column.style.getPropertyValue('--nodel-column-md')).toBe('4');
    expect(column.style.getPropertyValue('--nodel-column-lg')).toBe('3');
    expect(column.style.getPropertyValue('--nodel-column-xl')).toBe('2');
    expect(column.style.getPropertyValue('--nodel-column-2xl')).toBe('1');
  });

  it('updates and removes breakpoint spans when attributes change', async () => {
    await customElements.whenDefined('nodel-column');
    await Promise.resolve();

    const column = document.querySelector('nodel-column') as HTMLElement;
    column.setAttribute('md', '8');
    column.removeAttribute('lg');

    expect(column.getAttribute('data-md')).toBe('8');
    expect(column.style.getPropertyValue('--nodel-column-md')).toBe('8');
    expect(column.hasAttribute('data-lg')).toBe(false);
    expect(column.style.getPropertyValue('--nodel-column-lg')).toBe('');
  });

  it('sets bounded responsive order variables and removes them when omitted', async () => {
    document.body.insertAdjacentHTML('beforeend', '<nodel-column order="-2" sm-order="3" md-order="99" 2xl-order="-99">Ordered</nodel-column>');
    const column = required(document.querySelectorAll<HTMLElement>('nodel-column')[1]);

    expect(column.style.getPropertyValue('--nodel-column-order')).toBe('-2');
    expect(column.style.getPropertyValue('--nodel-column-sm-order')).toBe('3');
    expect(column.style.getPropertyValue('--nodel-column-md-order')).toBe('12');
    expect(column.style.getPropertyValue('--nodel-column-2xl-order')).toBe('-12');
    expect(column.getAttribute('data-md-order')).toBe('12');

    column.removeAttribute('sm-order');
    column.setAttribute('lg-order', 'invalid');
    expect(column.style.getPropertyValue('--nodel-column-sm-order')).toBe('');
    expect(column.style.getPropertyValue('--nodel-column-lg-order')).toBe('');
  });

  it('preserves source-order defaults when order attributes are omitted', () => {
    const column = document.querySelector('nodel-column') as HTMLElement;
    expect(column.style.getPropertyValue('--nodel-column-order')).toBe('');
    expect(column.hasAttribute('data-order')).toBe(false);
  });

  it.each(['nodel-group', 'nodel-control-grid'])('activates for a sole filled %s', async (tagName) => {
    document.body.innerHTML = `<nodel-column><${tagName} fill></${tagName}></nodel-column>`;
    await flush();
    expect(document.querySelector('nodel-column')?.getAttribute('data-fill-child')).toBe('true');
  });

  it('preserves column fill arbitration through viewport page and row structure', async () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"><nodel-row><nodel-column><nodel-group fill></nodel-group></nodel-column></nodel-row></nodel-page>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    expect(column.getAttribute('data-fill-child')).toBe('true');
    expect((customElements.get('nodel-page') as typeof HTMLElement & { observedAttributes?: string[] }).observedAttributes ?? []).not.toContain('fill');
    expect((customElements.get('nodel-row') as typeof HTMLElement & { observedAttributes?: string[] }).observedAttributes ?? []).not.toContain('fill');
    expect((customElements.get('nodel-column') as typeof HTMLElement & { observedAttributes?: string[] }).observedAttributes ?? []).not.toContain('fill');
  });

  it('keeps fill inactive when the sole child omits fill', async () => {
    document.body.innerHTML = '<nodel-column><nodel-group></nodel-group></nodel-column>';
    await flush();
    expect(document.querySelector('nodel-column')?.hasAttribute('data-fill-child')).toBe(false);
  });

  it('keeps fill inactive when omitted or when visible content competes', async () => {
    document.body.innerHTML = '<nodel-column><nodel-group fill></nodel-group><nodel-control-grid fill></nodel-control-grid></nodel-column>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    const group = column.querySelector<HTMLElement>('nodel-group')!;
    const grid = column.querySelector<HTMLElement>('nodel-control-grid')!;
    expect(column.hasAttribute('data-fill-child')).toBe(false);

    grid.hidden = true;
    await flush();
    expect(column.getAttribute('data-fill-child')).toBe('true');

    group.hidden = true;
    grid.hidden = false;
    await flush();
    expect(column.getAttribute('data-fill-child')).toBe('true');

    group.hidden = false;
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(false);
  });

  it('ignores comments and whitespace but rejects substantive text', async () => {
    document.body.innerHTML = '<nodel-column>\n  <!-- retained -->\n  <nodel-group fill></nodel-group>\n</nodel-column>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    expect(column.getAttribute('data-fill-child')).toBe('true');

    const whitespace = Array.from(column.querySelector('[data-column]')!.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE) as Text;
    whitespace.data = 'visible text';
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(false);

    whitespace.data = '  ';
    await flush();
    expect(column.getAttribute('data-fill-child')).toBe('true');
  });

  it('reacts to direct child, fill, and hidden changes', async () => {
    document.body.innerHTML = '<nodel-column><nodel-group fill></nodel-group></nodel-column>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    const group = column.querySelector('nodel-group')!;
    expect(column.hasAttribute('data-fill-child')).toBe(true);

    group.removeAttribute('fill');
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(false);
    group.setAttribute('fill', '');
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(true);

    (group as HTMLElement).hidden = true;
    const grid = document.createElement('nodel-control-grid');
    grid.setAttribute('fill', '');
    column.append(grid);
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(true);
  });

  it('normalizes public host additions and re-arbitrates after logical removal', async () => {
    document.body.innerHTML = '<nodel-column><nodel-group fill></nodel-group></nodel-column>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    const group = column.querySelector('nodel-group')!;
    const competing = document.createElement('nodel-button');
    column.prepend(competing);
    await flush();
    expect(column.querySelector('[data-column]')?.firstElementChild).toBe(competing);
    expect(column.hasAttribute('data-fill-child')).toBe(false);

    competing.remove();
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(true);
    expect(group.parentElement?.getAttribute('data-column')).not.toBeNull();
  });

  it('does not arbitrate nested mutations and disconnects on reconnect', async () => {
    document.body.innerHTML = '<nodel-column><nodel-group fill></nodel-group></nodel-column>';
    await flush();
    const column = document.querySelector('nodel-column')!;
    const group = column.querySelector('nodel-group')!;
    expect(column.hasAttribute('data-fill-child')).toBe(true);

    group.append(document.createElement('nodel-button'));
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(true);

    const parent = column.parentElement!;
    parent.removeChild(column);
    group.removeAttribute('fill');
    await flush();
    parent.append(column);
    await flush();
    expect(column.hasAttribute('data-fill-child')).toBe(false);
  });
});
