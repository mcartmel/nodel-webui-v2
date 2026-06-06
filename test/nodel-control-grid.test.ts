import '../src/components/nodel-control-grid';
import '../src/components/nodel-control-space';

describe('nodel-control-grid', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nodel-control-grid columns="3" sm="2" md="4" lg="6" xl="8" 2xl="10">
        <button>One</button>
        <nodel-control-space></nodel-control-space>
      </nodel-control-grid>
    `;
  });

  it('sets CSS variables for responsive control column counts', async () => {
    await customElements.whenDefined('nodel-control-grid');
    await Promise.resolve();

    const grid = document.querySelector('nodel-control-grid') as HTMLElement;

    expect(grid.dataset.columns).toBe('3');
    expect(grid.getAttribute('data-sm')).toBe('2');
    expect(grid.getAttribute('data-md')).toBe('4');
    expect(grid.getAttribute('data-lg')).toBe('6');
    expect(grid.getAttribute('data-xl')).toBe('8');
    expect(grid.getAttribute('data-2xl')).toBe('10');
    expect(grid.style.getPropertyValue('--nodel-control-grid-columns')).toBe('3');
    expect(grid.style.getPropertyValue('--nodel-control-grid-sm')).toBe('2');
    expect(grid.style.getPropertyValue('--nodel-control-grid-md')).toBe('4');
    expect(grid.style.getPropertyValue('--nodel-control-grid-lg')).toBe('6');
    expect(grid.style.getPropertyValue('--nodel-control-grid-xl')).toBe('8');
    expect(grid.style.getPropertyValue('--nodel-control-grid-2xl')).toBe('10');
  });

  it('updates, removes, and clamps column counts when attributes change', async () => {
    await customElements.whenDefined('nodel-control-grid');
    await Promise.resolve();

    const grid = document.querySelector('nodel-control-grid') as HTMLElement;
    grid.setAttribute('columns', '30');
    grid.setAttribute('md', '0');
    grid.removeAttribute('lg');

    expect(grid.dataset.columns).toBe('12');
    expect(grid.style.getPropertyValue('--nodel-control-grid-columns')).toBe('12');
    expect(grid.getAttribute('data-md')).toBe('1');
    expect(grid.style.getPropertyValue('--nodel-control-grid-md')).toBe('1');
    expect(grid.hasAttribute('data-lg')).toBe(false);
    expect(grid.style.getPropertyValue('--nodel-control-grid-lg')).toBe('');
  });

  it('marks control-space as an inert explicit grid slot', async () => {
    await customElements.whenDefined('nodel-control-space');
    await Promise.resolve();

    const space = document.querySelector('nodel-control-space') as HTMLElement;
    expect(space.getAttribute('aria-hidden')).toBe('true');
  });
});
