import { ModalFocusController } from '../src/utils/modal-focus-controller';
import { flush } from './helpers';

describe('ModalFocusController', () => {
  const controllers: ModalFocusController[] = [];

  function controller() {
    const value = new ModalFocusController();
    controllers.push(value);
    return value;
  }

  function activate(value: ModalFocusController, container: HTMLElement, dialog: HTMLElement, root: HTMLElement, onCancel?: () => void) {
    const options = { container, dialog, inertRoot: root, ...(onCancel === undefined ? {} : { onCancel }) };
    value.activate(options);
  }

  afterEach(() => {
    for (const value of controllers.splice(0)) {
      value.deactivate({ restoreFocus: false });
    }
    document.body.innerHTML = '';
  });

  it('retains only the nested interaction path and restores authored branch state', () => {
    document.body.innerHTML = `
      <main id="app">
        <nodel-toolbar id="toolbar">
          <button id="brand">Brand</button>
          <div id="actions">
            <nodel-node-menu id="menu">
              <button id="trigger">Open</button>
              <div id="layer"><button id="backdrop">Backdrop</button><section id="dialog" tabindex="-1"><button>Close</button></section></div>
            </nodel-node-menu>
          </div>
        </nodel-toolbar>
        <section id="content" inert aria-hidden="false"><button>Content</button></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#app')!;
    const layer = document.querySelector<HTMLElement>('#layer')!;
    const dialog = document.querySelector<HTMLElement>('#dialog')!;
    const modal = controller();

    activate(modal, layer, dialog, root);

    expect(document.querySelector<HTMLElement>('#content')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#brand')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#trigger')?.inert).toBe(true);
    expect(layer.inert).not.toBe(true);
    expect(document.querySelector<HTMLElement>('#backdrop')?.inert).not.toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);

    modal.deactivate({ restoreFocus: false });

    const content = document.querySelector<HTMLElement>('#content')!;
    expect(content.inert).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector<HTMLElement>('#brand')?.inert).toBe(false);
    expect(document.querySelector<HTMLElement>('#trigger')?.inert).toBe(false);
  });

  it('recomputes sibling and nested layers after out-of-order removal', () => {
    document.body.innerHTML = `
      <main id="root">
        <section id="first"><div id="first-layer"><section id="first-dialog" tabindex="-1"><button>First</button><div id="nested"><div id="nested-layer"><section id="nested-dialog" tabindex="-1"><button>Nested</button></section></div></div></section></div></section>
        <section id="second"><div id="second-layer"><section id="second-dialog" tabindex="-1"><button>Second</button></section></div></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const first = controller();
    const second = controller();
    const nested = controller();

    activate(first, document.querySelector<HTMLElement>('#first-layer')!, document.querySelector<HTMLElement>('#first-dialog')!, root);
    activate(second, document.querySelector<HTMLElement>('#second-layer')!, document.querySelector<HTMLElement>('#second-dialog')!, root);
    expect(document.querySelector<HTMLElement>('#first')?.inert).toBe(true);

    first.deactivate({ restoreFocus: false });
    expect(second.isTopLayerActive()).toBe(true);
    expect(document.querySelector<HTMLElement>('#first')?.inert).toBe(true);

    activate(nested, document.querySelector<HTMLElement>('#nested-layer')!, document.querySelector<HTMLElement>('#nested-dialog')!, root);
    expect(document.querySelector<HTMLElement>('#second')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#nested-dialog')?.contains(document.activeElement)).toBe(true);

    nested.deactivate({ restoreFocus: false });
    expect(second.isTopLayerActive()).toBe(true);
    expect(document.querySelector<HTMLElement>('#first')?.inert).toBe(true);
    second.deactivate({ restoreFocus: false });
    expect(document.querySelector<HTMLElement>('#first')?.inert).toBe(false);
    expect(document.querySelector<HTMLElement>('#second')?.inert).toBe(false);
  });

  it('reconciles inserted, removed, and reparented sibling branches', async () => {
    document.body.innerHTML = '<main id="root"><section id="active"><div id="layer"><section id="dialog" tabindex="-1"><button>Dialog</button></section></div></section></main>';
    const root = document.querySelector<HTMLElement>('#root')!;
    const modal = controller();
    activate(modal, document.querySelector<HTMLElement>('#layer')!, document.querySelector<HTMLElement>('#dialog')!, root);

    const sibling = document.createElement('aside');
    sibling.id = 'sibling';
    root.append(sibling);
    await flush();
    expect(sibling.inert).toBe(true);

    document.querySelector<HTMLElement>('#layer')?.append(sibling);
    await flush();
    expect(sibling.inert).toBe(false);

    root.append(sibling);
    await flush();
    expect(sibling.inert).toBe(true);
    sibling.remove();
    await flush();
    expect(sibling.inert).toBe(false);
  });

  it('cleans up disconnected layers and lets only the top layer trap Tab or handle Escape', async () => {
    document.body.innerHTML = `
      <main id="root">
        <section id="first"><div id="first-layer"><section id="first-dialog"><button>One</button><button>Two</button></section></div></section>
        <section id="second"><div id="second-layer"><section id="second-dialog"><button>Three</button><button>Four</button></section></div></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const first = controller();
    const second = controller();
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    activate(first, document.querySelector<HTMLElement>('#first-layer')!, document.querySelector<HTMLElement>('#first-dialog')!, root, firstCancel);
    activate(second, document.querySelector<HTMLElement>('#second-layer')!, document.querySelector<HTMLElement>('#second-dialog')!, root, secondCancel);

    const secondButtons = document.querySelectorAll<HTMLElement>('#second-dialog button');
    const secondLast = secondButtons[1];
    if (secondLast === undefined) throw new Error('Missing second dialog button.');
    secondLast.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(secondButtons[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(firstCancel).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalledOnce();

    document.querySelector<HTMLElement>('#second')?.remove();
    await flush();
    expect(second.isTopLayerActive()).toBe(false);
    expect(first.isTopLayerActive()).toBe(true);
    expect(document.querySelector<HTMLElement>('#first')?.inert).toBe(false);

    const firstButtons = document.querySelectorAll<HTMLElement>('#first-dialog button');
    expect(document.activeElement).toBe(firstButtons[0]);
    const firstLast = firstButtons[1];
    if (firstLast === undefined) throw new Error('Missing first dialog button.');
    firstLast.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstButtons[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(firstCancel).toHaveBeenCalledOnce();
    expect(secondCancel).toHaveBeenCalledOnce();
  });

  it('restores a competing sibling layer before native focus enters it', async () => {
    document.body.innerHTML = `
      <main id="root">
        <section id="old"><button id="trigger">Trigger</button><div id="old-layer"><section id="old-dialog"><button>Old</button></section></div></section>
        <section id="next"><div id="next-layer"><section id="next-dialog"><button>Next</button></section></div></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const old = controller();
    const next = controller();
    activate(old, document.querySelector<HTMLElement>('#old-layer')!, document.querySelector<HTMLElement>('#old-dialog')!, root);
    document.querySelector<HTMLElement>('#trigger')?.focus();
    expect(document.querySelector<HTMLElement>('#next')?.inert).toBe(true);

    // JSDOM does not implement native inert focus blocking. Mirror browser
    // behavior so this covers the stale-inert sibling transition.
    const focus = HTMLElement.prototype.focus;
    const nativeFocus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.closest('[inert]')) {
        return;
      }
      focus.call(this, options);
    });
    const observedFocus: Element[] = [];
    const observer = new MutationObserver(() => observedFocus.push(document.activeElement!));
    observer.observe(document.querySelector<HTMLElement>('#old')!, { attributes: true, attributeFilter: ['inert'] });

    activate(next, document.querySelector<HTMLElement>('#next-layer')!, document.querySelector<HTMLElement>('#next-dialog')!, root);
    await flush();
    observer.disconnect();
    nativeFocus.mockRestore();

    expect(observedFocus[0]).toBe(document.querySelector('#next-dialog button'));
    expect(document.activeElement).toBe(document.querySelector('#next-dialog button'));
    expect(document.querySelector<HTMLElement>('#old')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#next')?.inert).toBe(false);
  });

  it('keeps focus in a nested top layer over an active modal', () => {
    document.body.innerHTML = `
      <main id="root">
        <section id="background"><button>Background</button></section>
        <div id="parent-layer">
          <section id="parent-dialog">
            <button id="parent-control">Parent control</button>
            <div id="nested-layer"><section id="nested-dialog"><button id="nested-control">Nested control</button></section></div>
          </section>
        </div>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const parent = controller();
    const nested = controller();

    activate(parent, document.querySelector<HTMLElement>('#parent-layer')!, document.querySelector<HTMLElement>('#parent-dialog')!, root);
    activate(nested, document.querySelector<HTMLElement>('#nested-layer')!, document.querySelector<HTMLElement>('#nested-dialog')!, root);

    expect(document.activeElement).toBe(document.querySelector('#nested-control'));
    expect(document.querySelector<HTMLElement>('#background')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#parent-control')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#nested-layer')?.inert).not.toBe(true);
  });

  it('updates an active layer in place without promoting it or replacing its trigger', async () => {
    document.body.innerHTML = `
      <main id="root">
        <button id="original-trigger">Original trigger</button>
        <button id="replacement-trigger">Replacement trigger</button>
        <section id="confirm-host"><section id="confirm-dialog"><button>Old confirm</button></section></section>
        <section id="connectivity-host"><section id="connectivity-dialog"><button>Connectivity</button></section></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const confirmHost = document.querySelector<HTMLElement>('#confirm-host')!;
    const originalTrigger = document.querySelector<HTMLButtonElement>('#original-trigger')!;
    const replacementTrigger = document.querySelector<HTMLButtonElement>('#replacement-trigger')!;
    const confirm = controller();
    const connectivity = controller();
    const confirmCancel = vi.fn();
    const connectivityCancel = vi.fn();

    originalTrigger.focus();
    confirm.activate({
      container: confirmHost,
      dialog: document.querySelector<HTMLElement>('#confirm-dialog')!,
      inertRoot: root,
      onCancel: confirmCancel,
      trigger: originalTrigger
    });
    connectivity.activate({
      container: document.querySelector<HTMLElement>('#connectivity-host')!,
      dialog: document.querySelector<HTMLElement>('#connectivity-dialog')!,
      inertRoot: root,
      onCancel: connectivityCancel
    });
    expect(document.activeElement).toBe(document.querySelector('#connectivity-dialog button'));

    confirmHost.innerHTML = '<section id="replacement-confirm-dialog"><button>Replacement confirm</button></section>';
    confirm.activate({
      container: confirmHost,
      dialog: document.querySelector<HTMLElement>('#replacement-confirm-dialog')!,
      inertRoot: root,
      onCancel: confirmCancel,
      trigger: replacementTrigger
    });
    await flush();

    expect(confirm.isTopLayerActive()).toBe(false);
    expect(connectivity.isTopLayerActive()).toBe(true);
    expect(confirmHost.inert).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#connectivity-dialog button'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('#connectivity-dialog button'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(connectivityCancel).toHaveBeenCalledOnce();
    expect(confirmCancel).not.toHaveBeenCalled();

    connectivity.deactivate({ restoreFocus: false });
    confirmHost.remove();
    confirm.deactivate();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(originalTrigger);
  });

  it('keeps a rerendered top layer focused and observes replacement branches', async () => {
    document.body.innerHTML = `
      <main id="root">
        <button id="trigger">Trigger</button>
        <section id="host"><section id="old-dialog"><button>Old dialog</button></section></section>
      </main>
      <main id="replacement-root"></main>
    `;
    const root = document.querySelector<HTMLElement>('#root')!;
    const replacementRoot = document.querySelector<HTMLElement>('#replacement-root')!;
    const host = document.querySelector<HTMLElement>('#host')!;
    const modal = controller();
    const cancel = vi.fn();

    document.querySelector<HTMLButtonElement>('#trigger')?.focus();
    modal.activate({
      container: host,
      dialog: document.querySelector<HTMLElement>('#old-dialog')!,
      inertRoot: root,
      onCancel: cancel
    });
    replacementRoot.append(host);
    host.innerHTML = '<section id="replacement-dialog"><button id="replacement-control">Replacement dialog</button></section>';
    modal.activate({
      container: host,
      dialog: document.querySelector<HTMLElement>('#replacement-dialog')!,
      inertRoot: replacementRoot,
      onCancel: cancel
    });
    await flush();

    expect(modal.isTopLayerActive()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#replacement-control'));
    const sibling = document.createElement('aside');
    replacementRoot.append(sibling);
    await flush();
    expect(sibling.inert).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
