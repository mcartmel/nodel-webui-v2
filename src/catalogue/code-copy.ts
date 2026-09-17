import { copyTextToClipboard } from '../utils/clipboard';

const codeSelector = 'pre.nodel-catalogue-code';
const ownedToolbar = 'data-catalogue-copy-toolbar';
const ownedStatus = 'data-catalogue-copy-status';

interface CopyBlock {
  pre: HTMLPreElement;
  code: HTMLElement | null;
  text: string;
  button: HTMLButtonElement;
  status: HTMLParagraphElement;
  pending: boolean;
  contentRevision: number;
  requestIdentity: number;
  ownsTabIndex: boolean;
  dispose: () => void;
}

interface Controller {
  dispose: () => void;
}

const ownedBlocks = new WeakMap<HTMLPreElement, CopyBlock>();
const ownedRoots = new WeakMap<ParentNode, Controller>();
const ownedToolbars = new WeakSet<HTMLElement>();

function isCataloguePre(element: Element | null): element is HTMLPreElement {
  return element instanceof HTMLPreElement && element.matches(codeSelector);
}

function inScope(root: ParentNode, pre: HTMLPreElement) {
  return (root as Node).contains(pre);
}

function validPre(pre: HTMLPreElement) {
  return !pre.closest('[data-catalogue-example]');
}

function blockLabel(pre: HTMLPreElement): string {
  const explicit = pre.dataset.catalogueCopyLabel;
  const context = pre.closest('section, article');
  const localHeading = [...(context?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? [])]
    .find((heading) => heading.closest('section, article') === context)?.textContent?.trim();
  const page = pre.closest('nodel-page');
  const pageHeading = [...(page?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? [])]
    .find((heading) => heading.closest('nodel-page') === page)?.textContent?.trim();
  const heading = localHeading || pageHeading || page?.getAttribute('title')?.trim();
  const parts = [heading, explicit].filter((part): part is string => Boolean(part));
  return parts.length ? `Copy code: ${parts.join(', ')}` : 'Copy code';
}

function preDisabled(pre: HTMLPreElement) {
  return pre.hasAttribute('data-catalogue-copy-disabled');
}

function clearFeedback(block: CopyBlock) {
  block.status.textContent = '';
  block.status.hidden = false;
}

function refreshBlock(block: CopyBlock) {
  const code = block.pre.querySelector<HTMLElement>('code');
  const text = code?.textContent ?? '';
  const overflowX = getComputedStyle(block.pre).overflowX;
  if (!block.pre.hasAttribute('tabindex') && (block.pre.scrollWidth > block.pre.clientWidth || overflowX === 'auto' || overflowX === 'scroll')) {
    block.pre.tabIndex = 0;
    block.ownsTabIndex = true;
  }
  if (code !== block.code || text !== block.text) {
    block.code = code;
    block.text = text;
    block.contentRevision += 1;
    clearFeedback(block);
  }
  block.button.setAttribute('aria-label', blockLabel(block.pre));
  block.button.disabled = block.pending || !block.code?.textContent?.trim() || preDisabled(block.pre);
  if (preDisabled(block.pre) && !block.pending) clearFeedback(block);
}

function ownedBlocksIn(node: Node): CopyBlock[] {
  const candidates: HTMLPreElement[] = [];
  const element = node instanceof Element ? node : null;
  if (isCataloguePre(element)) candidates.push(element);
  if (!isCataloguePre(element) && (node instanceof Element || node instanceof DocumentFragment)) candidates.push(...node.querySelectorAll<HTMLPreElement>(codeSelector));
  return candidates.map((candidate) => ownedBlocks.get(candidate)).filter((block): block is CopyBlock => Boolean(block));
}

export function enhanceCatalogueCodeCopy(root: ParentNode = document): () => void {
  const existing = ownedRoots.get(root);
  if (existing) return existing.dispose;

  const blocks = new Set<CopyBlock>();
  let disposed = false;

  const createBlock = (pre: HTMLPreElement) => {
    if (disposed || !inScope(root, pre) || !validPre(pre) || ownedBlocks.has(pre)) return;
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) return;

    const adjacentToolbar = pre.previousElementSibling;
    if (adjacentToolbar instanceof HTMLElement && adjacentToolbar.hasAttribute(ownedToolbar) && !ownedToolbars.has(adjacentToolbar)) adjacentToolbar.remove();

    const toolbar = document.createElement('div');
    toolbar.className = 'nodel-catalogue-copy-toolbar flex flex-wrap items-center justify-between gap-2 min-w-0';
    toolbar.setAttribute(ownedToolbar, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nodel-button nodel-button-ghost';
    button.textContent = 'Copy code';
    const status = document.createElement('p');
    status.className = 'min-w-0 flex-1 text-sm text-nodel-muted';
    status.setAttribute(ownedStatus, '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = false;
    toolbar.append(status, button);
    ownedToolbars.add(toolbar);
    pre.before(toolbar);

    const block: CopyBlock = {
      pre, code, text: code.textContent ?? '', button, status, pending: false, contentRevision: 0, requestIdentity: 0, ownsTabIndex: false,
      dispose: () => {
        block.requestIdentity += 1;
        blocks.delete(block);
        if (ownedBlocks.get(pre) === block) ownedBlocks.delete(pre);
        clearFeedback(block);
        button.removeEventListener('click', onClick);
        ownedToolbars.delete(toolbar);
        toolbar.remove();
        status.remove();
        if (block.ownsTabIndex && pre.getAttribute('tabindex') === '0') pre.removeAttribute('tabindex');
      }
    };

    const onClick = () => {
      if (disposed || !blocks.has(block) || block.pending || !pre.isConnected || !inScope(root, pre) || preDisabled(pre) || button.disabled) return;
      const beforeCopy = new CustomEvent('nodel-catalogue-before-copy', { bubbles: true, cancelable: true });
      if (!pre.dispatchEvent(beforeCopy) || disposed || !blocks.has(block) || !pre.isConnected || !inScope(root, pre) || preDisabled(pre)) {
        refreshBlock(block);
        return;
      }
      const currentCode = pre.querySelector<HTMLElement>('code');
      if (!currentCode) {
        refreshBlock(block);
        return;
      }
      block.code = currentCode;
      const snapshot = currentCode.textContent ?? '';
      if (!snapshot.trim()) {
        refreshBlock(block);
        return;
      }
      const requestIdentity = ++block.requestIdentity;
      block.pending = true;
      const restoreFocus = document.activeElement === button;
      block.status.hidden = false;
      block.status.textContent = 'Copying code...';
      refreshBlock(block);
      const snapshotRevision = block.contentRevision;
      void copyTextToClipboard(snapshot).then(
        () => settle(true, requestIdentity, snapshotRevision, currentCode, snapshot, restoreFocus),
        () => settle(false, requestIdentity, snapshotRevision, currentCode, snapshot, restoreFocus)
      );
    };

    const settle = (success: boolean, requestIdentity: number, snapshotRevision: number, snapshotCode: HTMLElement, snapshot: string, restoreFocus: boolean) => {
      if (block.requestIdentity !== requestIdentity) return;
      block.pending = false;
      refreshBlock(block);
      const currentCode = pre.querySelector<HTMLElement>('code');
      if (disposed || !blocks.has(block) || !pre.isConnected || !inScope(root, pre) || preDisabled(pre) || currentCode !== snapshotCode || block.contentRevision !== snapshotRevision || currentCode.textContent !== snapshot || !snapshot.trim()) {
        clearFeedback(block);
        return;
      }
      const activeElement = document.activeElement;
      if (restoreFocus && (activeElement === button || activeElement === document.body || activeElement === document.documentElement || activeElement === null)) button.focus({ preventScroll: true });
      block.status.hidden = false;
      block.status.textContent = success ? 'Code copied to the clipboard.' : 'Clipboard access failed. Select the code and copy it manually.';
    };

    ownedBlocks.set(pre, block);
    blocks.add(block);
    button.addEventListener('click', onClick);
    refreshBlock(block);
  };

  const initial = root instanceof HTMLPreElement && root.matches(codeSelector) ? [root] : [];
  for (const pre of [...initial, ...root.querySelectorAll<HTMLPreElement>(codeSelector)]) createBlock(pre);

  const observerTarget = root instanceof Document ? root : root.ownerDocument ?? document;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (ownedRoots.get(root)?.dispose === dispose) ownedRoots.delete(root);
    for (const block of [...blocks]) block.dispose();
  };

  const observer = new MutationObserver((records) => {
    if (disposed) return;
    if (!(root instanceof Document) && !root.isConnected) {
      dispose();
      return;
    }
    const added = new Set<HTMLPreElement>();
    const changed = new Set<HTMLPreElement>();
    for (const record of records) {
      for (const node of record.addedNodes) {
        for (const block of ownedBlocksIn(node)) changed.add(block.pre);
        if ((root as Node).contains(node)) {
          const addedElement = node instanceof Element ? node : null;
          if (isCataloguePre(addedElement)) added.add(addedElement);
          if (node instanceof Element || node instanceof DocumentFragment) {
            for (const pre of node.querySelectorAll<HTMLPreElement>(codeSelector)) added.add(pre);
          }
        }
      }
      for (const node of record.removedNodes) {
        for (const block of ownedBlocksIn(node)) if (blocks.has(block)) block.dispose();
      }
      if (record.type === 'characterData' || record.type === 'childList' || record.type === 'attributes') {
        const targetPre = record.target instanceof Element && record.target.matches(codeSelector)
          ? record.target as HTMLPreElement
          : record.target.parentElement?.closest<HTMLPreElement>(codeSelector);
        if (targetPre && inScope(root, targetPre)) changed.add(targetPre);
      }
    }
    for (const pre of added) createBlock(pre);
    for (const pre of changed) {
      const block = ownedBlocks.get(pre);
      if (block && blocks.has(block)) refreshBlock(block);
      else createBlock(pre);
    }
  });
  ownedRoots.set(root, { dispose });
  observer.observe(observerTarget, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-catalogue-copy-disabled', 'data-catalogue-copy-label'] });
  return dispose;
}
