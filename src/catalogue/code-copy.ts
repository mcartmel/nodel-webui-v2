import { copyTextToClipboard } from '../utils/clipboard';
import { faCopy } from '@fortawesome/free-regular-svg-icons';
import { renderFontAwesomeIcon } from '../icons/fontawesome';

const codeSelector = 'pre.nodel-catalogue-code';
const ownedContainer = 'data-catalogue-copy-container';
const ownedStatus = 'data-catalogue-copy-status';
const ownedButton = 'data-catalogue-copy-button';

interface CopyBlock {
  root: ParentNode;
  pre: HTMLPreElement;
  code: HTMLElement | null;
  text: string;
  container: HTMLDivElement;
  button: HTMLButtonElement;
  status: HTMLParagraphElement;
  pending: boolean;
  contentRevision: number;
  requestIdentity: number;
  ownsTabIndex: boolean;
  disposed: boolean;
  dispose: () => void;
}

interface Controller {
  dispose: () => void;
  capture: (moves?: ReadonlyMap<Node, Node | null>) => void;
  discover: (pre: HTMLPreElement) => void;
}

const ownedBlocks = new WeakMap<HTMLPreElement, CopyBlock>();
const ownedContainers = new WeakMap<HTMLDivElement, CopyBlock>();
const ownedRoots = new WeakMap<ParentNode, Controller>();
const controllers = new Set<Controller>();

// Drain before changing ownership so queued removals retain their generation.
// After our moves, ignore only the exact child-removal edges we generated, not
// authored removals with a coincidentally identical final DOM position.
function captureMutations(moves?: ReadonlyMap<Node, Node | null>) {
  for (const controller of controllers) controller.capture(moves);
}

function moveOwnedNodes(nodes: Node[], move: () => void) {
  captureMutations();
  const moves = new Map(nodes.map((node) => [node, node.parentNode]));
  // DOM reparenting clears focus and live Range endpoints even when the same
  // nodes remain connected. Snapshot endpoints, not a live cloned Range.
  const active = document.activeElement;
  const restoreFocus = active instanceof HTMLElement && nodes.some((node) => node.contains(active));
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusOffset = selection?.focusOffset ?? 0;
  const restoreSelection = anchor && focus && nodes.some((node) => node.contains(anchor) || node.contains(focus));
  move();
  if (restoreFocus && active.isConnected) active.focus({ preventScroll: true });
  if (restoreSelection && anchor.isConnected && focus.isConnected) {
    selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  }
  captureMutations(moves);
}

function clearContainerChrome(container: HTMLDivElement) {
  for (const element of [...container.children]) {
    if (element.matches(`[${ownedButton}], [${ownedStatus}]`)) element.remove();
  }
}

function isolateContainer(block: CopyBlock) {
  const shared = block.container;
  if (shared.parentNode && !ownedRoots.has(shared)) {
    // Keep the live owner stationary. Lift extra authored nodes out of our
    // generated wrapper instead of nesting another wrapper around the owner.
    // This preserves focus/selection and restores the parent's sibling layout.
    const children = [...shared.childNodes];
    const index = children.indexOf(block.pre);
    const authored = (node: Node) => node !== block.button && node !== block.status;
    const before = children.slice(0, index).filter(authored);
    const after = children.slice(index + 1).filter(authored);
    moveOwnedNodes([...before, ...after], () => {
      shared.before(...before);
      shared.after(...after);
    });
    return;
  }
  // A caller's scoped root must remain in place and retain its descendants.
  // Only this protected shell needs inner copy areas; it is not an orphan.
  const container = document.createElement('div');
  container.setAttribute(ownedContainer, '');
  shared.insertBefore(container, block.pre);
  moveOwnedNodes([block.pre, block.button, block.status], () => container.append(block.pre, block.button, block.status));
  ownedContainers.delete(shared);
  block.container = container;
  ownedContainers.set(container, block);
  // The old wrapper is now a grouping/scoped-root shell, not a copy area.
  shared.removeAttribute(ownedContainer);
}

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
  block.status.hidden = true;
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
  block.button.title = blockLabel(block.pre);
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
  const pending: Array<{ record: MutationRecord; removed: CopyBlock[] }> = [];
  const released = new Set<HTMLPreElement>();
  let scheduled = false;

  const createBlock = (pre: HTMLPreElement) => {
    if (disposed || !inScope(root, pre) || !validPre(pre)) return;
    captureMutations();
    const previous = ownedBlocks.get(pre);
    if (previous) {
      if (!previous.disposed && inScope(previous.root, pre)) return;
      previous.dispose();
    }
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) return;

    let container = pre.parentElement instanceof HTMLDivElement && pre.parentElement.hasAttribute(ownedContainer)
      ? pre.parentElement
      : null;
    if (container && (ownedContainers.has(container) || container.querySelectorAll(`:scope > ${codeSelector}`).length !== 1)) {
      const owner = ownedContainers.get(container);
      if (owner && owner.pre.parentElement === container) isolateContainer(owner);
      else {
        // Another observer may discover this sibling before the previous
        // producer's removal has been reconciled by its scoped owner.
        owner?.dispose();
        clearContainerChrome(container);
        if (container.parentNode && !ownedRoots.has(container)) {
          // An unowned clone can already contain several pres. Flatten its
          // generated shell as well; each pre will get its own copy area.
          const children = [...container.childNodes];
          const shared = container;
          moveOwnedNodes(children, () => shared.replaceWith(...children));
        } else container.removeAttribute(ownedContainer);
      }
      container = null;
    }
    if (!container) {
      container = document.createElement('div');
      container.setAttribute(ownedContainer, '');
      pre.before(container);
      const wrapper = container;
      moveOwnedNodes([pre], () => wrapper.append(pre));
    }
    // Cloned catalogue DOM carries the old control markup. Replace only our
    // generated descendants; the authored pre/code tree stays untouched.
    clearContainerChrome(container);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nodel-button nodel-button-ghost nodel-catalogue-copy-button';
    button.setAttribute(ownedButton, '');
    button.title = blockLabel(pre);
    button.innerHTML = renderFontAwesomeIcon(faCopy, 'h-4 w-4');
    const status = document.createElement('p');
    status.className = 'nodel-catalogue-copy-status min-w-0 text-sm text-nodel-muted';
    status.setAttribute(ownedStatus, '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;
    container.append(button, status);

    const block: CopyBlock = {
      root, pre, code, text: code.textContent ?? '', container, button, status, pending: false, contentRevision: 0, requestIdentity: 0, ownsTabIndex: false, disposed: false,
      dispose: () => {
        if (block.disposed) return;
        captureMutations();
        block.disposed = true;
        block.requestIdentity += 1;
        blocks.delete(block);
        if (ownedBlocks.get(pre) === block) ownedBlocks.delete(pre);
        const container = block.container;
        if (ownedContainers.get(container) === block) ownedContainers.delete(container);
        clearFeedback(block);
        button.removeEventListener('click', onClick);
        button.remove();
        status.remove();
        if (container.parentNode && container !== root && !ownedRoots.has(container)) {
          // An adopted/cloned wrapper may contain additional authored nodes.
          // Never replace it with just the pre or remove a caller's scoped root.
          const children = [...container.childNodes];
          moveOwnedNodes(children, () => container.replaceWith(...children));
        }
        if (block.ownsTabIndex && pre.getAttribute('tabindex') === '0') pre.removeAttribute('tabindex');
        // An overlapping controller may have skipped this still-owned pre at
        // discovery. Offer it explicitly, even if chrome was already removed
        // and disposal itself produced no observable document mutations.
        for (const controller of controllers) controller.discover(pre);
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
    ownedContainers.set(container, block);
    blocks.add(block);
    button.addEventListener('click', onClick);
    refreshBlock(block);
    button.title = blockLabel(pre);
  };

  const observerTarget = root instanceof Document ? root : root.ownerDocument ?? document;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    pending.length = 0;
    released.clear();
    controllers.delete(controller);
    if (ownedRoots.get(root)?.dispose === dispose) ownedRoots.delete(root);
    for (const block of [...blocks]) block.dispose();
  };

  const reconcile = () => {
    scheduled = false;
    if (disposed) return;
    if (!(root instanceof Document) && !root.isConnected) {
      dispose();
      return;
    }
    const added = new Set(released);
    released.clear();
    const changed = new Set<HTMLPreElement>();
    const removed = new Set<CopyBlock>();
    // Snapshot the entire batch before disposal/creation can enqueue more work.
    for (const { record, removed: recordRemoved } of pending.splice(0)) {
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
      for (const block of recordRemoved) if (blocks.has(block)) removed.add(block);
      if (record.type === 'characterData' || record.type === 'childList' || record.type === 'attributes') {
        const targetPre = record.target instanceof Element && record.target.matches(codeSelector)
          ? record.target as HTMLPreElement
          : record.target.parentElement?.closest<HTMLPreElement>(codeSelector);
        if (targetPre && inScope(root, targetPre)) changed.add(targetPre);
      }
    }
    for (const block of removed) {
      const reattached = inScope(root, block.pre) && block.pre.isConnected;
      block.dispose();
      if (reattached) added.add(block.pre);
    }
    for (const pre of added) createBlock(pre);
    for (const pre of changed) {
      const block = ownedBlocks.get(pre);
      if (block && blocks.has(block)) refreshBlock(block);
      else createBlock(pre);
    }
  };
  const enqueue = (records: MutationRecord[], moves?: ReadonlyMap<Node, Node | null>) => {
    const remainingMoves = new Map(moves);
    for (const record of records) {
      const removed = [...record.removedNodes]
        .filter((node) => {
          if (!remainingMoves.has(node) || remainingMoves.get(node) !== record.target) return true;
          // Consume one edge only: synchronous authored/custom-element code
          // triggered by the move can remove the very same node again.
          remainingMoves.delete(node);
          return false;
        })
        .flatMap(ownedBlocksIn);
      pending.push({ record, removed });
    }
  };
  const observer = new MutationObserver((records) => {
    enqueue(records);
    reconcile();
  });
  const scheduleReconcile = () => {
    if (!scheduled && !disposed) {
      scheduled = true;
      queueMicrotask(reconcile);
    }
  };
  const controller: Controller = {
    dispose,
    capture: (moves) => {
      enqueue(observer.takeRecords(), moves);
      if (pending.length) scheduleReconcile();
    },
    discover: (pre) => {
      if (disposed || !pre.matches(codeSelector) || !pre.isConnected || !inScope(root, pre)) return;
      released.add(pre);
      scheduleReconcile();
    }
  };
  ownedRoots.set(root, controller);
  controllers.add(controller);
  observer.observe(observerTarget, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-catalogue-copy-disabled', 'data-catalogue-copy-label'] });
  const initial = root instanceof HTMLPreElement && root.matches(codeSelector) ? [root] : [];
  for (const pre of [...initial, ...root.querySelectorAll<HTMLPreElement>(codeSelector)]) createBlock(pre);
  return dispose;
}
