import '../src/components/nodel-app';

describe('theme synchronization', () => {
  beforeEach(() => {
    document.body.innerHTML = '<nodel-app title="Nodel"></nodel-app>';
  });

  it('defaults to light theme when no theme attribute is set', async () => {
    await customElements.whenDefined('nodel-app');
    await Promise.resolve();

    const app = document.querySelector('nodel-app') as HTMLElement | null;
    expect(app?.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reflects dark theme changes to the document root', async () => {
    await customElements.whenDefined('nodel-app');
    await Promise.resolve();

    const app = document.querySelector('nodel-app') as HTMLElement | null;
    app?.setAttribute('theme', 'dark');
    await Promise.resolve();

    expect(app?.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
