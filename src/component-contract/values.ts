import { controlIconNames } from '../icons/control-icon-names';
import type { NodelAttributeDefinition } from './types';


export const signalBindingDescription = (defaultTarget: string) => `Signal binding. A signal name/path without a target updates ${defaultTarget}.`;
export const signalsBindingDescription = (targets: string) => `Signal binding list. Supported targets: ${targets}.`;
export const actionBindingSyntax = 'ActionName[:phase][; or , ActionName[:phase] ...]';
export const preferredToggleIconNames = [
  'sun', 'moon', 'power', 'volume', 'volume-low', 'mute', 'warning', 'success', 'info',
  ...controlIconNames.filter((name) => !['sun', 'moon', 'power', 'volume', 'volume-low', 'mute', 'warning', 'success', 'info'].includes(name))
];
export const confirmationAttributes: NodelAttributeDefinition[] = [
  { name: 'confirm', description: 'Enable confirmation when present, or provide confirmation body text as its value.', valueType: 'presence-or-text', syntax: 'confirm | confirm="Confirmation text"', defaultValue: 'false' },
  { name: 'confirm-mode', description: 'Confirmation mode. Code mode requires the configured local signal value.', values: ['standard', 'code'], defaultValue: 'standard' },
  { name: 'confirm-code-signal', description: 'Exact local signal alias containing the expected operator code.', syntax: 'LocalSignalAlias', defaultDescription: 'Derived: ConfirmCode in code mode; unused in standard mode.' },
  { name: 'confirm-title', description: 'Confirmation dialog title.' },
  { name: 'confirm-text', description: 'Confirmation dialog body text.' },
  { name: 'confirm-label', description: 'Confirmation button label.', defaultValue: 'Confirm' },
  { name: 'cancel-label', description: 'Cancellation button label.', defaultValue: 'Cancel' },
  { name: 'confirm-tone', description: 'Confirmation dialog tone.', values: ['info', 'success', 'warning', 'danger'] }
];


export const booleanAttributeNames = new Set([
  'active', 'allow-deselect', 'center-disabled', 'confirm', 'disabled', 'fixed', 'increment', 'live',
  'open', 'show-host-icon', 'show-state-label'
]);
