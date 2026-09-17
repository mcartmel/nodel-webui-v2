import { enhanceCatalogueCodeCopy } from '../src/catalogue/code-copy';
import { copyTextToClipboard } from '../src/utils/clipboard';

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

  it('copies exact decoded code and excludes inline/reference/example code', async () => {
    const markup = '  &lt;nodel-button&gt;&amp; {{value}}&lt;/nodel-button&gt;\n';
    const text = '  <nodel-button>& {{value}}</nodel-button>\n';
    document.querySelector('section')!.insertAdjacentHTML('beforeend', block(markup));
    document.body.insertAdjacentHTML('beforeend', '<code>inline</code><table><tr><td><code>table</code></td></tr></table><div data-catalogue-example><pre class="nodel-catalogue-code"><code>preview</code></pre></div>');
    const clipboard = setupClipboard();
    setupController();
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
    button.click();
    await Promise.resolve();
    expect(clipboard.writeText).toHaveBeenCalledWith(text);
    expect(document.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Copy code: Examples');
  });

  it('is idempotent, handles dynamic blocks and state changes independently', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('one'));
    setupController();
    const duplicateDispose = enhanceCatalogueCodeCopy();
    section.insertAdjacentHTML('beforeend', block('two', 'data-catalogue-copy-disabled'));
    await Promise.resolve();
    expect(document.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(2);
    const second = document.querySelectorAll<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')[1]!;
    expect(second.disabled).toBe(true);
    const firstCode = document.querySelector('pre code')!;
    firstCode.textContent = 'changed';
    await Promise.resolve();
    expect(document.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    duplicateDispose();
    expect(document.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(0);
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
    expect(section.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(0);

    const code = document.createElement('code');
    code.textContent = 'late source';
    pre.append(code);
    await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
    section.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith('late source');

    code.textContent = 'changed source';
    await Promise.resolve();
    code.remove();
    await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
    expect(section.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')?.disabled).toBe(true);
    pre.append(code);
    await Promise.resolve();
    section.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith('changed source');
  });

  it('reconciles cloned controller chrome while keeping the original and repeated clones functional', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('original payload'));
    const clipboard = setupClipboard();
    let resolveOriginal!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOriginal = resolve; }));
    setupController();
    const originalButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
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
      expect(current.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
      expect(current.querySelectorAll('[data-catalogue-copy-status]')).toHaveLength(1);
      expect(current.querySelectorAll('[data-catalogue-copy-toolbar] button')).toHaveLength(1);
    }
    clone.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
    repeatedClone.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
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

    expect(replacement.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
    expect(replacement.querySelectorAll('[data-catalogue-copy-status]')).toHaveLength(1);
    replacement.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith('replacement payload');
  });

  it('uses the nearest page heading when the local section has no heading', () => {
    document.body.innerHTML = '<nodel-page title="Fallback title"><header><h1>Quickstart</h1></header><section></section></nodel-page>';
    document.querySelector('section')!.insertAdjacentHTML('beforeend', block('quickstart'));
    setupController();
    expect(document.querySelector('[data-catalogue-copy-toolbar] button')?.getAttribute('aria-label')).toBe('Copy code: Quickstart');
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
    document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    pre.removeEventListener('nodel-catalogue-before-copy', listener);
    delete pre.dataset.catalogueCopyDisabled;
    pre.querySelector('code')!.textContent = 'ready';
    await Promise.resolve(); await Promise.resolve();
    document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!.click();
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
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
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
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
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
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledWith('final');
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(pre.previousElementSibling?.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('Code copied to the clipboard.');
    expect(button.disabled).toBe(false);
  });

  it('does not copy when disabled is set before observer reconciliation', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', block('guarded'));
    const clipboard = setupClipboard();
    setupController();
    const pre = section.querySelector<HTMLPreElement>('pre')!;
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
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
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    const replacement = document.createElement('code');
    replacement.textContent = 'same';
    pre.querySelector('code')!.replaceWith(replacement);
    await Promise.resolve();
    resolveCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(pre.previousElementSibling?.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
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
    expect(second.querySelector('[data-catalogue-copy-toolbar]')).toBeNull();
    const pre = first.querySelector<HTMLPreElement>('pre')!;
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
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
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
    const remove = () => pre.remove();
    pre.addEventListener('nodel-catalogue-before-copy', remove, { once: true });
    button.click();
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    section.insertAdjacentHTML('beforeend', block('disabled'));
    await Promise.resolve();
    const secondPre = section.querySelectorAll<HTMLPreElement>('pre')[0]!;
    const secondButton = secondPre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
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
    const toolbar = pre.previousElementSibling;
    pre.querySelector('code')!.remove();
    await Promise.resolve();
    expect(toolbar?.querySelector('button')).toHaveProperty('disabled', true);
    const replacement = document.createElement('code');
    replacement.textContent = 'restored';
    pre.append(replacement);
    await Promise.resolve();
    expect(pre.id).toBe('authored');
    expect(pre.dataset.test).toBe('yes');
    expect(pre.tabIndex).toBe(0);
    expect(pre.querySelector('code')).not.toBe(code);
    expect(toolbar?.querySelector('button')).toHaveProperty('disabled', false);
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
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
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
    const oldButton = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
    oldButton.click();
    pre.remove();
    section.append(pre);
    await Promise.resolve();
    settleOld();
    await Promise.resolve(); await Promise.resolve();
    expect(section.querySelectorAll('[data-catalogue-copy-toolbar]')).toHaveLength(1);
    expect(section.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    const newButton = section.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
    newButton.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it('keeps independent blocks usable while another block is pending', async () => {
    const section = document.querySelector('section')!;
    section.insertAdjacentHTML('beforeend', `${block('pending')}${block('available')}`);
    const clipboard = setupClipboard();
    let resolveCopy!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    setupController();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')];
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
    const button = document.querySelector<HTMLButtonElement>('[data-catalogue-copy-toolbar] button')!;
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
    const button = pre.previousElementSibling!.querySelector<HTMLButtonElement>('button')!;
    button.click();
    pre.dataset.catalogueCopyDisabled = '';
    await Promise.resolve();
    settleCopy();
    await Promise.resolve(); await Promise.resolve();
    expect(pre.nextElementSibling).toBeNull();
    const toolbar = pre.previousElementSibling!;
    expect(toolbar.querySelector('[data-catalogue-copy-status]')?.textContent).toBe('');
    expect(button.disabled).toBe(true);
    delete pre.dataset.catalogueCopyDisabled;
    await Promise.resolve();
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });
});
