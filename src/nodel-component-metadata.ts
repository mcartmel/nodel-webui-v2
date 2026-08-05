import { controlIconNames } from './icons/control-icon-names';

export type NodelAttributeValueType = 'boolean' | 'presence-or-text' | 'string' | 'binding' | 'enum' | 'enum-or-string' | 'number' | 'integer' | 'template-data';

export interface NodelNumericConstraint {
  integer?: boolean;
  normalizesToInteger?: boolean;
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  unit?: string;
  clamp?: boolean;
}

export interface NodelAttributeDefinition {
  name: string;
  description: string;
  values?: string[];
  valueType?: NodelAttributeValueType;
  syntax?: string;
  numeric?: NodelNumericConstraint;
  defaultValue?: string;
  defaultDescription?: string;
  common?: boolean;
  legacy?: string;
  completable?: boolean;
}

export interface NodelElementDefinition {
  name: string;
  description: string;
  attributes: NodelAttributeDefinition[];
  snippet?: string;
  catalogue?: boolean;
  defaultSignalTarget?: string;
  aggregateSignalTargets?: string[];
}

export const commonNodelAttributes: NodelAttributeDefinition[] = [
  {
    name: 'signals',
    description: 'Signal binding list. Supported common target: visibility.',
    valueType: 'binding',
    syntax: 'SignalName[.path]:visibility[; or , SignalName[.path]:visibility(any|all) ...]',
    common: true
  },
  {
    name: 'visibility',
    description: 'Local signal controlling component visibility. Supports SignalName.path extraction. Without exact values, visible/true/1 shows and hidden/false/0 hides.',
    valueType: 'binding',
    syntax: 'SignalName[.path]',
    defaultDescription: 'Visible unless a visibility source is configured.',
    common: true
  },
  {
    name: 'visible-value',
    description: 'One exact, case-sensitive scalar visibility value. The component starts hidden until this value is received.',
    valueType: 'string',
    defaultDescription: 'Derived: hidden until a matching value is received.',
    common: true
  },
  {
    name: 'visible-values',
    description: 'Semicolon-separated exact, case-sensitive scalar visibility values. The component starts hidden until one value matches.',
    valueType: 'string',
    syntax: 'value;value;...',
    defaultDescription: 'Derived: hidden until a matching value is received.',
    common: true
  }
];

const signalBindingDescription = (defaultTarget: string) => `Signal binding. A signal name/path without a target updates ${defaultTarget}.`;
const signalsBindingDescription = (targets: string) => `Signal binding list. Supported targets: ${targets}.`;
const actionBindingSyntax = 'ActionName[:phase][; or , ActionName[:phase] ...]';
const preferredToggleIconNames = [
  'sun', 'moon', 'power', 'volume', 'volume-low', 'mute', 'warning', 'success', 'info',
  ...controlIconNames.filter((name) => !['sun', 'moon', 'power', 'volume', 'volume-low', 'mute', 'warning', 'success', 'info'].includes(name))
];
const confirmationAttributes: NodelAttributeDefinition[] = [
  { name: 'confirm', description: 'Enable confirmation when present, or provide confirmation body text as its value.', valueType: 'presence-or-text', syntax: 'confirm | confirm="Confirmation text"', defaultValue: 'false' },
  { name: 'confirm-mode', description: 'Confirmation mode. Code mode requires the configured local signal value.', values: ['standard', 'code'], defaultValue: 'standard' },
  { name: 'confirm-code-signal', description: 'Exact local signal alias containing the expected operator code.', syntax: 'LocalSignalAlias', defaultDescription: 'Derived: ConfirmCode in code mode; unused in standard mode.' },
  { name: 'confirm-title', description: 'Confirmation dialog title.' },
  { name: 'confirm-text', description: 'Confirmation dialog body text.' },
  { name: 'confirm-label', description: 'Confirmation button label.', defaultValue: 'Confirm' },
  { name: 'cancel-label', description: 'Cancellation button label.', defaultValue: 'Cancel' },
  { name: 'confirm-tone', description: 'Confirmation dialog tone.', values: ['info', 'success', 'warning', 'danger'] }
];

const rawNodelDocumentElements: NodelElementDefinition[] = [
  {
    name: 'nodel-app',
    catalogue: true,
    defaultSignalTarget: 'title',
    description: 'Top-level Nodel application shell.',
    attributes: [
      { name: 'title', description: 'Runtime page title.' },
      { name: 'theme', description: 'Theme selection. Omit the attribute for the stored/system preference; default is a compatibility reset alias.', values: ['default', 'light', 'dark'] },
      { name: 'offline-mode', description: 'Host-offline presentation. Modal blocks controls; overlay leaves them available.', values: ['modal', 'overlay'] },
      { name: 'signal', description: signalBindingDescription('title') },
      { name: 'signals', description: signalsBindingDescription('title') }
    ],
    snippet: '<nodel-app title="Nodel">\n  ${}\n</nodel-app>'
  },
  {
    name: 'nodel-toolbar',
    catalogue: true,
    description: 'Toolbar with generated navigation and actions slot.',
    attributes: [
      { name: 'title', description: 'Toolbar title override.' },
      { name: 'icon-src', description: 'Static toolbar icon URL.' },
      { name: 'icon-alt', description: 'Static toolbar icon alt text.' }
    ],
    snippet: '<nodel-toolbar icon-src="./v2/img/logo.png">\n  ${}\n</nodel-toolbar>'
  },
  {
    name: 'nodel-page',
    catalogue: true,
    description: 'Selectable app page or nav group.',
    attributes: [
      { name: 'title', description: 'Page title used for generated navigation. It does not render a visible heading.' },
      { name: 'nav-label', description: 'Navigation label override, consumed by the parent nodel-app.' },
      { name: 'nav-id', description: 'Stable explicit navigation id.' },
      { name: 'action', description: 'Action called whenever this page is explicitly activated.' },
      { name: 'actions', description: 'Activation action bindings. Supported phase: activate.' },
      { name: 'arg', description: 'Optional activation action argument.' },
      { name: 'arg-type', description: 'Parser for the activation argument.', values: ['string', 'number', 'boolean', 'json'] }
    ],
    snippet: '<nodel-page title="Page">\n  ${}\n</nodel-page>'
  },
  {
    name: 'nodel-row',
    catalogue: true,
    description: 'Responsive layout row.',
    attributes: [],
    snippet: '<nodel-row>\n  <nodel-column>\n    ${}\n  </nodel-column>\n</nodel-row>'
  },
  {
    name: 'nodel-column',
    catalogue: true,
    description: 'Responsive layout column.',
    attributes: [
      { name: 'span', description: 'Base 12-column span. Finite input is truncated and clamped to 1..12.', defaultValue: '12' },
      { name: 'sm', description: 'Small breakpoint span. Finite input is truncated and clamped to 1..12.' },
      { name: 'md', description: 'Medium breakpoint span. Finite input is truncated and clamped to 1..12.' },
      { name: 'lg', description: 'Large breakpoint span. Finite input is truncated and clamped to 1..12.' },
      { name: 'xl', description: 'Extra-large breakpoint span. Finite input is truncated and clamped to 1..12.' },
      { name: '2xl', description: '2XL breakpoint span. Finite input is truncated and clamped to 1..12.' },
      { name: 'order', description: 'Base visual order, clamped to -12..12.' },
      { name: 'sm-order', description: 'Small-breakpoint visual order, clamped to -12..12.' },
      { name: 'md-order', description: 'Medium-breakpoint visual order, clamped to -12..12.' },
      { name: 'lg-order', description: 'Large-breakpoint visual order, clamped to -12..12.' },
      { name: 'xl-order', description: 'Extra-large-breakpoint visual order, clamped to -12..12.' },
      { name: '2xl-order', description: '2XL-breakpoint visual order, clamped to -12..12.' }
    ],
    snippet: '<nodel-column md="6">\n  ${}\n</nodel-column>'
  },
  {
    name: 'nodel-footer',
    catalogue: true,
    description: 'Semantic page footer in normal flow or an explicitly fixed safe-area-aware mode.',
    attributes: [
      { name: 'fixed', description: 'Fix the footer to the viewport bottom and reserve matching app space.' }
    ],
    snippet: '<nodel-footer>\n  ${}\n</nodel-footer>'
  },
  {
    name: 'nodel-control-grid',
    catalogue: true,
    description: 'Equal-cell grid for touch controls.',
    attributes: [
      { name: 'columns', description: 'Base control column count. Finite input is truncated and clamped to 1..12.', defaultValue: '1' },
      { name: 'sm', description: 'Small breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: 'md', description: 'Medium breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: 'lg', description: 'Large breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: 'xl', description: 'Extra-large breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: '2xl', description: '2XL breakpoint control column count. Finite input is truncated and clamped to 1..12.' }
    ],
    snippet: '<nodel-control-grid columns="3">\n  ${}\n</nodel-control-grid>'
  },
  {
    name: 'nodel-control-space',
    catalogue: true,
    description: 'Empty placeholder cell inside a nodel-control-grid.',
    attributes: [],
    snippet: '<nodel-control-space></nodel-control-space>'
  },
  {
    name: 'nodel-group',
    catalogue: true,
    description: 'Labelled composition group for visible captions, passive surfaces, and control grouping.',
    attributes: [
      { name: 'label', description: 'Visible group label. A single direct child control is auto-labelled for accessibility.' },
      { name: 'surface', description: 'Passive group surface.', values: ['card', 'panel', 'none'] },
      { name: 'padding', description: 'Group interior padding.', values: ['default', 'compact', 'none'] }
    ],
    snippet: '<nodel-group label="Group">\n  ${}\n</nodel-group>'
  },
  {
    name: 'nodel-template',
    catalogue: true,
    description: 'Authoring macro that renders placeholder-filled clones from a native template.',
    attributes: [
      { name: 'template', description: 'ID of a shared native template element to render.' },
      { name: 'name', description: 'Base name exposed as {{name}} and used by {{item}}.' },
      { name: 'repeat', description: 'Number of clones to render. Finite input is truncated and clamped to 0..200.', defaultValue: '1' },
      { name: 'start', description: 'First numeric {{number}} value.', defaultValue: '1' },
      { name: 'step', description: 'Increment between rendered {{number}} values.', defaultValue: '1' },
      { name: 'data-*', description: 'Additional template context values. For example, data-action-prefix exposes {{action-prefix}} and {{actionPrefix}}.', valueType: 'template-data', syntax: 'data-name="value"', completable: false }
    ],
    snippet: '<nodel-template name="Zone" repeat="4">\n  <template>\n    <nodel-button join="{{item}}">{{name}} {{number}}</nodel-button>\n  </template>\n</nodel-template>'
  },
  {
    name: 'nodel-button',
    catalogue: true,
    defaultSignalTarget: 'active',
    aggregateSignalTargets: ['active', 'disabled'],
    description: 'Touch-sized action or state button.',
    attributes: [
      { name: 'variant', description: 'Button visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link'] },
      { name: 'tone', description: 'Button visual tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'layout', description: 'Button child layout.', values: ['inline', 'stack'] },
      { name: 'size', description: 'Button size. Auto uses the context default.', values: ['auto', 'sm', 'md', 'lg'] },
      { name: 'action', description: 'Current-node action name to call on click.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phases: click, press, release.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'action-on', description: 'Legacy alias for a press-phase momentary action.', legacy: 'Use actions="ActionName:press" instead.' },
      { name: 'action-off', description: 'Legacy alias for a release-phase momentary action.', legacy: 'Use actions="ActionName:release" instead.' },
      { name: 'arg', description: 'Optional action argument value.' },
      { name: 'arg-type', description: 'Parser for arg.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'disabled', description: 'Disable the button.' },
      { name: 'active', description: 'Mark the button active/pressed.' },
      { name: 'active-value', description: 'Optional active-state signal value when it differs from arg.' },
      { name: 'value', description: 'Contextual option value when this button is a child of nodel-segmented, nodel-select, or nodel-palette.' },
      { name: 'color', description: 'Contextual swatch colour when this button is a child of nodel-palette.' },
      { name: 'border', description: 'Contextual swatch border colour when this button is a child of nodel-palette.' },
      ...confirmationAttributes,
      { name: 'aria-label', description: 'Accessible label for icon-only or image-only buttons.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible button label.' },
      { name: 'title', description: 'Native button title text.' },
      { name: 'signal', description: signalBindingDescription('active') },
      { name: 'signals', description: signalsBindingDescription('active, label, disabled') }
    ],
    snippet: '<nodel-button action="ActionName">${}</nodel-button>'
  },
  {
    name: 'nodel-toggle',
    catalogue: true,
    defaultSignalTarget: 'state',
    aggregateSignalTargets: ['disabled'],
    description: 'Touch switch for boolean action/state controls, including partial feedback states.',
    attributes: [
      { name: 'action', description: 'Current-node action name to call on toggle.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phases: toggle, on, off.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'on-arg', description: 'Action argument sent when toggling on. Defaults to true.' },
      { name: 'off-arg', description: 'Action argument sent when toggling off. Defaults to false.' },
      { name: 'arg-type', description: 'Parser for on/off args.', values: ['boolean', 'string', 'number', 'json'] },
      { name: 'value', description: 'Current toggle state.', values: ['off', 'on', 'partially-off', 'partially-on'] },
      { name: 'on-value', description: 'Exact signal value that means on.' },
      { name: 'off-value', description: 'Exact signal value that means off.' },
      { name: 'partial-on-value', description: 'Exact signal value that means partially on.' },
      { name: 'partial-off-value', description: 'Exact signal value that means partially off.' },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'on-label', description: 'State label shown for on/partially-on.' },
      { name: 'off-label', description: 'State label shown for off/partially-off.' },
      { name: 'on-icon', description: 'State icon shown for on/partially-on.', values: preferredToggleIconNames },
      { name: 'off-icon', description: 'State icon shown for off/partially-off.', values: preferredToggleIconNames },
      { name: 'state-label', description: 'Show or hide visible state text. Hidden by default.', values: ['hide', 'show'] },
      { name: 'variant', description: 'On-state colour variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger'] },
      { name: 'off-variant', description: 'Off-state colour variant. Default keeps the off state neutral.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger'] },
      { name: 'tone', description: 'Switch track tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable the switch.' },
      { name: 'title', description: 'Native switch title text.' },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('state') },
      { name: 'signals', description: signalsBindingDescription('state, label, disabled') }
    ],
    snippet: '<nodel-group label="Theme">\n  <nodel-toggle action="SetTheme" signal="Theme" off-label="Light" on-label="Dark" off-icon="sun" on-icon="moon" state-label="show"></nodel-toggle>\n</nodel-group>'
  },
  {
    name: 'nodel-segmented',
    catalogue: true,
    defaultSignalTarget: 'value',
    aggregateSignalTargets: ['disabled'],
    description: 'Mutually exclusive option group using direct nodel-button children.',
    attributes: [
      { name: 'action', description: 'Current-node action name called when an option is selected.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phase: select.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'arg-type', description: 'Parser for option values.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'value', description: 'Current selected option value.' },
      { name: 'variant', description: 'Active option colour variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger'] },
      { name: 'tone', description: 'Active option tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'orientation', description: 'Option group orientation.', values: ['horizontal', 'vertical'] },
      { name: 'disabled', description: 'Disable the group.' },
      { name: 'allow-deselect', description: 'Allow tapping the active option to clear selection.' },
      { name: 'label', description: 'Accessible group label.' },
      { name: 'aria-label', description: 'Explicit accessible group label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible group label.' },
      { name: 'options-signal', description: 'SignalName[.path] source for dynamic option arrays. Accepts scalars, { value, label }, and v1 { key, value } entries.' },
      { name: 'options-loading-label', description: 'Status text while dynamic options are loading. Default: Loading options...' },
      { name: 'options-empty-label', description: 'Status text for a valid empty dynamic option list. Default: No options.' },
      { name: 'options-error-label', description: 'Status text when dynamic options are unavailable or malformed. Default: Options unavailable.' },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: `${signalsBindingDescription('value, label, disabled, options')} The options target only supports last-value bindings; options(any) and options(all) are invalid.` }
    ],
    snippet: '<nodel-group label="Source">\n  <nodel-segmented action="SetSource" signal="Source">\n    <nodel-button value="HDMI 1">HDMI 1</nodel-button>\n    <nodel-button value="HDMI 2">HDMI 2</nodel-button>\n  </nodel-segmented>\n</nodel-group>'
  },
  {
    name: 'nodel-select',
    catalogue: true,
    defaultSignalTarget: 'value',
    aggregateSignalTargets: ['disabled'],
    description: 'Touch picker for larger option sets using nodel-button options.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'placeholder', description: 'Text shown when no value is selected.' },
      { name: 'value', description: 'Current selected value.' },
      { name: 'action', description: 'Current-node action called when an option is selected.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phase: select.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and value signal.' },
      { name: 'arg-type', description: 'Parser for selected option values.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'variant', description: 'Picker visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Picker visual tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable the picker.' },
      { name: 'allow-deselect', description: 'Allow selecting the active option to clear value.' },
      { name: 'open', description: 'Start with the option panel open.' },
      { name: 'placement', description: 'Option panel placement. Auto uses visual-viewport space.', values: ['auto', 'bottom', 'top'] },
      { name: 'options-signal', description: 'SignalName[.path] source for dynamic option arrays. Accepts scalars, { value, label }, and v1 { key, value } entries.' },
      { name: 'options-loading-label', description: 'Status text while dynamic options are loading. Default: Loading options...' },
      { name: 'options-empty-label', description: 'Status text for a valid empty dynamic option list. Default: No options.' },
      { name: 'options-error-label', description: 'Status text when dynamic options are unavailable or malformed. Default: Options unavailable.' },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: `${signalsBindingDescription('value, label, disabled, options')} The options target only supports last-value bindings; options(any) and options(all) are invalid.` }
    ],
    snippet: '<nodel-group label="Source">\n  <nodel-select action="SetSource" signal="Source">\n    <nodel-button value="HDMI 1">HDMI 1</nodel-button>\n    <nodel-button value="HDMI 2">HDMI 2</nodel-button>\n  </nodel-select>\n</nodel-group>'
  },
  {
    name: 'nodel-fader',
    catalogue: true,
    defaultSignalTarget: 'value',
    aggregateSignalTargets: ['disabled'],
    description: 'Touch-first level fader with optional increment buttons and compound rail content.',
    attributes: [
      { name: 'orientation', description: 'Fader orientation.', values: ['vertical', 'horizontal'] },
      { name: 'compound-align', description: 'Compound rail alignment. Prefer bottom/center/top; end/right, start/left, and middle are compatibility aliases.', values: ['bottom', 'center', 'top', 'end', 'right', 'start', 'left', 'middle'] },
      { name: 'variant', description: 'Fader fill colour variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Fader rail/fill tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'min', description: 'Minimum value.', defaultDescription: 'Derived from unit: 0 for percent/none, -60 for dB.' },
      { name: 'max', description: 'Maximum value.', defaultDescription: 'Derived from unit: 100 for percent/none, 10 for dB.' },
      { name: 'step', description: 'Positive finite value step. Non-positive or invalid input falls back to 1.', defaultValue: '1' },
      { name: 'unit', description: 'Value display unit and default range.', values: ['percent', 'db', 'none'], defaultValue: 'percent' },
      { name: 'nudge', description: 'Positive finite increment for +/- controls. Invalid input falls back to step; presence enables increment buttons.' },
      { name: 'increment', description: 'Show +/- increment controls.' },
      { name: 'action', description: 'Current-node action name called on change.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phases: live, commit.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'arg-type', description: 'Parser for action arg.', values: ['number', 'string', 'json'] },
      { name: 'value', description: 'Current fader value.' },
      { name: 'disabled', description: 'Disable dragging and increment controls.' },
      { name: 'readout', description: 'Show or hide numeric value readout.', values: ['show', 'hide'] },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'title', description: 'Native slider title text.' },
      { name: 'live-interval', description: 'Throttled live action interval. Finite input is clamped to at least 50ms; invalid input falls back to 250ms.', defaultValue: '250', numeric: { min: 50, unit: 'ms', clamp: true } },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled') }
    ],
    snippet: '<nodel-group label="Volume">\n  <nodel-fader action="SetVolume" signal="Volume" nudge="5">\n    ${}\n  </nodel-fader>\n</nodel-group>'
  },
  {
    name: 'nodel-stepper',
    catalogue: true,
    defaultSignalTarget: 'value',
    aggregateSignalTargets: ['disabled'],
    description: 'Precise touch numeric increment/decrement control.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'value', description: 'Current numeric value.' },
      { name: 'min', description: 'Minimum value.', defaultValue: '0' },
      { name: 'max', description: 'Maximum value.', defaultValue: '100' },
      { name: 'step', description: 'Positive finite increment. Non-positive or invalid input falls back to 1.', defaultValue: '1' },
      { name: 'unit', description: 'Optional value unit formatting.', values: ['percent', 'db', 'none'] },
      { name: 'prefix', description: 'Display prefix for plain numbers.' },
      { name: 'suffix', description: 'Display suffix for plain numbers.' },
      { name: 'precision', description: 'Decimal precision for display. An integer prefix is parsed, then clamped to 0..10.', syntax: 'integer-prefixed text' },
      { name: 'repeat', description: 'Hold repeat mode.', values: ['hold', 'off'], defaultValue: 'hold' },
      { name: 'repeat-delay', description: 'Delay before hold repeat begins. Finite input is clamped to at least 0ms; invalid input falls back to 300ms.', defaultValue: '300', numeric: { min: 0, unit: 'ms', clamp: true } },
      { name: 'repeat-interval', description: 'Hold repeat interval. Finite input is clamped to at least 50ms; invalid input falls back to 200ms.', defaultValue: '200', numeric: { min: 50, unit: 'ms', clamp: true } },
      { name: 'action', description: 'Current-node action called on value changes.' },
      { name: 'actions', description: 'Action bindings. Supported phases: live, commit, increase, decrease.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and value signal.' },
      { name: 'arg-type', description: 'Parser for emitted value.', values: ['number', 'string', 'json'] },
      { name: 'variant', description: 'Stepper visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Stepper button tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable both buttons.' },
      { name: 'readout', description: 'Show or hide the numeric readout.', values: ['show', 'hide'] },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled') }
    ],
    snippet: '<nodel-group label="Temperature">\n  <nodel-stepper action="SetTemp" signal="Temp" min="16" max="28" step="0.5" suffix="C"></nodel-stepper>\n</nodel-group>'
  },
  {
    name: 'nodel-pad',
    catalogue: true,
    aggregateSignalTargets: ['disabled', 'center-disabled'],
    description: 'Directional touch pad with click or momentary press/release modes.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'center', description: 'Centre button behavior.', values: ['auto', 'show', 'hide', 'disabled'] },
      { name: 'press-mode', description: 'Button action mode.', values: ['click', 'momentary'] },
      { name: 'action', description: 'Shared action called with direction arg.' },
      { name: 'actions', description: 'Shared action bindings. Supported phases: click, press, release.' },
      { name: 'arg-type', description: 'Parser for direction arguments.', values: ['string', 'json'] },
      { name: 'up-action', description: 'Action for the up button.' },
      { name: 'down-action', description: 'Action for the down button.' },
      { name: 'left-action', description: 'Action for the left button.' },
      { name: 'right-action', description: 'Action for the right button.' },
      { name: 'center-action', description: 'Action for the centre button.' },
      { name: 'up-actions', description: 'Action bindings for the up button. Supported phases: click, press, release.', syntax: actionBindingSyntax },
      { name: 'down-actions', description: 'Action bindings for the down button. Supported phases: click, press, release.', syntax: actionBindingSyntax },
      { name: 'left-actions', description: 'Action bindings for the left button. Supported phases: click, press, release.', syntax: actionBindingSyntax },
      { name: 'right-actions', description: 'Action bindings for the right button. Supported phases: click, press, release.', syntax: actionBindingSyntax },
      { name: 'center-actions', description: 'Action bindings for the centre button. Supported phases: click, press, release.', syntax: actionBindingSyntax },
      { name: 'up-arg', description: 'Action argument for the up button.', defaultValue: 'up' },
      { name: 'down-arg', description: 'Action argument for the down button.', defaultValue: 'down' },
      { name: 'left-arg', description: 'Action argument for the left button.', defaultValue: 'left' },
      { name: 'right-arg', description: 'Action argument for the right button.', defaultValue: 'right' },
      { name: 'center-arg', description: 'Action argument for the centre button.', defaultValue: 'center' },
      { name: 'up-label', description: 'Accessible label for the up button.', defaultDescription: 'Derived: pad accessible label plus up, otherwise Up.' },
      { name: 'down-label', description: 'Accessible label for the down button.', defaultDescription: 'Derived: pad accessible label plus down, otherwise Down.' },
      { name: 'left-label', description: 'Accessible label for the left button.', defaultDescription: 'Derived: pad accessible label plus left, otherwise Left.' },
      { name: 'right-label', description: 'Accessible label for the right button.', defaultDescription: 'Derived: pad accessible label plus right, otherwise Right.' },
      { name: 'center-label', description: 'Accessible label for the centre button.', defaultDescription: 'Derived: pad accessible label plus center, otherwise Center.' },
      { name: 'variant', description: 'Pad visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Pad button tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable the whole pad.' },
      { name: 'center-disabled', description: 'Disable only the centre button.' },
      ...confirmationAttributes,
      { name: 'signal', description: 'Explicit signal binding in SignalName[.path]:target format. Supported targets: disabled, label, center-disabled.' },
      { name: 'signals', description: signalsBindingDescription('disabled, label, center-disabled') }
    ],
    snippet: '<nodel-group label="Navigate">\n  <nodel-pad action="Navigate" center="show"></nodel-pad>\n</nodel-group>'
  },
  {
    name: 'nodel-readout',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Read-only touch value/status tile with optional bar, ring, or status visuals.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'value', description: 'Current displayed value.' },
      { name: 'type', description: 'Value type.', values: ['text', 'number', 'percent', 'db', 'boolean', 'duration'], defaultValue: 'text' },
      { name: 'visual', description: 'Graphical representation.', values: ['none', 'bar', 'ring', 'status'], defaultDescription: 'Derived: status for boolean, none otherwise.' },
      { name: 'min', description: 'Minimum numeric value for visuals.', defaultDescription: 'Derived: 0 except -60 for dB.' },
      { name: 'max', description: 'Maximum numeric value for visuals.', defaultDescription: 'Derived: 100 except 10 for dB.' },
      { name: 'unit', description: 'Range unit used by numeric visuals when type is number.', values: ['percent', 'db', 'none'] },
      { name: 'prefix', description: 'Display prefix.' },
      { name: 'suffix', description: 'Display suffix.' },
      { name: 'precision', description: 'Decimal precision. An integer prefix is parsed, then clamped to 0..10.', syntax: 'integer-prefixed text' },
      { name: 'on-value', description: 'Exact value treated as on for boolean type.' },
      { name: 'off-value', description: 'Exact value treated as off for boolean type.' },
      { name: 'on-label', description: 'Boolean on-state display label.', defaultValue: 'On' },
      { name: 'off-label', description: 'Boolean off-state display label.', defaultValue: 'Off' },
      { name: 'warn', description: 'Warning threshold for numeric status visuals.', defaultDescription: 'Derived: 80% of the effective range.' },
      { name: 'danger', description: 'Danger threshold for numeric status visuals.', defaultDescription: 'Derived: 95% of the effective range.' },
      { name: 'empty', description: 'Text displayed for an empty or invalid value.', defaultValue: '--' },
      { name: 'variant', description: 'Readout visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Readout value/visual tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, variant, suffix, prefix') }
    ],
    snippet: '<nodel-group label="Brightness">\n  <nodel-readout type="percent" visual="ring" value="72"></nodel-readout>\n</nodel-group>'
  },
  {
    name: 'nodel-palette',
    catalogue: true,
    defaultSignalTarget: 'value',
    aggregateSignalTargets: ['disabled'],
    description: 'Swatch-first colour picker with predefined colour buttons and optional native custom colour input.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'value', description: 'Current selected colour or preset value.' },
      { name: 'action', description: 'Current-node action called when a swatch is selected.' },
      { name: 'actions', description: 'Action bindings. Supported phases: select, live, commit.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and value signal.' },
      { name: 'arg-type', description: 'Parser for selected values.', values: ['string', 'json'] },
      { name: 'columns', description: 'Internal swatch column count. An integer prefix is parsed, then clamped to 1..12.', syntax: 'integer-prefixed text', numeric: { min: 1, max: 12, clamp: true, normalizesToInteger: true } },
      { name: 'shape', description: 'Swatch shape.', values: ['square', 'rounded', 'circle'], defaultValue: 'rounded' },
      { name: 'picker', description: 'Optional custom colour picker.', values: ['off', 'native'], defaultValue: 'off' },
      { name: 'value-field', description: 'Custom colour value feedback mode.', values: ['readonly', 'editable', 'hidden'], defaultValue: 'readonly' },
      { name: 'format', description: 'Action payload colour format.', values: ['hex', 'rgb', 'hsl', 'hsv'] },
      { name: 'custom-label', description: 'Visible label for the native custom colour picker. Hidden when omitted.' },
      { name: 'live', description: 'Dispatch throttled custom-picker input updates.' },
      { name: 'live-interval', description: 'Live update interval. An integer prefix is parsed, then clamped to 50..1000ms.', syntax: 'integer-prefixed text', defaultValue: '100', numeric: { min: 50, max: 1000, unit: 'ms', clamp: true, normalizesToInteger: true } },
      { name: 'show-labels', description: 'Swatch label visibility.', values: ['auto', 'show', 'hide'] },
      { name: 'variant', description: 'Palette visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Palette swatch/custom-control tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable all swatches.' },
      { name: 'allow-deselect', description: 'Allow selecting the current swatch to clear the value.' },
      ...confirmationAttributes,
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled, custom-color') }
    ],
    snippet: '<nodel-group label="Colour">\n  <nodel-palette action="SetColour" signal="Colour" picker="native">\n    <nodel-button value="#ff0000" color="#ff0000">Red</nodel-button>\n    <nodel-button value="#00ff00" color="#00ff00">Green</nodel-button>\n    <nodel-button value="#0000ff" color="#0000ff">Blue</nodel-button>\n  </nodel-palette>\n</nodel-group>'
  },
  {
    name: 'nodel-meter',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Signal-driven level meter for percent or dB values.',
    attributes: [
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, peak, label') },
      { name: 'value', description: 'Current meter value.' },
      { name: 'min', description: 'Minimum value.', defaultDescription: 'Derived from unit: 0 for percent/none, -60 for dB.' },
      { name: 'max', description: 'Maximum value.', defaultDescription: 'Derived from unit: 100 for percent/none, 10 for dB.' },
      { name: 'unit', description: 'Value display unit and default range.', values: ['percent', 'db', 'none'], defaultValue: 'percent' },
      { name: 'curve', description: 'Visual display curve.', values: ['linear', 'vu', 'audio'], defaultDescription: 'Derived: linear for percent/none and vu for dB.' },
      { name: 'orientation', description: 'Meter orientation.', values: ['vertical', 'horizontal'], defaultValue: 'vertical' },
      { name: 'warn', description: 'Warning zone threshold.', defaultDescription: 'Derived: 80% of the effective range.' },
      { name: 'danger', description: 'Danger zone threshold.', defaultDescription: 'Derived: 95% of the effective range.' },
      { name: 'peak', description: 'Peak marker behavior.', values: ['off', 'hold'], defaultValue: 'off' },
      { name: 'readout', description: 'Show or hide numeric value readout.', values: ['show', 'hide'], defaultValue: 'hide' },
      { name: 'label', description: 'Accessible meter label.' },
      { name: 'aria-label', description: 'Explicit accessible meter label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible meter label.' }
    ],
    snippet: '<nodel-meter signal="Level" label="Level"></nodel-meter>'
  },
  {
    name: 'nodel-image',
    catalogue: true,
    defaultSignalTarget: 'src',
    description: 'Standalone or inline control image.',
    attributes: [
      { name: 'src', description: 'Image URL.' },
      { name: 'alt', description: 'Alternative text.' },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'fit', description: 'Image fit mode.', values: ['contain', 'cover'] },
      { name: 'shape', description: 'Image shape.', values: ['none', 'rounded', 'circle'] },
      { name: 'size', description: 'Image size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'signal', description: signalBindingDescription('src') },
      { name: 'signals', description: signalsBindingDescription('src, alt, label') }
    ],
    snippet: '<nodel-image src="${}" alt=""></nodel-image>'
  },
  {
    name: 'nodel-icon',
    catalogue: true,
    defaultSignalTarget: 'name',
    description: 'Standalone or inline control icon.',
    attributes: [
      { name: 'name', description: 'Built-in icon name.', values: ['image', ...controlIconNames.filter((name) => name !== 'image')] },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'alt', description: 'Accessible label without visible text.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'tone', description: 'Icon tone.', values: ['default', 'muted', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Icon size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'signal', description: signalBindingDescription('name') },
      { name: 'signals', description: signalsBindingDescription('name, alt, label, tone') }
    ],
    snippet: '<nodel-icon name="power"></nodel-icon>'
  },
  {
    name: 'nodel-link',
    catalogue: true,
    description: 'Static, discovered-node, or event-binding-derived link. Author exactly one destination attribute.',
    attributes: [
      { name: 'href', description: 'Safe relative or HTTP(S) URL.' },
      { name: 'node', description: 'Exact Nodel node name resolved through host discovery.' },
      { name: 'event-binding', description: 'Local remote-event binding alias whose target node should be opened.' },
      { name: 'target', description: 'Standard anchor browsing context, such as _blank.' },
      { name: 'rel', description: 'Standard anchor relationship tokens.' },
      { name: 'aria-label', description: 'Accessible link label override.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible link label.' },
      { name: 'aria-describedby', description: 'ID reference for supplementary link description.' },
      { name: 'title', description: 'Native link title text.' }
    ],
    snippet: '<nodel-link href="${}">Link</nodel-link>'
  },
  {
    name: 'nodel-qrcode',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Scan-safe signal-aware QR code with a fixed black-on-white high-correction symbol.',
    attributes: [
      { name: 'value', description: 'Exact text encoded into the QR code.' },
      { name: 'size', description: 'Square QR size. Unsigned decimal input rounds and clamps to 64..1024px; invalid syntax falls back to 128.', syntax: 'unsigned decimal', defaultValue: '128', numeric: { min: 64, max: 1024, unit: 'px', clamp: true, normalizesToInteger: true } },
      { name: 'help', description: 'Optional visible text below the QR code.' },
      { name: 'label', description: 'Accessible QR code label.' },
      { name: 'aria-label', description: 'Explicit accessible QR code label.' },
      { name: 'aria-labelledby', description: 'External accessible QR code label reference.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, help, label') }
    ],
    snippet: '<nodel-qrcode value="https://example.org" label="Visitor link"></nodel-qrcode>'
  },
  {
    name: 'nodel-status-indicator',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Small signal-driven status indicator for control children.',
    attributes: [
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label') },
      { name: 'value', description: 'Current indicator value.' },
      { name: 'on-value', description: 'Exact value that means on.' },
      { name: 'off-value', description: 'Exact value that means off.' },
      { name: 'partial-on-value', description: 'Exact value that means partially on.' },
      { name: 'partial-off-value', description: 'Exact value that means partially off.' },
      { name: 'tone', description: 'On-state tone.', values: ['success', 'info', 'warning', 'danger'] },
      { name: 'off-tone', description: 'Off-state tone.', values: ['off', 'muted'] },
      { name: 'partial-tone', description: 'Partial-state tone. Defaults to warning.', values: ['success', 'info', 'warning', 'danger'] },
      { name: 'show-state-label', description: 'Show the current state label beside the dot.' },
      { name: 'on-label', description: 'Visible on-state text.' },
      { name: 'off-label', description: 'Visible off-state text.' },
      { name: 'partial-on-label', description: 'Visible partially-on text.' },
      { name: 'partial-off-label', description: 'Visible partially-off text.' },
      { name: 'label', description: 'Accessible status label.' }
    ],
    snippet: '<nodel-status-indicator signal="${}" label="Status"></nodel-status-indicator>'
  },
  {
    name: 'nodel-status',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Signal-driven status block with group-like surfaces and flexible state mapping.',
    attributes: [
      { name: 'label', description: 'Visible status title and group accessible label.' },
      { name: 'value', description: 'Raw status value used for message text and inferred state aliases such as ready, warning, fault, or offline.' },
      { name: 'state', description: 'Explicit normalized state or a recognized state alias such as ready, warning, fault, or offline.', values: ['unknown', 'success', 'info', 'warning', 'danger', 'muted'], valueType: 'enum-or-string', syntax: 'recognized state alias' },
      { name: 'level', description: 'V1-style numeric status level. An integer prefix is parsed: 0=success, 1=warning, 2-4=danger, 5=info; other values are unknown.', valueType: 'string', syntax: 'integer-prefixed text' },
      { name: 'message', description: 'Explicit visible status message.' },
      { name: 'state-map', description: 'Custom value-to-state map, e.g. ready:success; standby:muted; fault:danger.' },
      { name: 'surface', description: 'Status block surface.', values: ['card', 'panel', 'none'] },
      { name: 'padding', description: 'Status block interior padding.', values: ['default', 'compact', 'none'] },
      { name: 'tone', description: 'Status block emphasis.', values: ['soft', 'outline', 'solid'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, state, level, message, label') }
    ],
    snippet: '<nodel-status label="Projector" signal="ProjectorStatus">\n  ${}\n</nodel-status>'
  },
  {
    name: 'nodel-collapse',
    catalogue: true,
    description: 'Collapsible section, closed by default.',
    attributes: [
      { name: 'label', description: 'Visible section label.' },
      { name: 'preview', description: 'Fallback preview text shown while collapsed.' },
      { name: 'open', description: 'Start expanded.' }
    ],
    snippet: '<nodel-collapse label="Section">\n  ${}\n</nodel-collapse>'
  },
  {
    name: 'nodel-description',
    description: 'Current node description rendered as markdown with a collapsed preview.',
    attributes: [
      { name: 'collapsed-height', description: 'Collapsed preview height, e.g. 8rem or 160px.' },
      { name: 'open', description: 'Start expanded.' }
    ],
    snippet: '<nodel-description></nodel-description>'
  },
  {
    name: 'nodel-text',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Theme-aware text block.',
    attributes: [
      { name: 'tone', description: 'Text tone.', values: ['muted', 'default', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Text size.', values: ['xs', 'sm', 'md', 'lg', 'xl'] },
      { name: 'surface', description: 'Optional surface style.', values: ['none', 'card'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: 'Signal bindings in SignalName[.path]:target format. Use target value for text content.' }
    ],
    snippet: '<nodel-text surface="card">${}</nodel-text>'
  },
  {
    name: 'nodel-title',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Theme-aware visible title or section heading.',
    attributes: [
      { name: 'level', description: 'Heading level.', values: ['1', '2', '3'] },
      { name: 'tone', description: 'Title tone.', values: ['default', 'muted', 'accent'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: 'Signal bindings in SignalName[.path]:target format. Use target value for title content.' }
    ],
    snippet: '<nodel-title level="1">${}</nodel-title>'
  },
  {
    name: 'nodel-markdown',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Sanitized literal or signal-driven Markdown content.',
    attributes: [
      { name: 'value', description: 'Markdown source text.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value') },
      { name: 'max-height', description: 'Constrained internal overflow height.', values: ['none', 'sm', 'md', 'lg', 'screen'] }
    ],
    snippet: '<nodel-markdown signal="${}"></nodel-markdown>'
  },
  {
    name: 'nodel-clock',
    catalogue: true,
    defaultSignalTarget: 'value',
    description: 'Explicit signal-driven date/time display without an autonomous timer.',
    attributes: [
      { name: 'value', description: 'Date/time input value.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value') },
      { name: 'format', description: 'Displayed date/time fields.', values: ['time', 'date', 'datetime'] },
      { name: 'hour12', description: '12-hour clock preference.', values: ['auto', 'true', 'false'] },
      { name: 'time-zone', description: 'Optional IANA time zone.' }
    ],
    snippet: '<nodel-clock signal="${}" format="time"></nodel-clock>'
  },
  {
    name: 'nodel-theme-toggle',
    catalogue: true,
    description: 'Theme toggle button for the nearest nodel-app.',
    attributes: []
  },
  {
    name: 'nodel-host-icon',
    catalogue: true,
    defaultSignalTarget: 'host',
    description: 'Generated host identicon.',
    attributes: [
      { name: 'host', description: 'Displayed/semantic host.' },
      { name: 'icon-host', description: 'Host used to generate the identicon.' },
      { name: 'href', description: 'Optional link target.' },
      { name: 'title', description: 'Title text.' },
      { name: 'alt', description: 'Image alt text.' },
      { name: 'signal', description: signalBindingDescription('host') },
      { name: 'signals', description: signalsBindingDescription('host, icon-host, href, title, alt') }
    ]
  },
  {
    name: 'nodel-node-list',
    description: 'Local or network node list.',
    attributes: [
      { name: 'scope', description: 'Node list scope.', values: ['local', 'network'] },
      { name: 'poll-interval', description: 'Polling interval in milliseconds.' },
      { name: 'page-size', description: 'Initial number of visible rows.', values: ['10', '20', '50', '100', '99999'] },
      { name: 'query-param', description: 'URL query parameter used once to prefill the initial filter.' },
      { name: 'show-filter', description: 'Show filter control.', values: ['true', 'false'] },
      { name: 'show-total', description: 'Show total count.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-node-list scope="local"></nodel-node-list>'
  },
  {
    name: 'nodel-add-node',
    description: 'Create or duplicate a node.',
    attributes: [
      { name: 'redirect', description: 'Redirect after creating node; defaults to true.', values: ['true', 'false'] },
      { name: 'recipes', description: 'Enable recipe selection.', values: ['true', 'false'] },
      { name: 'duplicate', description: 'Enable duplicate-from-existing-node.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-add-node></nodel-add-node>'
  },
  {
    name: 'nodel-node-menu',
    description: 'Current-node drawer menu for theme, rename, restart, delete, custom UIs, and reference links.',
    attributes: [],
    snippet: '<nodel-node-menu></nodel-node-menu>'
  },
  {
    name: 'nodel-diagnostics',
    description: 'Host diagnostics table.',
    attributes: []
  },
  {
    name: 'nodel-host-log',
    description: 'Host/server log viewer.',
    attributes: [],
    snippet: '<nodel-host-log></nodel-host-log>'
  },
  {
    name: 'nodel-diagnostic-charts',
    description: 'Host diagnostics measurement charts.',
    attributes: [],
    snippet: '<nodel-diagnostic-charts></nodel-diagnostic-charts>'
  },
  {
    name: 'nodel-toolkit',
    description: 'Host scripting toolkit reference.',
    attributes: [],
    snippet: '<nodel-toolkit></nodel-toolkit>'
  },
  {
    name: 'nodel-console',
    description: 'Node console history and command prompt.',
    attributes: [
      { name: 'collapse-preview', description: 'Emit preview updates for a parent nodel-collapse.', values: ['last-line'] }
    ]
  },
  {
    name: 'nodel-log',
    description: 'Node activity log with hold, filter, and limits.',
    attributes: []
  },
  {
    name: 'nodel-actsig',
    description: 'Schema-driven current-node actions and signals UI.',
    attributes: [],
    snippet: '<nodel-actsig></nodel-actsig>'
  },
  {
    name: 'nodel-params',
    description: 'Schema-driven current-node parameters form.',
    attributes: [],
    snippet: '<nodel-params></nodel-params>'
  },
  {
    name: 'nodel-bindings',
    description: 'Current-node remote binding workbench.',
    attributes: [],
    snippet: '<nodel-bindings></nodel-bindings>'
  },
  {
    name: 'nodel-editor',
    description: 'Node file editor with accessible upload, single-file drop, and lazy CodeMirror syntax modes.',
    attributes: [
      { name: 'default-file', description: 'File path to open by default.' }
    ],
    snippet: '<nodel-editor default-file="script.py"></nodel-editor>'
  },
  {
    name: 'nodel-toast-host',
    description: 'App-level toast notification host.',
    attributes: []
  },
  {
    name: 'nodel-confirm-host',
    description: 'App-level confirmation dialog host.',
    attributes: []
  },
  {
    name: 'nodel-connectivity-host',
    description: 'App-level host-connectivity presentation.',
    attributes: []
  }
];

const booleanAttributeNames = new Set([
  'active', 'allow-deselect', 'center-disabled', 'confirm', 'disabled', 'fixed', 'increment', 'live',
  'open', 'show-state-label'
]);

type AttributeDefaultMetadata = Pick<NodelAttributeDefinition, 'defaultValue' | 'defaultDescription'>;

// Only record a default when omission has defined runtime behaviour. Unconfigured inputs remain absent.
const attributeDefaultMetadata: Record<string, AttributeDefaultMetadata> = {
  'nodel-app.theme': { defaultDescription: 'Derived: stored theme preference, otherwise the system theme.' },
  'nodel-app.offline-mode': { defaultValue: 'modal' },
  'nodel-toolbar.title': { defaultDescription: 'Derived: app signal title or discovered node name when available.' },
  'nodel-toolbar.icon-alt': { defaultDescription: 'Derived: title.' },
  'nodel-page.title': { defaultDescription: 'Derived: Page for parent navigation when neither title nor nav-label is configured.' },
  'nodel-page.nav-label': { defaultDescription: 'Derived: title, otherwise Page.' },
  'nodel-page.nav-id': { defaultDescription: 'Derived: slugged navigation label/title, with a numeric suffix when needed for uniqueness.' },
  'nodel-page.arg-type': { defaultValue: 'string' },
  'nodel-footer.fixed': { defaultValue: 'false' },
  'nodel-group.surface': { defaultValue: 'card' },
  'nodel-group.padding': { defaultValue: 'default' },
  'nodel-column.sm': { defaultDescription: 'No override: inherits the base span.' },
  'nodel-column.md': { defaultDescription: 'No override: inherits the preceding breakpoint span.' },
  'nodel-column.lg': { defaultDescription: 'No override: inherits the preceding breakpoint span.' },
  'nodel-column.xl': { defaultDescription: 'No override: inherits the preceding breakpoint span.' },
  'nodel-column.2xl': { defaultDescription: 'No override: inherits the preceding breakpoint span.' },
  'nodel-column.order': { defaultValue: '0' },
  'nodel-column.sm-order': { defaultDescription: 'No override: inherits the base order.' },
  'nodel-column.md-order': { defaultDescription: 'No override: inherits the preceding breakpoint order.' },
  'nodel-column.lg-order': { defaultDescription: 'No override: inherits the preceding breakpoint order.' },
  'nodel-column.xl-order': { defaultDescription: 'No override: inherits the preceding breakpoint order.' },
  'nodel-column.2xl-order': { defaultDescription: 'No override: inherits the preceding breakpoint order.' },
  'nodel-control-grid.sm': { defaultDescription: 'No override: inherits the base column count.' },
  'nodel-control-grid.md': { defaultDescription: 'No override: inherits the preceding breakpoint column count.' },
  'nodel-control-grid.lg': { defaultDescription: 'No override: inherits the preceding breakpoint column count.' },
  'nodel-control-grid.xl': { defaultDescription: 'No override: inherits the preceding breakpoint column count.' },
  'nodel-control-grid.2xl': { defaultDescription: 'No override: inherits the preceding breakpoint column count.' },
  'nodel-button.variant': { defaultValue: 'default' },
  'nodel-button.tone': { defaultValue: 'solid' },
  'nodel-button.layout': { defaultValue: 'inline' },
  'nodel-button.size': { defaultValue: 'auto' },
  'nodel-button.arg-type': { defaultValue: 'string' },
  'nodel-button.active': { defaultValue: 'false' },
  'nodel-button.disabled': { defaultValue: 'false' },
  'nodel-button.confirm-title': { defaultDescription: 'Derived: Confirm action for direct actions; parent controls may provide contextual titles.' },
  'nodel-button.confirm-text': { defaultDescription: 'Derived from the button label/action unless confirm supplies text; parent controls may provide contextual text.' },
  'nodel-button.confirm-tone': { defaultDescription: 'Derived: warning for direct actions; parent controls may provide a contextual tone.' },
  'nodel-toggle.on-arg': { defaultValue: 'true' },
  'nodel-toggle.off-arg': { defaultValue: 'false' },
  'nodel-toggle.arg-type': { defaultValue: 'boolean' },
  'nodel-toggle.value': { defaultValue: 'off' },
  'nodel-toggle.variant': { defaultValue: 'success' },
  'nodel-toggle.off-variant': { defaultValue: 'default' },
  'nodel-toggle.tone': { defaultValue: 'solid' },
  'nodel-toggle.state-label': { defaultValue: 'hide' },
  'nodel-toggle.disabled': { defaultValue: 'false' },
  'nodel-toggle.on-label': { defaultValue: 'On' },
  'nodel-toggle.off-label': { defaultValue: 'Off' },
  'nodel-toggle.confirm-title': { defaultValue: 'Confirm toggle' },
  'nodel-toggle.confirm-text': { defaultDescription: 'Derived from the toggle label and requested on/off state unless confirm supplies text.' },
  'nodel-toggle.confirm-tone': { defaultDescription: 'Derived: success when turning on; info when turning off.' },
  'nodel-segmented.arg-type': { defaultValue: 'string' },
  'nodel-segmented.variant': { defaultValue: 'primary' },
  'nodel-segmented.tone': { defaultValue: 'solid' },
  'nodel-segmented.orientation': { defaultValue: 'horizontal' },
  'nodel-segmented.disabled': { defaultValue: 'false' },
  'nodel-segmented.allow-deselect': { defaultValue: 'false' },
  'nodel-segmented.options-loading-label': { defaultValue: 'Loading options...' },
  'nodel-segmented.options-empty-label': { defaultValue: 'No options' },
  'nodel-segmented.options-error-label': { defaultValue: 'Options unavailable' },
  'nodel-segmented.confirm-title': { defaultValue: 'Confirm selection' },
  'nodel-segmented.confirm-text': { defaultDescription: 'Derived from the selected option unless confirm supplies text.' },
  'nodel-segmented.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-select.arg-type': { defaultValue: 'string' },
  'nodel-select.variant': { defaultValue: 'default' },
  'nodel-select.tone': { defaultValue: 'solid' },
  'nodel-select.disabled': { defaultValue: 'false' },
  'nodel-select.allow-deselect': { defaultValue: 'false' },
  'nodel-select.open': { defaultValue: 'false' },
  'nodel-select.placement': { defaultValue: 'auto' },
  'nodel-select.placeholder': { defaultDescription: 'Derived: selected option/value, dynamic state, or Select.' },
  'nodel-select.options-loading-label': { defaultValue: 'Loading options...' },
  'nodel-select.options-empty-label': { defaultValue: 'No options' },
  'nodel-select.options-error-label': { defaultValue: 'Options unavailable' },
  'nodel-select.confirm-title': { defaultValue: 'Confirm selection' },
  'nodel-select.confirm-text': { defaultDescription: 'Derived from the selected option unless confirm supplies text.' },
  'nodel-select.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-fader.orientation': { defaultValue: 'vertical' },
  'nodel-fader.compound-align': { defaultValue: 'bottom' },
  'nodel-fader.variant': { defaultValue: 'default' },
  'nodel-fader.tone': { defaultValue: 'solid' },
  'nodel-fader.increment': { defaultValue: 'false' },
  'nodel-fader.disabled': { defaultValue: 'false' },
  'nodel-fader.readout': { defaultValue: 'show' },
  'nodel-fader.value': { defaultDescription: 'Derived: effective minimum.' },
  'nodel-fader.confirm-title': { defaultValue: 'Confirm value' },
  'nodel-fader.confirm-text': { defaultDescription: 'Derived from the label and formatted value unless confirm supplies text.' },
  'nodel-fader.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-stepper.unit': { defaultValue: 'none' },
  'nodel-stepper.variant': { defaultValue: 'default' },
  'nodel-stepper.tone': { defaultValue: 'solid' },
  'nodel-stepper.arg-type': { defaultValue: 'number' },
  'nodel-stepper.disabled': { defaultValue: 'false' },
  'nodel-stepper.readout': { defaultValue: 'show' },
  'nodel-stepper.value': { defaultDescription: 'Derived: effective minimum.' },
  'nodel-stepper.confirm-title': { defaultValue: 'Confirm value' },
  'nodel-stepper.confirm-text': { defaultDescription: 'Derived from the label and formatted value unless confirm supplies text.' },
  'nodel-stepper.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-pad.center': { defaultValue: 'auto' },
  'nodel-pad.press-mode': { defaultValue: 'click' },
  'nodel-pad.arg-type': { defaultValue: 'string' },
  'nodel-pad.variant': { defaultValue: 'default' },
  'nodel-pad.tone': { defaultValue: 'solid' },
  'nodel-pad.disabled': { defaultValue: 'false' },
  'nodel-pad.center-disabled': { defaultValue: 'false' },
  'nodel-pad.confirm-title': { defaultValue: 'Confirm action' },
  'nodel-pad.confirm-text': { defaultDescription: 'Derived from the selected direction label unless confirm supplies text.' },
  'nodel-pad.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-readout.unit': { defaultValue: 'percent' },
  'nodel-readout.variant': { defaultValue: 'default' },
  'nodel-readout.tone': { defaultValue: 'solid' },
  'nodel-palette.arg-type': { defaultValue: 'string' },
  'nodel-palette.format': { defaultValue: 'hex' },
  'nodel-palette.show-labels': { defaultValue: 'auto' },
  'nodel-palette.variant': { defaultValue: 'default' },
  'nodel-palette.tone': { defaultValue: 'solid' },
  'nodel-palette.disabled': { defaultValue: 'false' },
  'nodel-palette.live': { defaultValue: 'false' },
  'nodel-palette.allow-deselect': { defaultValue: 'false' },
  'nodel-palette.confirm-title': { defaultValue: 'Confirm colour' },
  'nodel-palette.confirm-text': { defaultDescription: 'Derived from the selected colour unless confirm supplies text.' },
  'nodel-palette.confirm-tone': { defaultDescription: 'info when confirmation is active.' },
  'nodel-meter.value': { defaultDescription: 'Derived: effective minimum.' },
  'nodel-image.fit': { defaultValue: 'contain' },
  'nodel-image.shape': { defaultValue: 'rounded' },
  'nodel-image.size': { defaultValue: 'auto' },
  'nodel-icon.name': { defaultValue: 'image' },
  'nodel-icon.tone': { defaultValue: 'default' },
  'nodel-icon.size': { defaultValue: 'auto' },
  'nodel-status-indicator.tone': { defaultValue: 'success' },
  'nodel-status-indicator.off-tone': { defaultValue: 'off' },
  'nodel-status-indicator.partial-tone': { defaultValue: 'warning' },
  'nodel-status-indicator.show-state-label': { defaultValue: 'false' },
  'nodel-status-indicator.on-label': { defaultValue: 'On' },
  'nodel-status-indicator.off-label': { defaultValue: 'Off' },
  'nodel-status-indicator.partial-on-label': { defaultValue: 'Partially on' },
  'nodel-status-indicator.partial-off-label': { defaultValue: 'Partially off' },
  'nodel-status.surface': { defaultValue: 'card' },
  'nodel-status.padding': { defaultValue: 'default' },
  'nodel-status.tone': { defaultValue: 'soft' },
  'nodel-status.state': { defaultDescription: 'Derived from state-map, level, structured value, or recognized value text.' },
  'nodel-collapse.label': { defaultValue: 'Details' },
  'nodel-collapse.open': { defaultValue: 'false' },
  'nodel-text.tone': { defaultValue: 'muted' },
  'nodel-text.size': { defaultValue: 'sm' },
  'nodel-text.surface': { defaultValue: 'none' },
  'nodel-title.level': { defaultValue: '1' },
  'nodel-title.tone': { defaultValue: 'default' },
  'nodel-markdown.max-height': { defaultValue: 'none' },
  'nodel-clock.format': { defaultValue: 'time' },
  'nodel-clock.hour12': { defaultValue: 'auto' },
  'nodel-host-icon.host': { defaultDescription: 'Derived: window.location.host.' },
  'nodel-host-icon.icon-host': { defaultDescription: 'Derived: host.' },
  'nodel-host-icon.title': { defaultDescription: 'Derived: host, or Browse this host when href is valid.' },
  'nodel-host-icon.alt': { defaultDescription: 'Derived: host.' }
};

function numericMetadataFor(elementName: string, attribute: NodelAttributeDefinition): NodelNumericConstraint | undefined {
  const name = attribute.name;
  if (elementName === 'nodel-template' && name === 'repeat') return { min: 0, max: 200, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-template' && (name === 'start' || name === 'step')) return {};
  if (['span', 'sm', 'md', 'lg', 'xl', '2xl'].includes(attribute.name) && (elementName === 'nodel-column' || elementName === 'nodel-control-grid')) {
    return { min: 1, max: 12, clamp: true, normalizesToInteger: true };
  }
  if (elementName === 'nodel-column' && ['order', 'sm-order', 'md-order', 'lg-order', 'xl-order', '2xl-order'].includes(name)) {
    return { min: -12, max: 12, clamp: true, normalizesToInteger: true };
  }
  if (['nodel-fader', 'nodel-stepper'].includes(elementName) && ['value', 'min', 'max'].includes(name)) return {};
  if (['nodel-fader', 'nodel-stepper'].includes(elementName) && ['step', 'nudge'].includes(name)) return { min: 0, exclusiveMin: true };
  if (elementName === 'nodel-fader' && name === 'live-interval') return { min: 50, unit: 'ms', clamp: true };
  if (elementName === 'nodel-stepper' && name === 'precision') return { min: 0, max: 10, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-stepper' && name === 'repeat-delay') return { min: 0, unit: 'ms', clamp: true };
  if (elementName === 'nodel-stepper' && name === 'repeat-interval') return { min: 50, unit: 'ms', clamp: true };
  if (elementName === 'nodel-readout' && ['min', 'max', 'warn', 'danger'].includes(name)) return {};
  if (elementName === 'nodel-readout' && name === 'precision') return { min: 0, max: 10, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-meter' && ['value', 'min', 'max', 'warn', 'danger'].includes(name)) return {};
  if (elementName === 'nodel-node-list' && name === 'poll-interval') return { min: 0, exclusiveMin: true, unit: 'ms' };
  return undefined;
}

function declarativeMetadataFor(element: NodelElementDefinition, attribute: NodelAttributeDefinition): Pick<NodelAttributeDefinition, 'valueType' | 'syntax'> {
  if (attribute.name === 'signal' || attribute.name === 'signals') {
    const binding = element.defaultSignalTarget ? 'SignalName[.path][:target]' : 'SignalName[.path]:target';
    const aggregateTargets = element.aggregateSignalTargets?.map((target) => `${target}(any|all)`).join(', ');
    return {
      valueType: 'binding',
      syntax: `${binding}[; or , ${binding} ...]${aggregateTargets ? `; aggregate targets: ${aggregateTargets}` : ''}`
    };
  }
  if (attribute.name === 'options-signal') return { valueType: 'binding', syntax: 'SignalName[.path]' };
  if (attribute.name === 'confirm-code-signal') return { valueType: 'string', syntax: 'LocalSignalAlias' };
  if (attribute.name === 'action' || attribute.name === 'actions' || attribute.name.endsWith('-action') || attribute.name.endsWith('-actions')) {
    return { valueType: 'string', syntax: actionBindingSyntax };
  }
  return {};
}

function enrichAttribute(element: NodelElementDefinition, attribute: NodelAttributeDefinition): NodelAttributeDefinition {
  const numeric = attribute.numeric ?? numericMetadataFor(element.name, attribute);
  const declarative = declarativeMetadataFor(element, attribute);
  const valueType = declarative.valueType ?? attribute.valueType
    ?? (attribute.values ? 'enum'
      : numeric ? (numeric.integer ? 'integer' : 'number')
        : booleanAttributeNames.has(attribute.name) ? 'boolean' : 'string');
  return { ...attributeDefaultMetadata[`${element.name}.${attribute.name}`], ...attribute, ...declarative, valueType, ...(numeric ? { numeric } : {}) };
}

export const nodelDocumentElements: NodelElementDefinition[] = rawNodelDocumentElements.map((element) => ({
  ...element,
  attributes: element.attributes.map((attribute) => enrichAttribute(element, attribute))
}));

export function findNodelElement(name: string) {
  return nodelDocumentElements.find((element) => element.name === name);
}

const visibilitySignalsDescription = ' Visibility may also be bound with SignalName[.path]:visibility in this same signals attribute.';

/** Returns catalogue rows with universal visibility attributes and one augmented signals row. */
export function getEffectiveCatalogueAttributes(elementOrName: NodelElementDefinition | string): NodelAttributeDefinition[] {
  const element = typeof elementOrName === 'string' ? findNodelElement(elementOrName) : elementOrName;
  if (!element) {
    return [];
  }
  const attributes = [...element.attributes];
  const signalsIndex = attributes.findIndex((attribute) => attribute.name === 'signals');
  if (signalsIndex !== -1 && !attributes[signalsIndex].description.includes('SignalName[.path]:visibility')) {
    attributes[signalsIndex] = {
      ...attributes[signalsIndex],
      description: `${attributes[signalsIndex].description}${visibilitySignalsDescription}`,
      syntax: `${attributes[signalsIndex].syntax}; SignalName[.path]:visibility(any|all)`
    };
  }
  for (const common of commonNodelAttributes) {
    if (!attributes.some((attribute) => attribute.name === common.name)) {
      attributes.push(common);
    }
  }
  return attributes;
}
