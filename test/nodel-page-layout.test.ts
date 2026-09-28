import '../src/components/nodel-page';
import { flush } from './helpers';

describe('nodel-page viewport layout state', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('normalizes the default, viewport, and invalid values for a leaf', () => {
    document.body.innerHTML = '<nodel-page></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;

    expect(page.dataset.minHeight).toBe('auto');
    expect(page.dataset.bleed).toBe('false');

    page.setAttribute('min-height', 'viewport');
    expect(page.dataset.minHeight).toBe('viewport');

    page.setAttribute('min-height', 'invalid');
    expect(page.dataset.minHeight).toBe('auto');
  });

  it('normalizes presence-only bleed for leaves and updates it dynamically', async () => {
    document.body.innerHTML = '<nodel-page bleed></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;

    expect(page.dataset.bleed).toBe('true');
    page.setAttribute('bleed', 'false');
    expect(page.dataset.bleed).toBe('true');
    page.removeAttribute('bleed');
    expect(page.dataset.bleed).toBe('false');

    page.setAttribute('bleed', '');
    page.remove();
    page.removeAttribute('bleed');
    document.body.append(page);
    await flush();
    expect(page.dataset.bleed).toBe('false');
  });

  it('falls back to auto when the attribute is removed and remains reactive while detached', () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;

    expect(page.dataset.minHeight).toBe('viewport');
    page.removeAttribute('min-height');
    expect(page.dataset.minHeight).toBe('auto');

    page.setAttribute('min-height', 'viewport');
    page.remove();
    page.setAttribute('min-height', 'invalid');
    document.body.append(page);
    expect(page.dataset.minHeight).toBe('auto');
  });

  it('does not make a navigation group a viewport leaf', () => {
    document.body.innerHTML = `
      <nodel-page min-height="viewport" bleed>
        <nodel-page title="Child"></nodel-page>
      </nodel-page>
    `;
    const group = document.body.firstElementChild as HTMLElement;
    const child = group.querySelector('nodel-page') as HTMLElement;

    expect(group.dataset.navGroupPage).toBe('true');
    expect(group.dataset.minHeight).toBe('auto');
    expect(group.dataset.bleed).toBe('false');
    expect(child.dataset.navGroupPage).toBe('false');
    expect(child.dataset.minHeight).toBe('auto');

    group.querySelector('[data-page-content]')?.removeChild(child);
    return flush().then(() => {
      expect(group.dataset.navGroupPage).toBe('false');
      expect(group.dataset.minHeight).toBe('viewport');
      expect(group.dataset.bleed).toBe('true');
    });
  });

  it('detects direct pages added to and removed from the host', async () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"></nodel-page>';
    const group = document.querySelector('nodel-page') as HTMLElement;
    const child = document.createElement('nodel-page');

    group.append(child);
    await flush();
    expect(group.dataset.navGroupPage).toBe('true');
    expect(group.dataset.minHeight).toBe('auto');

    child.remove();
    await flush();
    expect(group.dataset.navGroupPage).toBe('false');
    expect(group.dataset.minHeight).toBe('viewport');
  });

  it('moves host-authored nodes into the content wrapper in source order', async () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;
    const before = document.createElement('nodel-row');
    const child = document.createElement('nodel-page');
    const after = document.createElement('nodel-group');

    page.prepend(before);
    page.append(child, after);
    await flush();

    expect(Array.from(page.querySelector('[data-page-content]')!.children)).toEqual([before, child, after]);
    expect(page.firstElementChild?.localName).toBe('div');
    expect(page.dataset.navGroupPage).toBe('true');
  });

  it('replaces the wrapper while preserving authored order across leaf and group states', async () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"><nodel-row></nodel-row></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;
    const content = () => page.querySelector('[data-page-content]') as HTMLElement;
    const child = document.createElement('nodel-page');
    const fill = document.createElement('nodel-group');

    content().append(child, fill);
    await flush();
    expect(page.firstElementChild?.matches('div.contents')).toBe(true);
    expect(Array.from(content().children)).toEqual([page.querySelector('nodel-row'), child, fill]);

    child.remove();
    await flush();
    expect(page.firstElementChild?.matches('section.nodel-shell')).toBe(true);
    expect(Array.from(content().children)).toEqual([page.querySelector('nodel-row'), fill]);
    expect(page.dataset.minHeight).toBe('viewport');
  });

  it('prevents inherited page titles from becoming tooltips without changing authored titles', async () => {
    document.body.innerHTML = `
      <nodel-page title="Config">
        <nodel-row><button>Untitled</button><button title="Open node details">Open</button></nodel-row>
        <nodel-group title="Group help"><button>Group control</button></nodel-group>
      </nodel-page>
    `;
    const page = document.querySelector('nodel-page') as HTMLElement;
    const content = () => page.querySelector('[data-page-content]') as HTMLElement;
    const untitledButton = page.querySelector('nodel-row button') as HTMLButtonElement;
    const titledButton = page.querySelector('button[title]') as HTMLButtonElement;
    const groupButton = page.querySelector('nodel-group button') as HTMLButtonElement;
    const group = page.querySelector('nodel-group') as HTMLElement;

    expect(untitledButton.closest('[title]')).toBe(content());
    expect(content().getAttribute('title')).toBe('');
    expect(titledButton.closest('[title]')?.getAttribute('title')).toBe('Open node details');
    expect(groupButton.closest('[title]')).toBe(group);
    expect(group.getAttribute('title')).toBe('Group help');
    expect(page.getAttribute('title')).toBe('Config');

    const childPage = document.createElement('nodel-page');
    childPage.setAttribute('title', 'Child');
    childPage.innerHTML = '<button>Child control</button>';
    content().append(childPage);
    await flush();
    expect(page.dataset.navGroupPage).toBe('true');
    const childButton = childPage.querySelector('button') as HTMLButtonElement;
    const childContent = childPage.querySelector('[data-page-content]') as HTMLElement;
    expect(untitledButton.closest('[title]')).toBe(content());
    expect(childButton.closest('[title]')).toBe(childContent);
    expect(childContent.getAttribute('title')).toBe('');
    expect(page.getAttribute('title')).toBe('Config');
    expect(childPage.getAttribute('title')).toBe('Child');

    page.setAttribute('title', 'Settings');
    expect(untitledButton.closest('[title]')).toBe(content());
    expect(content().getAttribute('title')).toBe('');
    expect(page.getAttribute('title')).toBe('Settings');

    childPage.remove();
    await flush();
    expect(page.dataset.navGroupPage).toBe('false');
    expect(untitledButton.closest('[title]')).toBe(content());
    expect(content().getAttribute('title')).toBe('');
    expect(page.getAttribute('title')).toBe('Settings');

    page.remove();
    document.body.append(page);
    expect(untitledButton.closest('[title]')).toBe(content());
    expect(content().getAttribute('title')).toBe('');
    expect(page.getAttribute('title')).toBe('Settings');
  });

  it('does not treat nested page ownership as a direct group transition', async () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"><nodel-group><nodel-page></nodel-page></nodel-group></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;
    await flush();

    expect(page.dataset.navGroupPage).toBe('false');
    expect(page.firstElementChild?.localName).toBe('section');
  });

  it('counts only pages directly owned by the page, not deeper descendants', async () => {
    document.body.innerHTML = `
      <nodel-page min-height="viewport">
        <nodel-page>
          <nodel-page></nodel-page>
        </nodel-page>
      </nodel-page>
    `;
    const parent = document.body.firstElementChild as HTMLElement;
    const child = parent.querySelector('nodel-page') as HTMLElement;
    const grandchild = child.querySelector('nodel-page') as HTMLElement;

    expect(parent.dataset.navGroupPage).toBe('true');
    child.querySelector('[data-page-content]')?.removeChild(grandchild);
    await flush();

    expect(parent.dataset.navGroupPage).toBe('true');
    expect(child.dataset.navGroupPage).toBe('false');
  });

  it('recomputes direct ownership after mutations made while disconnected', async () => {
    document.body.innerHTML = `
      <nodel-page min-height="viewport">
        <nodel-page></nodel-page>
      </nodel-page>
    `;
    const parent = document.body.firstElementChild as HTMLElement;
    const content = parent.querySelector('[data-page-content]') as HTMLElement;
    const child = content.querySelector('nodel-page') as HTMLElement;

    parent.remove();
    child.remove();
    expect(parent.dataset.navGroupPage).toBe('true');

    document.body.append(parent);
    await flush();
    expect(parent.dataset.navGroupPage).toBe('false');
    expect(parent.dataset.minHeight).toBe('viewport');
  });

  it('reapplies state after reconnecting', () => {
    document.body.innerHTML = '<nodel-page min-height="viewport"></nodel-page>';
    const page = document.querySelector('nodel-page') as HTMLElement;

    page.remove();
    page.setAttribute('min-height', 'invalid');
    document.body.append(page);
    expect(page.dataset.minHeight).toBe('auto');

    page.setAttribute('min-height', 'viewport');
    expect(page.dataset.minHeight).toBe('viewport');
  });
});
