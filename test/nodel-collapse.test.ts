import { flush } from './helpers';
import '../src/components/nodel-collapse';

describe('nodel-collapse', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mount(markup: string) {
    document.body.innerHTML = markup;
    await customElements.whenDefined('nodel-collapse');
    await flush();
    return document.querySelector('nodel-collapse') as HTMLElement;
  }

  it('renders collapsed by default and preserves child content', async () => {
    const element = await mount('<nodel-collapse label="Recipe"><p id="content">Editor</p></nodel-collapse>');
    const details = element.querySelector('details') as HTMLDetailsElement;

    expect(details.open).toBe(false);
    expect(element.hasAttribute('open')).toBe(false);
    expect(element.querySelector('[data-collapse-label]')?.textContent).toBe('Recipe');
    expect(element.querySelector('#content')?.textContent).toBe('Editor');
  });

  it('renders expanded when open is present', async () => {
    const element = await mount('<nodel-collapse label="Diagnostics" open><span>Details</span></nodel-collapse>');
    const details = element.querySelector('details') as HTMLDetailsElement;

    expect(details.open).toBe(true);
    expect(element.hasAttribute('open')).toBe(true);
  });

  it('reflects native toggle state to the host and dispatches an event', async () => {
    const element = await mount('<nodel-collapse label="Recipe"><span>Details</span></nodel-collapse>');
    const details = element.querySelector('details') as HTMLDetailsElement;
    const toggled = vi.fn();
    element.addEventListener('nodel-collapse-toggle', toggled);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await flush();

    expect(element.hasAttribute('open')).toBe(true);
    expect(toggled).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { open: true } }));

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    await flush();

    expect(element.hasAttribute('open')).toBe(false);
    expect(toggled).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { open: false } }));
  });

  it('updates the summary label when the label attribute changes', async () => {
    const element = await mount('<nodel-collapse label="Recipe"><span>Details</span></nodel-collapse>');

    element.setAttribute('label', 'Source');
    await flush();

    expect(element.querySelector('[data-collapse-label]')?.textContent).toBe('Source');
  });

  it('renders and updates static preview text', async () => {
    const element = await mount('<nodel-collapse label="Console" preview="No output"><span>Details</span></nodel-collapse>');
    const preview = element.querySelector<HTMLElement>('[data-collapse-preview]')!;

    expect(preview.textContent).toBe('No output');
    expect(preview.hidden).toBe(false);

    element.setAttribute('preview', 'Ready');
    await flush();

    expect(preview.textContent).toBe('Ready');
  });

  it('updates preview from descendant preview events as plain text', async () => {
    const element = await mount('<nodel-collapse label="Console"><span id="provider">Details</span></nodel-collapse>');
    const provider = element.querySelector('#provider')!;
    const preview = element.querySelector<HTMLElement>('[data-collapse-preview]')!;

    provider.dispatchEvent(new CustomEvent('nodel-collapse-preview', {
      bubbles: true,
      detail: { text: 'bad <value>' }
    }));
    await flush();

    expect(preview.textContent).toBe('bad <value>');
    expect(preview.innerHTML).toBe('bad &lt;value&gt;');
    expect(preview.hidden).toBe(false);
  });

  it('does not leak nested collapse preview events to an outer collapse', async () => {
    const outer = await mount(`
      <nodel-collapse label="Outer" preview="Outer preview">
        <nodel-collapse label="Inner">
          <span id="provider">Details</span>
        </nodel-collapse>
      </nodel-collapse>
    `);
    const inner = outer.querySelector('nodel-collapse')!;
    const provider = inner.querySelector('#provider')!;

    provider.dispatchEvent(new CustomEvent('nodel-collapse-preview', {
      bubbles: true,
      detail: { text: 'Inner preview' }
    }));
    await flush();

    expect(outer.querySelector('[data-collapse-preview]')?.textContent).toBe('Outer preview');
    expect(inner.querySelector('[data-collapse-preview]')?.textContent).toBe('Inner preview');
  });
});
