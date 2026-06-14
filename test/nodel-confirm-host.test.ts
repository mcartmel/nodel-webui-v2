import '../src/components/nodel-confirm-host';
import type { NodelConfirmHostElement } from '../src/components/nodel-confirm-host';

describe('nodel-confirm-host', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="trigger">Trigger</button><nodel-confirm-host></nodel-confirm-host>';
  });

  it('opens and resolves true when confirmed', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    let resolved: boolean | null = null;

    host.confirm({
      title: 'Confirm power',
      text: 'Power on?',
      tone: 'warning',
      resolve: (value) => {
        resolved = value;
      }
    }, document.querySelector('#trigger'));

    expect(host.hidden).toBe(false);
    expect(host.textContent).toContain('Confirm power');
    expect(host.querySelector('.nodel-confirm-warning')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.click();

    expect(resolved).toBe(true);
    expect(host.hidden).toBe(true);
  });

  it('resolves false on cancel and Escape', () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const resolutions: boolean[] = [];

    host.confirm({ text: 'Continue?', resolve: (value) => resolutions.push(value) });
    host.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.click();

    host.confirm({ text: 'Continue?', resolve: (value) => resolutions.push(value) });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(resolutions).toEqual([false, false]);
  });
});
