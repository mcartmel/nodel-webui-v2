import { flush, waitFor } from './helpers';

const descriptionApiMock = vi.hoisted(() => ({
  response: { name: 'Test Node', desc: '' as unknown },
  getNodeDetails: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeDetails: descriptionApiMock.getNodeDetails
}));

import '../src/components/nodel-description';

describe('nodel-description', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    descriptionApiMock.response = { name: 'Test Node', desc: '**Hello** [docs](docs.html)' };
    descriptionApiMock.getNodeDetails.mockImplementation(async () => descriptionApiMock.response);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(0), 0);
      return 1;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mount(markup = '<nodel-description></nodel-description>') {
    document.body.innerHTML = markup;
    await customElements.whenDefined('nodel-description');
    await waitFor(() => descriptionApiMock.getNodeDetails.mock.calls.length > 0);
    await flush();
    return document.querySelector('nodel-description') as HTMLElement;
  }

  function mockBodySize(element: HTMLElement, sizes: { clientHeight: number; scrollHeight: number }) {
    const body = element.querySelector('[data-description-body]') as HTMLElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: sizes.clientHeight });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: sizes.scrollHeight });
    return body;
  }

  it('renders the REST description as markdown', async () => {
    const element = await mount();

    expect(element.hidden).toBe(false);
    expect(element.querySelector('strong')?.textContent).toBe('Hello');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('docs.html');
    expect(descriptionApiMock.getNodeDetails).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('hides itself when the description is blank or missing', async () => {
    descriptionApiMock.response = { name: 'Test Node', desc: '   ' };

    const element = await mount();

    expect(element.hidden).toBe(true);
    expect(element.querySelector<HTMLButtonElement>('[data-description-toggle]')?.parentElement?.hidden).toBe(true);
  });

  it('sanitizes unsafe HTML while preserving safe description links', async () => {
    descriptionApiMock.response = {
      name: 'Test Node',
      desc: '<script>alert("bad")</script><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="index.html" target="_blank">ok</a>'
    };

    const element = await mount();
    const links = Array.from(element.querySelectorAll('a'));

    expect(element.querySelector('script')).toBeNull();
    expect(element.innerHTML).not.toContain('onclick');
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].getAttribute('href')).toBe('index.html');
    expect(links[1].getAttribute('target')).toBe('_blank');
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows the toggle only when content overflows and reflects expanded state', async () => {
    const element = await mount('<nodel-description collapsed-height="40px"></nodel-description>');
    mockBodySize(element, { clientHeight: 40, scrollHeight: 120 });

    element.setAttribute('collapsed-height', '41px');
    await flush();

    const button = element.querySelector<HTMLButtonElement>('[data-description-toggle]')!;
    expect(button.parentElement?.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Show more');
    expect(button.getAttribute('title')).toBe('Show more');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('.nodel-collapse-icon')).not.toBeNull();

    button.click();
    await flush();

    expect(element.hasAttribute('open')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Show less');
    expect(button.getAttribute('title')).toBe('Show less');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the toggle hidden for short descriptions', async () => {
    const element = await mount('<nodel-description collapsed-height="200px"></nodel-description>');
    mockBodySize(element, { clientHeight: 200, scrollHeight: 80 });

    element.setAttribute('collapsed-height', '201px');
    await flush();

    expect(element.querySelector<HTMLButtonElement>('[data-description-toggle]')?.parentElement?.hidden).toBe(true);
  });

  it('detects overflow from rendered body height instead of content height alone', async () => {
    const element = await mount('<nodel-description collapsed-height="128px"></nodel-description>');
    const content = element.querySelector('[data-description-content]') as HTMLElement;
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 120 });
    mockBodySize(element, { clientHeight: 128, scrollHeight: 132 });

    element.setAttribute('collapsed-height', '129px');
    await flush();

    expect(element.querySelector<HTMLButtonElement>('[data-description-toggle]')?.parentElement?.hidden).toBe(false);
  });
});
