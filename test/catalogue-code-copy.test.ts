import { enhanceCatalogueCodeCopy } from '../src/catalogue/code-copy';
import { copyTextToClipboard } from '../src/utils/clipboard';
import { faCopy } from '@fortawesome/free-regular-svg-icons';

function clipboardSetup() {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const execCommand = document.execCommand;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  return {
    writeText,
    restore: () => {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
      Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    }
  };
}

function block(text: string, attributes = '') {
  return `<pre class="nodel-catalogue-code" ${attributes}><code>${text}</code></pre>`;
}

describe('catalogue code copy controller', () => {
  const disposers: Array<() => void> = [];
  const clipboardRestores: Array<() => void> = [];
  beforeEach(() => { document.body.innerHTML = '<section><h2>Examples</h2></section>'; });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const restore of clipboardRestores.splice(0)) restore();
    document.body.innerHTML = '';
  });

  function setupController(root: ParentNode = document) {
    const dispose = enhanceCatalogueCodeCopy(root);
    disposers.push(dispose);
    return dispose;
  }

  function setupClipboard() {
    const setup = clipboardSetup();
    clipboardRestores.push(setup.restore);
    return setup;
  }

  async function expectQuiescence(mutate: () => void) {
    let deliveries = 0;
    let exceededBound = false;
    const monitor = new MutationObserver(() => {
      if (++deliveries > 30) {
        // A regressed microtask loop must fail, not starve Vitest's timeout.
        exceededBound = true;
        monitor.disconnect();
        for (const dispose of disposers) dispose();
      }
    });
    monitor.observe(document, { childList: true, subtree: true });
    try {
      mutate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const settledDeliveries = deliveries;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(exceededBound).toBe(false);
      expect(deliveries).toBe(settledDeliveries);
    } finally {
      monitor.disconnect();
    }
  }

  it('copies exact decoded code and excludes inline/reference/example code', async () => {
    const markup = '  &lt;nodel-button&gt;&amp; {{value}}&lt;/nodel-button&gt;\n';
    const text = '  <nodel-button>& {{value}}</nodel-button>\n';
    document.querySelector('section')!.insertAdjacentHTML('beforeend', block(markup));
    document.body.insertAdjacentHTML('beforeend', '<code>inline</code><table><tr><td><code>table</code></td></tr></table><div data-catalogue-example><pre class="nodel-catalogue-code"><code>preview</code></pre></div>');
    const clipboard = setupClipboard();
    setupController();
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    button.click();
    await Promise.resolve();
    expect(clipboard.writeText).toHaveBeenCalledWith(text);
    expect(document.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Copy code: Examples');
    expect(button.querySelector('svg[data-icon="copy"]')).not.toBeNull();
    expect(button.querySelector('svg[data-icon="copy"] path')?.getAttribute('d')).toBe(faCopy.icon[4]);
  });

  it('is idempotent, handles dynamic blocks and state changes independently', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('one'));
    setupController();
    const duplicateDispose = enhanceCatalogueCodeCopy();
    section.insertAdjacentHTML('beforeend', block('two', 'data-catalogue-copy-disabled'));
    await Promise.resolve();
    expect(document.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(2);
    const second = document.querySelectorAll<HTMLButtonElement>('[data-catalogue-copy-container] button')[1]!;
    expect(second.disabled).toBe(true);
    const firstCode = document.querySelector('pre code')!;
    firstCode.textContent = 'changed';
    await Promise.resolve();
    expect(document.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    duplicateDispose();
    expect(document.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(0);
    expect(firstCode.parentElement?.parentElement).toBe(section);
  });

  it('admits a newly eligible empty pre and keeps one working control through later mutations', async () => {
    const section = document.querySelector('section')!;
    const clipboard = setupClipboard();
    setupController();
    const pre = document.createElement('pre');
    pre.className = 'nodel-catalogue-code';
    section.append(pre);
    await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(0);

    const code = document.createElement('code');
    code.textContent = 'late source';
    pre.append(code);
    await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith('late source');

    code.textContent = 'changed source';
    await Promise.resolve();
    code.remove();
    await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    expect(section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')?.disabled).toBe(true);
    pre.append(code);
    await Promise.resolve();
    section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith('changed source');
  });

  it('reconciles cloned controller chrome while keeping the original and repeated clones functional', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('original payload'));
    const clipboard = setupClipboard();
    let resolveOriginal!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOriginal = resolve; }));
    setupController();
    const originalButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    originalButton.click();

    const clone = section.cloneNode(true) as HTMLElement;
    clone.querySelector('code')!.textContent = 'clone payload';
    document.body.append(clone);
    await Promise.resolve();
    const repeatedClone = clone.cloneNode(true) as HTMLElement;
    repeatedClone.querySelector('code')!.textContent = 'repeated clone payload';
    document.body.append(repeatedClone);
    await Promise.resolve();

    for (const current of [section, clone, repeatedClone]) {
      expect(current.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
      expect(current.querySelectorAll('[data-catalogue-copy-status]')).toHaveLength(1);
      expect(current.querySelectorAll('[data-catalogue-copy-container] button')).toHaveLength(1);
    }
    clone.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    repeatedClone.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(3);
    expect(clipboard.writeText.mock.calls.map(([text]) => text)).toEqual(['original payload', 'clone payload', 'repeated clone payload']);
    resolveOriginal();
    await Promise.resolve(); await Promise.resolve();
    originalButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(4);
    expect(clipboard.writeText).toHaveBeenLastCalledWith('original payload');
  });

  it('replaces a removed enhanced section with one working cloned control', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('before replacement'));
    const clipboard = setupClipboard();
    setupController();
    const replacement = section.cloneNode(true) as HTMLElement;
    replacement.querySelector('code')!.textContent = 'replacement payload';
    section.replaceWith(replacement);
    await Promise.resolve();

    expect(replacement.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    expect(replacement.querySelectorAll('[data-catalogue-copy-status]')).toHaveLength(1);
    replacement.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith('replacement payload');
  });

  it.each(['before', 'after'] as const)('keeps distinct independent controls when a pre clone is inserted %s its enhanced source', async (position) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('original source'));
    const clipboard = setupClipboard();
    let settleOriginal!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { settleOriginal = resolve; }));
    const dispose = setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const code = pre.querySelector('code');
    const originalButton = pre.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    originalButton.click();
    const clone = pre.cloneNode(true) as HTMLPreElement;
    clone.querySelector('code')!.textContent = 'cloned source';

    await expectQuiescence(() => position === 'before' ? pre.before(clone) : pre.after(clone));
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(2);
    expect(pre.parentElement).not.toBe(clone.parentElement);
    expect(pre.parentElement!.contains(clone)).toBe(false);
    expect(clone.parentElement!.contains(pre)).toBe(false);
    expect(pre.parentElement!.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    expect(pre.parentElement!.querySelector('[data-catalogue-copy-button]')).toBe(originalButton);
    expect(originalButton.isConnected).toBe(true);
    expect(pre.querySelector('code')).toBe(code);
    expect([...section.querySelectorAll('pre')]).toEqual(position === 'before' ? [clone, pre] : [pre, clone]);
    const cloneButton = clone.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    cloneButton.click();
    await expectQuiescence(settleOriginal);
    expect(clipboard.writeText.mock.calls.map(([text]) => text)).toEqual(['original source', 'cloned source']);
    expect(pre.parentElement!.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('Code copied to the clipboard.');
    originalButton.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText).toHaveBeenLastCalledWith('original source');
    await expectQuiescence(dispose);
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(0);
    expect(section.querySelectorAll('pre')).toHaveLength(2);
  });

  it.each([
    ['resolve', false], ['reject', false], ['resolve', true], ['reject', true]
  ] as const)('hands off a released document-owned block to an overlapping wrapper root without stale %s (chrome already removed: %s)', async (outcome, removedChrome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('overlapping source'));
    const clipboard = setupClipboard();
    let settleOld!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleOld = () => outcome === 'resolve' ? resolve() : reject(new Error('released copy'));
    }));
    const disposeDocument = setupController();
    const pre = section.querySelector('pre')!;
    const wrapper = pre.parentElement!;
    const sibling = document.createElement('aside');
    wrapper.append(sibling);
    const oldButton = wrapper.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    const disposeWrapper = setupController(wrapper);
    oldButton.click();
    if (removedChrome) {
      await expectQuiescence(() => {
        oldButton.remove();
        wrapper.querySelector('[data-catalogue-copy-status]')!.remove();
      });
    }

    await expectQuiescence(disposeDocument);
    expect(wrapper.isConnected).toBe(true);
    expect(pre.parentElement).toBe(wrapper);
    expect(sibling.parentElement).toBe(wrapper);
    expect(wrapper.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    const button = wrapper.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    expect(button).not.toBe(oldButton);
    await expectQuiescence(settleOld);
    expect(wrapper.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    expect(wrapper.querySelector('[data-catalogue-copy-button]')).toBe(button);
    oldButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    button.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText).toHaveBeenLastCalledWith('overlapping source');
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    await expectQuiescence(disposeWrapper);
    expect(wrapper.isConnected).toBe(true);
    expect(wrapper.querySelector('[data-catalogue-copy-button]')).toBeNull();
  });

  it.each(['explicit', 'detached'] as const)('flattens repeated adjacent clones and preserves authored sibling order on %s cleanup', async (cleanup) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('stationary original'));
    const dispose = setupController(section);
    const pre = section.querySelector('pre')!;
    const wrapper = pre.parentElement!;
    const button = wrapper.querySelector('button')!;
    const expected: Node[] = [section.firstChild!, pre];
    for (let i = 0; i < 5; i++) {
      const before = document.createElement('aside');
      const after = document.createElement('aside');
      const clone = pre.cloneNode(true);
      const index = expected.indexOf(pre);
      expected.splice(index, 0, before);
      expected.splice(index + 2, 0, clone, after);
      await expectQuiescence(() => {
        pre.before(before);
        pre.after(clone, after);
      });
      expect(pre.parentElement).toBe(wrapper);
      expect(wrapper.querySelector('button')).toBe(button);
      expect([...section.childNodes].map((node) => node instanceof Element && node.hasAttribute('data-catalogue-copy-container') ? node.querySelector('pre') : node)).toEqual(expected);
      expect(section.querySelectorAll('div div')).toHaveLength(0);
    }
    await expectQuiescence(() => cleanup === 'explicit' ? dispose() : section.remove());
    expect([...section.childNodes]).toEqual(expected);
    expect(section.querySelectorAll('div, button, [data-catalogue-copy-status]')).toHaveLength(0);
  });

  it.each([false, true])('cleans a multi-pre cloned wrapper without an orphan shell (protected root: %s)', async (scoped) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('original'));
    const disposeOriginal = setupController(section);
    const clone = section.querySelector('[data-catalogue-copy-container]')!.cloneNode(true) as HTMLElement;
    disposeOriginal();
    const first = clone.querySelector('pre')!;
    const second = first.cloneNode(true);
    const aside = document.createElement('aside');
    first.after(aside, second);
    section.replaceChildren(clone);
    const root = scoped ? clone : section;
    const dispose = setupController(root);
    await expectQuiescence(() => {});
    expect(root.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(2);
    expect(first.parentElement!.parentElement).toBe(root);
    expect(second.parentElement!.parentElement).toBe(root);
    await expectQuiescence(dispose);
    expect([...root.childNodes]).toEqual([first, aside, second]);
    expect(root.querySelector('div')).toBeNull();
  });

  it('discovers a sibling clone when the old container owner moves before its scoped observer runs', async () => {
    const section = document.querySelector('section')!;
    const destination = document.createElement('section');
    document.body.append(destination);
    const clipboard = setupClipboard();
    setupController(document);
    section.insertAdjacentHTML('beforeend', block('moved original'));
    setupController(section);
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const clone = pre.cloneNode(true) as HTMLPreElement;
    clone.querySelector('code')!.textContent = 'remaining clone';
    await expectQuiescence(() => {
      pre.after(clone);
      destination.append(pre);
    });
    expect(section.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    expect(destination.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    clone.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!.click();
    pre.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText.mock.calls.map(([text]) => text)).toEqual(['remaining clone', 'moved original']);
  });

  it('uses the nearest page heading when the local section has no heading', () => {
    document.body.innerHTML = '<nodel-page title="Fallback title"><header><h1>Quickstart</h1></header><section></section></nodel-page>';
    document.querySelector('section')!.insertAdjacentHTML('beforeend', block('quickstart'));
    setupController();
    expect(document.querySelector('[data-catalogue-copy-container] button')?.getAttribute('aria-label')).toBe('Copy code: Quickstart');
  });

  it('dispatches one cancelable before-copy event and reads final content', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('old'));
    const clipboard = setupClipboard();
    setupController();
    const pre = document.querySelector('pre')!;
    const listener = vi.fn((event: Event) => {
      pre.querySelector('code')!.textContent = 'final';
      pre.dataset.catalogueCopyDisabled = '';
      event.preventDefault();
    });
    pre.addEventListener('nodel-catalogue-before-copy', listener);
    document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    pre.removeEventListener('nodel-catalogue-before-copy', listener);
    delete pre.dataset.catalogueCopyDisabled;
    pre.querySelector('code')!.textContent = 'ready';
    await Promise.resolve(); await Promise.resolve();
    document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!.click();
    await Promise.resolve();
    expect(clipboard.writeText).toHaveBeenCalledWith('ready');
  });

  it('uses fallback, restores focus, and reports failure', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('fallback'));
    const clipboard = setupClipboard();
    clipboard.writeText.mockRejectedValueOnce(new Error('modern unavailable'));
    const exec = document.execCommand as unknown as ReturnType<typeof vi.fn>;
    exec.mockReturnValueOnce(true);
    const focusButton = document.createElement('button');
    document.body.append(focusButton);
    focusButton.focus();
    await copyTextToClipboard('focus');
    expect(document.activeElement).toBe(focusButton);
    focusButton.remove();
    clipboard.writeText.mockRejectedValueOnce(new Error('modern unavailable'));
    setupController();
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    const controllerFocus = document.createElement('input');
    document.body.append(controllerFocus);
    controllerFocus.focus();
    button.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(controllerFocus);
    clipboard.writeText.mockRejectedValueOnce(new Error('no clipboard'));
    exec.mockReturnValueOnce(false);
    button.click();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('[data-catalogue-copy-status]')?.textContent).toContain('manually');
  });

  it('keeps one request pending while content changes, then permits a fresh copy', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('first'));
    let resolveCopy!: () => void;
    const clipboard = setupClipboard();
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    setupController();
    const pre = document.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    pre.querySelector('code')!.textContent = 'second';
    await Promise.resolve();
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(button.disabled).toBe(false);
    expect(document.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it('copies the final uncancelled before-copy content and reports current success', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('old'));
    const clipboard = setupClipboard();
    let resolveCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const oldCode = pre.querySelector('code')!;
    pre.addEventListener('nodel-catalogue-before-copy', () => {
      const replacement = document.createElement('code');
      replacement.textContent = 'final';
      oldCode.replaceWith(replacement);
    });
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledWith('final');
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(pre.parentElement?.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('Code copied to the clipboard.');
    expect(button.disabled).toBe(false);
  });

  it('does not copy when disabled is set before observer reconciliation', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('guarded'));
    const clipboard = setupClipboard();
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    pre.dataset.catalogueCopyDisabled = '';
    button.click();
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('suppresses identical replacement feedback while pending, then allows a fresh request', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('same'));
    const clipboard = setupClipboard();
    let resolveCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    const replacement = document.createElement('code');
    replacement.textContent = 'same';
    pre.querySelector('code')!.replaceWith(replacement);
    await Promise.resolve();
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(pre.parentElement?.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it('keeps scoped roots isolated and prevents clipboard work after producer removal or disposal', async () => {
    const first = document.querySelector('section')!;
    const second = document.createElement('section');
    second.innerHTML = block('outside');
    document.body.append(second);
    first.insertAdjacentHTML('beforeend', block('inside'));
    const clipboard = setupClipboard();
    let resolveCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    const dispose = setupController(first);
    expect(second.querySelector('[data-catalogue-copy-container]')).toBeNull();
    const pre = first.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    dispose();
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(first.querySelector('[data-catalogue-copy-status]')).toBeNull();
  });

  it('cancels safely when before-copy removes the block or disables it', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('source'));
    const clipboard = setupClipboard();
    setupController();
    const pre = document.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    const remove = () => pre.remove();
    pre.addEventListener('nodel-catalogue-before-copy', remove, { once: true });
    button.click();
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    section.insertAdjacentHTML('beforeend', block('disabled'));
    await Promise.resolve();
    const secondPre = section.querySelectorAll<HTMLPreElement>('pre')[0]!;
    const secondButton = secondPre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    secondPre.addEventListener('nodel-catalogue-before-copy', () => { secondPre.dataset.catalogueCopyDisabled = ''; });
    secondButton.click();
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('preserves authored nodes and restores copying after code removal and re-addition', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('keep', 'id="authored" data-test="yes" tabindex="0"'));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const code = pre.querySelector('code')!;
    const container = pre.parentElement;
    pre.querySelector('code')!.remove();
    await Promise.resolve();
    expect(container?.querySelector('button')).toHaveProperty('disabled', true);
    const replacement = document.createElement('code');
    replacement.textContent = 'restored';
    pre.append(replacement);
    await Promise.resolve();
    expect(pre.id).toBe('authored');
    expect(pre.dataset.test).toBe('yes');
    expect(pre.tabIndex).toBe(0);
    expect(pre.querySelector('code')).not.toBe(code);
    expect(container?.querySelector('button')).toHaveProperty('disabled', false);
  });

  it('owns only the tabindex it adds for potentially scrollable code', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('auto', 'style="overflow-x: auto"'));
    const dispose = setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    expect(pre.tabIndex).toBe(0);
    dispose();
    expect(pre.hasAttribute('tabindex')).toBe(false);

    for (const value of ['-1', '0', '3']) {
      section.innerHTML = block('explicit', `style="overflow-x: auto" tabindex="${value}"`);
      const explicitDispose = enhanceCatalogueCodeCopy(section);
      expect(section.querySelector('pre')!.getAttribute('tabindex')).toBe(value);
      explicitDispose();
      expect(section.querySelector('pre')!.getAttribute('tabindex')).toBe(value);
    }

    section.innerHTML = block('override', 'style="overflow-x: auto"');
    const overrideDispose = enhanceCatalogueCodeCopy(section);
    const overridden = section.querySelector<HTMLPreElement>('pre')!;
    overridden.tabIndex = 7;
    overrideDispose();
    expect(overridden.getAttribute('tabindex')).toBe('7');
  });

  it.each(['resolve', 'reject'] as const)('does not steal focus after deferred %s when the user moved focus', async (outcome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('focus'));
    const clipboard = setupClipboard();
    let settleCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleCopy = () => outcome === 'resolve' ? resolve() : reject(new Error('deferred failure'));
    }));
    setupController();
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    const input = document.createElement('input');
    document.body.append(input);
    button.focus();
    button.click();
    input.focus();
    settleCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(document.activeElement).toBe(input);
  });

  it.each(['resolve', 'reject'] as const)('ignores old %s feedback after same pre removal and reattachment', async (outcome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('reattach'));
    const clipboard = setupClipboard();
    let settleOld!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleOld = () => outcome === 'resolve' ? resolve() : reject(new Error('old failure'));
    }));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const oldButton = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    oldButton.click();
    pre.remove();
    section.append(pre);
    await Promise.resolve();
    settleOld();
    await Promise.resolve(); await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    expect(section.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    const newButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    newButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it('disposes a pending block when its ancestor is removed and reattached', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('ancestor removal'));
    const clipboard = setupClipboard();
    let settleOld!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { settleOld = resolve; }));
    setupController();
    const oldPre = section.querySelector<HTMLPreElement>('pre')!;
    const oldButton = oldPre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    oldButton.click();

    section.remove();
    await Promise.resolve();
    expect(oldButton.isConnected).toBe(false);
    document.body.append(section);
    await Promise.resolve();
    const currentButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    expect(currentButton).not.toBe(oldButton);

    settleOld();
    await Promise.resolve(); await Promise.resolve();
    expect(section.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    currentButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ancestor', 'resolve'], ['ancestor', 'reject'],
    ['pre', 'resolve'], ['pre', 'reject'],
    ['container', 'resolve'], ['container', 'reject']
  ] as const)('quiesces after same-turn %s detach/reattach without admitting stale %s', async (target, outcome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('same-turn payload', 'style="overflow-x: auto"'));
    const clipboard = setupClipboard();
    let settleOld!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleOld = () => outcome === 'resolve' ? resolve() : reject(new Error('stale copy'));
    }));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const code = pre.querySelector('code');
    const container = pre.parentElement!;
    const oldButton = container.querySelector<HTMLButtonElement>('button')!;
    oldButton.focus();
    oldButton.click();
    const node = target === 'ancestor' ? section : target === 'pre' ? pre : container;
    const parent = node.parentElement!;

    await expectQuiescence(() => {
      node.remove();
      parent.append(node);
    });
    expect(section.querySelectorAll('[data-catalogue-copy-container]')).toHaveLength(1);
    expect(section.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    const currentButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    expect(currentButton).not.toBe(oldButton);
    expect(pre.querySelector('code')).toBe(code);
    expect(pre.tabIndex).toBe(0);
    await expectQuiescence(settleOld);
    expect(section.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    expect(document.activeElement).not.toBe(oldButton);
    expect(section.querySelector('[data-catalogue-copy-button]')).toBe(currentButton);
    oldButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    currentButton.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(clipboard.writeText).toHaveBeenLastCalledWith('same-turn payload');
    expect(section.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('Code copied to the clipboard.');
  });

  it.each([
    ['source-first', 'container'], ['destination-first', 'container'],
    ['source-first', 'pre'], ['destination-first', 'pre'],
    ['source-first', 'ancestor'], ['destination-first', 'ancestor']
  ] as const)('quiesces on scoped-root transfer with %s observer order moving the %s', async (observerOrder, target) => {
    const firstRoot = document.querySelector('section')!;
    const secondRoot = document.createElement('section');
    const clipboard = setupClipboard();
    let settleOld!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { settleOld = resolve; }));
    document.body.append(secondRoot);
    firstRoot.innerHTML = `<article>${block('scoped transfer')}</article>`;
    if (observerOrder === 'source-first') {
      setupController(firstRoot);
      setupController(secondRoot);
    } else {
      setupController(secondRoot);
      setupController(firstRoot);
    }
    const pre = firstRoot.querySelector<HTMLPreElement>('pre')!;
    const oldContainer = pre.parentElement!;
    const oldButton = oldContainer.querySelector<HTMLButtonElement>('button')!;
    oldButton.click();

    await expectQuiescence(() => secondRoot.append(target === 'container' ? oldContainer : target === 'pre' ? pre : firstRoot.querySelector('article')!));

    const currentButton = secondRoot.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    expect(currentButton).not.toBe(oldButton);
    expect(currentButton.isConnected).toBe(true);
    await expectQuiescence(settleOld);
    expect(secondRoot.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    expect(secondRoot.querySelector('[data-catalogue-copy-button]')).toBe(currentButton);
    expect(secondRoot.querySelectorAll('[data-catalogue-copy-button]')).toHaveLength(1);
    expect(firstRoot.querySelector('[data-catalogue-copy-container]')).toBeNull();
    oldButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    currentButton.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(clipboard.writeText).toHaveBeenCalledWith('scoped transfer');
  });

  it.each(['explicit', 'root-removal'] as const)('preserves an adopted cloned wrapper root and authored siblings on %s disposal', async (reason) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('cloned scoped root'));
    const disposeOriginal = setupController(section);
    const clone = section.querySelector('[data-catalogue-copy-container]')!.cloneNode(true) as HTMLDivElement;
    disposeOriginal();
    const sibling = document.createElement('aside');
    sibling.innerHTML = '<span>Authored sibling</span>';
    clone.append(sibling);
    document.body.append(clone);
    const pre = clone.querySelector('pre');
    const code = clone.querySelector('code');
    const disposeClone = setupController(clone);
    const button = clone.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
    const clipboard = setupClipboard();
    button.click();
    await expectQuiescence(() => {});
    expect(clipboard.writeText).toHaveBeenCalledWith('cloned scoped root');

    await expectQuiescence(() => reason === 'explicit' ? disposeClone() : clone.remove());
    expect(clone.isConnected).toBe(reason === 'explicit');
    expect(clone.querySelector('pre')).toBe(pre);
    expect(clone.querySelector('code')).toBe(code);
    expect(sibling.parentNode).toBe(clone);
    expect(clone.querySelector('[data-catalogue-copy-button]')).toBeNull();
    expect(clone.querySelector('[data-catalogue-copy-status]')).toBeNull();
  });

  it('unwraps an adopted container without losing authored siblings', async () => {
    const section = document.querySelector('section')!;
    section.innerHTML = `<div data-catalogue-copy-container>${block('preserved')}<aside>Before enhancement</aside></div>`;
    const before = section.querySelector('aside')!;
    const dispose = setupController(section);
    const container = section.querySelector('[data-catalogue-copy-container]')!;
    const after = document.createElement('aside');
    after.textContent = 'After enhancement';
    container.append(after);
    const pre = section.querySelector('pre');
    await expectQuiescence(dispose);
    expect([...section.children]).toEqual([pre, before, after]);
  });

  it('removes generated controls from a detached wrapper and rebuilds them on reinsertion', async () => {
    const section = document.querySelector('section')!;
    const clipboard = setupClipboard();
    section.insertAdjacentHTML('beforeend', block('detached wrapper'));
    const dispose = setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const container = pre.parentElement!;
    const oldButton = container.querySelector<HTMLButtonElement>('button')!;

    container.remove();
    dispose();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[data-catalogue-copy-status]')).toBeNull();
    expect(container.querySelector('pre')).toBe(pre);

    document.body.append(container);
    expect(container.querySelector('button')).toBeNull();
    setupController(document);
    await Promise.resolve();
    const currentButton = container.querySelector<HTMLButtonElement>('button')!;
    expect(currentButton).not.toBe(oldButton);
    currentButton.click();
    expect(clipboard.writeText).toHaveBeenCalledWith('detached wrapper');
  });

  it('keeps independent blocks usable while another block is pending', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', `${block('pending')}${block('available')}`);
    const clipboard = setupClipboard();
    let resolveCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    setupController();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-catalogue-copy-container] button')];
    buttons[0]!.click();
    buttons[1]!.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    await Promise.resolve(); await Promise.resolve();
    expect(buttons[1]!.disabled).toBe(false);
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
  });

  it.each(['resolve', 'reject'] as const)('does not update detached UI when disposed pending copy %s settles', async (outcome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('dispose'));
    const clipboard = setupClipboard();
    let settleCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleCopy = () => outcome === 'resolve' ? resolve() : reject(new Error('disposed failure'));
    }));
    const dispose = setupController();
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-container] button')!;
    button.click();
    dispose();
    settleCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('[data-catalogue-copy-status]')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('releases pending state without feedback when producer disables during copy %s', async (outcome) => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('producer'));
    const clipboard = setupClipboard();
    let settleCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleCopy = () => outcome === 'resolve' ? resolve() : reject(new Error('producer failure'));
    }));
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const button = pre.parentElement!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    pre.dataset.catalogueCopyDisabled = '';
    await Promise.resolve();
    settleCopy();
    await Promise.resolve(); await Promise.resolve();
    const container = pre.parentElement!;
    expect(container.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    expect(container.querySelector('[data-catalogue-copy-status]')).toHaveProperty('hidden', true);
    expect(button.disabled).toBe(true);
    delete pre.dataset.catalogueCopyDisabled;
    await Promise.resolve();
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });
});
