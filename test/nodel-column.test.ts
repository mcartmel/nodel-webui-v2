import '../src/components/nodel-row';
import '../src/components/nodel-column';

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
    const column = document.querySelectorAll<HTMLElement>('nodel-column')[1];

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
});
