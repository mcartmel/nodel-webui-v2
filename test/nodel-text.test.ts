import '../src/components/nodel-text';

describe('nodel-text', () => {
  beforeEach(() => {
    document.body.innerHTML = '<nodel-text>Default text</nodel-text>';
  });

  it('renders default body text styling state', async () => {
    await customElements.whenDefined('nodel-text');
    await Promise.resolve();

    const text = document.querySelector('nodel-text') as HTMLElement;
    expect(text.dataset.tone).toBe('muted');
    expect(text.dataset.size).toBe('sm');
    expect(text.dataset.surface).toBe('none');
    expect(text.style.getPropertyValue('--nodel-text-color')).toContain('rgb(var(--nodel-muted))');
    expect(text.textContent).toContain('Default text');
  });

  it('applies card surface and custom tone/size', async () => {
    document.body.innerHTML = '<nodel-text tone="accent" size="lg" surface="card">Card text</nodel-text>';
    await customElements.whenDefined('nodel-text');
    await Promise.resolve();

    const text = document.querySelector('nodel-text') as HTMLElement;
    expect(text.dataset.tone).toBe('accent');
    expect(text.dataset.size).toBe('lg');
    expect(text.dataset.surface).toBe('card');
    expect(text.style.getPropertyValue('--nodel-text-padding')).toBe('1rem');
    expect(text.style.getPropertyValue('--nodel-text-background')).toContain('rgb(var(--nodel-surface))');
  });
});
