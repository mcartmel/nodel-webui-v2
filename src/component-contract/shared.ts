import type { ComponentAttributeContract } from './types';

export const commonComponentAttributes: ComponentAttributeContract[] = [
  { name: 'signals', description: 'Signal binding list. Supported common target: visibility.', valueType: 'binding', syntax: 'SignalName[.path]:visibility[; or , SignalName[.path]:visibility(any|all) ...]', common: true, completion: 'recommended', consumption: 'observed', lifecycle: 'dynamic', consumer: 'signal-visibility-bindings' },
  { name: 'visibility', description: 'Local signal controlling component visibility. Supports SignalName.path extraction. Without exact values, visible/true/1 shows and hidden/false/0 hides.', valueType: 'binding', syntax: 'SignalName[.path]', defaultDescription: 'Visible unless a visibility source is configured.', common: true, completion: 'recommended', consumption: 'observed', lifecycle: 'dynamic', consumer: 'signal-visibility-bindings' },
  { name: 'visible-value', description: 'One exact, case-sensitive scalar visibility value. The component starts hidden until this value is received.', valueType: 'string', defaultDescription: 'Derived: hidden until a matching value is received.', common: true, completion: 'recommended', consumption: 'observed', lifecycle: 'dynamic', consumer: 'signal-visibility-bindings' },
  { name: 'visible-values', description: 'Semicolon-separated exact, case-sensitive scalar visibility values. The component starts hidden until one value matches.', valueType: 'string', syntax: 'value;value;...', defaultDescription: 'Derived: hidden until a matching value is received.', common: true, completion: 'recommended', consumption: 'observed', lifecycle: 'dynamic', consumer: 'signal-visibility-bindings' }
];

export const visibilitySignalsDescription = ' Visibility may also be bound with SignalName[.path]:visibility in this same signals attribute.';
