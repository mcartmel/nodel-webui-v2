import { flush } from './helpers';

import '../src/components/nodel-group';
import '../src/components/nodel-pad';
import '../src/components/nodel-fader';
import '../src/components/nodel-control-grid';

describe('nodel-group', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a visible group label with default card surface and padding', async () => {
    document.body.innerHTML = '<nodel-group label="Transport"><nodel-control-grid columns="2"></nodel-control-grid></nodel-group>';
    await customElements.whenDefined('nodel-group');
    await flush();

    const group = document.querySelector('nodel-group') as HTMLElement;
    const shell = group.querySelector('.nodel-group-shell') as HTMLElement;
    const label = group.querySelector('.nodel-group-label') as HTMLElement;

    expect(group.dataset.surface).toBe('card');
    expect(group.dataset.padding).toBe('default');
    expect(shell.getAttribute('role')).toBe('group');
    expect(shell.getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.hidden).toBe(false);
    expect(label.textContent).toBe('Transport');
    expect(group.querySelector('.nodel-group-body nodel-control-grid')).not.toBeNull();
  });

  it('auto-labels a single direct labelable child', async () => {
    document.body.innerHTML = '<nodel-group label="Navigate"><nodel-pad></nodel-pad></nodel-group>';
    await customElements.whenDefined('nodel-group');
    await customElements.whenDefined('nodel-pad');
    await flush();

    const group = document.querySelector('nodel-group') as HTMLElement;
    const label = group.querySelector('.nodel-group-label') as HTMLElement;
    const pad = group.querySelector('nodel-pad') as HTMLElement;

    expect(pad.getAttribute('aria-labelledby')).toBe(label.id);
    expect(pad.dataset.nodelGroupAutoLabelledby).toBe(label.id);
  });

  it('does not overwrite explicit child labels', async () => {
    document.body.innerHTML = '<nodel-group label="Volume"><nodel-fader label="Main volume"></nodel-fader></nodel-group>';
    await customElements.whenDefined('nodel-group');
    await customElements.whenDefined('nodel-fader');
    await flush();

    const fader = document.querySelector('nodel-fader') as HTMLElement;

    expect(fader.getAttribute('label')).toBe('Main volume');
    expect(fader.getAttribute('aria-labelledby')).toBeNull();
    expect(fader.dataset.nodelGroupAutoLabelledby).toBeUndefined();
  });

  it('clears auto labels when the child is no longer the only direct control', async () => {
    document.body.innerHTML = '<nodel-group label="Controls"><nodel-pad></nodel-pad></nodel-group>';
    await customElements.whenDefined('nodel-group');
    await customElements.whenDefined('nodel-pad');
    await flush();

    const group = document.querySelector('nodel-group') as HTMLElement;
    const pad = group.querySelector('nodel-pad') as HTMLElement;
    group.querySelector('.nodel-group-body')?.appendChild(document.createElement('nodel-fader'));
    await flush();

    expect(pad.getAttribute('aria-labelledby')).toBeNull();
    expect(pad.dataset.nodelGroupAutoLabelledby).toBeUndefined();
  });
});
