import { flush } from './helpers';

const actionMock = vi.hoisted(() => ({ callNodeAction: vi.fn() }));

vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: actionMock.callNodeAction }));

import '../src/components/nodel-button';
import '../src/components/nodel-fader';
import '../src/components/nodel-pad';
import '../src/components/nodel-palette';
import '../src/components/nodel-segmented';
import '../src/components/nodel-select';
import '../src/components/nodel-stepper';
import '../src/components/nodel-toggle';

interface ConfirmCase {
  name: string;
  markup: string;
  host: string;
  trigger: () => void;
}

describe('control action semantics', () => {
  const confirmationCases: ConfirmCase[] = [
    {
      name: 'button',
      markup: '<nodel-button action="Run" confirm>Run</nodel-button>',
      host: 'nodel-button',
      trigger: () => document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'toggle',
      markup: '<nodel-toggle action="SetPower" confirm></nodel-toggle>',
      host: 'nodel-toggle',
      trigger: () => document.querySelector('nodel-toggle button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'segmented',
      markup: '<nodel-segmented action="SetMode" confirm><nodel-button value="A">A</nodel-button></nodel-segmented>',
      host: 'nodel-segmented',
      trigger: () => document.querySelector('nodel-segmented nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'select',
      markup: '<nodel-select action="SetMode" confirm><nodel-button value="A">A</nodel-button></nodel-select>',
      host: 'nodel-select',
      trigger: () => document.querySelector('nodel-select nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'stepper',
      markup: '<nodel-stepper action="SetLevel" value="1" confirm></nodel-stepper>',
      host: 'nodel-stepper',
      trigger: () => document.querySelector('.nodel-stepper-shell')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    },
    {
      name: 'pad',
      markup: '<nodel-pad action="Move" confirm center="show"></nodel-pad>',
      host: 'nodel-pad',
      trigger: () => document.querySelector('[data-direction="right"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'palette',
      markup: '<nodel-palette action="SetColour" confirm><nodel-button value="#ff0000">Red</nodel-button></nodel-palette>',
      host: 'nodel-palette',
      trigger: () => document.querySelector('nodel-palette nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'fader',
      markup: '<nodel-fader action="SetLevel" value="50" confirm></nodel-fader>',
      host: 'nodel-fader',
      trigger: () => document.querySelector('.nodel-fader-track')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    }
  ];

  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    document.body.innerHTML = '';
  });

  it.each(confirmationCases)('does not call $name actions when confirmation is cancelled', async ({ markup, host: hostSelector, trigger }) => {
    document.body.innerHTML = markup;
    await flush();

    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(false);
    });
    document.querySelector(hostSelector)?.addEventListener('nodel-confirm', confirm);
    trigger();
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).not.toHaveBeenCalled();
  });
});
