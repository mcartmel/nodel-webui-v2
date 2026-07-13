import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

export interface NodelAttributeDefinition {
  name: string;
  description: string;
  values?: string[];
}

export interface NodelElementDefinition {
  name: string;
  description: string;
  attributes: NodelAttributeDefinition[];
  snippet?: string;
}

const commonNodelAttributes: NodelAttributeDefinition[] = [
  {
    name: 'visibility',
    description: 'Local signal controlling component visibility. Supports SignalName.path extraction. visible/true/1 shows; hidden/false/0 hides.'
  }
];

const signalBindingDescription = (defaultTarget: string) => `Signal binding in SignalName[.path]:target format, or shorthand signal name/path for ${defaultTarget}.`;
const signalsBindingDescription = (targets: string) => `Signal bindings in SignalName[.path]:target format. Supported targets: ${targets}.`;
const commonIconValues = ['sun', 'moon', 'power', 'volume', 'volume-low', 'mute', 'warning', 'success', 'info'];

export const nodelDocumentElements: NodelElementDefinition[] = [
  {
    name: 'nodel-app',
    description: 'Top-level Nodel application shell.',
    attributes: [
      { name: 'title', description: 'Runtime page title.' },
      { name: 'theme', description: 'Theme selection.', values: ['default', 'light', 'dark'] }
    ],
    snippet: '<nodel-app title="Nodel">\n  ${}\n</nodel-app>'
  },
  {
    name: 'nodel-toolbar',
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
    description: 'Selectable app page or nav group.',
    attributes: [
      { name: 'title', description: 'Page title used for heading/navigation.' },
      { name: 'nav-id', description: 'Stable explicit navigation id.' }
    ],
    snippet: '<nodel-page title="Page">\n  ${}\n</nodel-page>'
  },
  {
    name: 'nodel-row',
    description: 'Responsive layout row.',
    attributes: [],
    snippet: '<nodel-row>\n  <nodel-column>\n    ${}\n  </nodel-column>\n</nodel-row>'
  },
  {
    name: 'nodel-column',
    description: 'Responsive layout column.',
    attributes: [
      { name: 'span', description: 'Base 12-column span.' },
      { name: 'sm', description: 'Small breakpoint 12-column span.' },
      { name: 'md', description: 'Medium breakpoint 12-column span.' },
      { name: 'lg', description: 'Large breakpoint 12-column span.' }
    ],
    snippet: '<nodel-column md="6">\n  ${}\n</nodel-column>'
  },
  {
    name: 'nodel-control-grid',
    description: 'Equal-cell grid for touch controls.',
    attributes: [
      { name: 'columns', description: 'Base control column count.' },
      { name: 'sm', description: 'Small breakpoint control column count.' },
      { name: 'md', description: 'Medium breakpoint control column count.' },
      { name: 'lg', description: 'Large breakpoint control column count.' }
    ],
    snippet: '<nodel-control-grid columns="3">\n  ${}\n</nodel-control-grid>'
  },
  {
    name: 'nodel-control-space',
    description: 'Empty placeholder cell inside a nodel-control-grid.',
    attributes: [],
    snippet: '<nodel-control-space></nodel-control-space>'
  },
  {
    name: 'nodel-group',
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
    description: 'Authoring macro that renders placeholder-filled clones from a native template.',
    attributes: [
      { name: 'template', description: 'ID of a shared native template element to render.' },
      { name: 'name', description: 'Base name exposed as {{name}} and used by {{item}}.' },
      { name: 'repeat', description: 'Number of clones to render. Defaults to 1.' },
      { name: 'start', description: 'First numeric {{number}} value. Defaults to 1.' },
      { name: 'step', description: 'Increment between rendered {{number}} values. Defaults to 1.' }
    ],
    snippet: '<nodel-template name="Zone" repeat="4">\n  <template>\n    <nodel-button join="{{item}}">{{name}} {{number}}</nodel-button>\n  </template>\n</nodel-template>'
  },
  {
    name: 'nodel-button',
    description: 'Touch-sized action or state button.',
    attributes: [
      { name: 'variant', description: 'Button visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link'] },
      { name: 'tone', description: 'Button visual tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'layout', description: 'Button child layout.', values: ['inline', 'stack'] },
      { name: 'size', description: 'Button size. Auto uses the context default.', values: ['auto', 'sm', 'md', 'lg'] },
      { name: 'action', description: 'Current-node action name to call on click.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phases: click, press, release.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'action-on', description: 'Legacy alias for a press-phase momentary action.' },
      { name: 'action-off', description: 'Legacy alias for a release-phase momentary action.' },
      { name: 'arg', description: 'Optional action argument value.' },
      { name: 'arg-type', description: 'Parser for arg.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'disabled', description: 'Disable the button.' },
      { name: 'active', description: 'Mark the button active/pressed.' },
      { name: 'active-value', description: 'Optional active-state signal value when it differs from arg.' },
      { name: 'confirm', description: 'Require confirmation before calling click or press actions.' },
      { name: 'confirm-title', description: 'Confirmation dialog title.' },
      { name: 'confirm-text', description: 'Confirmation dialog body text.' },
      { name: 'confirm-tone', description: 'Confirmation dialog tone.', values: ['info', 'success', 'warning', 'danger'] },
      { name: 'aria-label', description: 'Accessible label for icon-only or image-only buttons.' },
      { name: 'title', description: 'Native button title text.' },
      { name: 'signal', description: signalBindingDescription('active') },
      { name: 'signals', description: signalsBindingDescription('active, label, disabled') }
    ],
    snippet: '<nodel-button action="ActionName">${}</nodel-button>'
  },
  {
    name: 'nodel-toggle',
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
      { name: 'on-label', description: 'State label shown for on/partially-on.' },
      { name: 'off-label', description: 'State label shown for off/partially-off.' },
      { name: 'on-icon', description: 'State icon shown for on/partially-on.', values: commonIconValues },
      { name: 'off-icon', description: 'State icon shown for off/partially-off.', values: commonIconValues },
      { name: 'state-label', description: 'Show or hide visible state text. Hidden by default.', values: ['hide', 'show'] },
      { name: 'variant', description: 'On-state colour variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger'] },
      { name: 'off-variant', description: 'Off-state colour variant. Default keeps the off state neutral.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger'] },
      { name: 'tone', description: 'Switch track tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable the switch.' },
      { name: 'confirm', description: 'Require confirmation before calling the action.' },
      { name: 'confirm-title', description: 'Confirmation dialog title.' },
      { name: 'confirm-text', description: 'Confirmation dialog body text.' },
      { name: 'confirm-tone', description: 'Confirmation dialog tone.', values: ['info', 'success', 'warning', 'danger'] },
      { name: 'signal', description: signalBindingDescription('state') },
      { name: 'signals', description: signalsBindingDescription('state, label, disabled') }
    ],
    snippet: '<nodel-group label="Theme">\n  <nodel-toggle action="SetTheme" signal="Theme" off-label="Light" on-label="Dark" off-icon="sun" on-icon="moon" state-label="show"></nodel-toggle>\n</nodel-group>'
  },
  {
    name: 'nodel-segmented',
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
      { name: 'options-signal', description: 'SignalName[.path] source for dynamic option arrays. Accepts scalars, { value, label }, and v1 { key, value } entries.' },
      { name: 'options-loading-label', description: 'Status text while dynamic options are loading. Default: Loading options...' },
      { name: 'options-empty-label', description: 'Status text for a valid empty dynamic option list. Default: No options.' },
      { name: 'options-error-label', description: 'Status text when dynamic options are unavailable or malformed. Default: Options unavailable.' },
      { name: 'confirm', description: 'Require confirmation before applying a selection.' },
      { name: 'confirm-title', description: 'Confirmation dialog title.' },
      { name: 'confirm-text', description: 'Confirmation dialog body text.' },
      { name: 'confirm-tone', description: 'Confirmation dialog tone.', values: ['info', 'success', 'warning', 'danger'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: `${signalsBindingDescription('value, label, disabled, options')} The options target only supports last-value bindings; options(any) and options(all) are invalid.` }
    ],
    snippet: '<nodel-group label="Source">\n  <nodel-segmented action="SetSource" signal="Source">\n    <nodel-button value="HDMI 1">HDMI 1</nodel-button>\n    <nodel-button value="HDMI 2">HDMI 2</nodel-button>\n  </nodel-segmented>\n</nodel-group>'
  },
  {
    name: 'nodel-select',
    description: 'Touch picker for larger option sets using nodel-button options.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
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
      { name: 'options-signal', description: 'SignalName[.path] source for dynamic option arrays. Accepts scalars, { value, label }, and v1 { key, value } entries.' },
      { name: 'options-loading-label', description: 'Status text while dynamic options are loading. Default: Loading options...' },
      { name: 'options-empty-label', description: 'Status text for a valid empty dynamic option list. Default: No options.' },
      { name: 'options-error-label', description: 'Status text when dynamic options are unavailable or malformed. Default: Options unavailable.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: `${signalsBindingDescription('value, label, disabled, options')} The options target only supports last-value bindings; options(any) and options(all) are invalid.` }
    ],
    snippet: '<nodel-group label="Source">\n  <nodel-select action="SetSource" signal="Source">\n    <nodel-button value="HDMI 1">HDMI 1</nodel-button>\n    <nodel-button value="HDMI 2">HDMI 2</nodel-button>\n  </nodel-select>\n</nodel-group>'
  },
  {
    name: 'nodel-fader',
    description: 'Touch-first level fader with optional increment buttons and compound rail content.',
    attributes: [
      { name: 'orientation', description: 'Fader orientation.', values: ['vertical', 'horizontal'] },
      { name: 'compound-align', description: 'Compound rail alignment. Defaults to bottom/end.', values: ['bottom', 'center', 'top'] },
      { name: 'variant', description: 'Fader fill colour variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Fader rail/fill tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'min', description: 'Minimum value.' },
      { name: 'max', description: 'Maximum value.' },
      { name: 'step', description: 'Value step.' },
      { name: 'unit', description: 'Value display unit and default range.', values: ['percent', 'db', 'none'] },
      { name: 'nudge', description: 'Increment amount for +/- controls. Presence enables increment buttons.' },
      { name: 'increment', description: 'Show +/- increment controls.' },
      { name: 'action', description: 'Current-node action name called on change.' },
      { name: 'actions', description: 'Action bindings in ActionName:phase format. Supported phases: change, live, commit.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and the default signal binding.' },
      { name: 'arg-type', description: 'Parser for action arg.', values: ['number', 'string', 'json'] },
      { name: 'value', description: 'Current fader value.' },
      { name: 'disabled', description: 'Disable dragging and increment controls.' },
      { name: 'readout', description: 'Show or hide numeric value readout.', values: ['show', 'hide'] },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'live-interval', description: 'Throttled live action interval in milliseconds.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled') }
    ],
    snippet: '<nodel-group label="Volume">\n  <nodel-fader action="SetVolume" signal="Volume" nudge="5">\n    ${}\n  </nodel-fader>\n</nodel-group>'
  },
  {
    name: 'nodel-stepper',
    description: 'Precise touch numeric increment/decrement control.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'value', description: 'Current numeric value.' },
      { name: 'min', description: 'Minimum value.' },
      { name: 'max', description: 'Maximum value.' },
      { name: 'step', description: 'Increment size.' },
      { name: 'unit', description: 'Optional value unit formatting.', values: ['percent', 'db', 'none'] },
      { name: 'suffix', description: 'Display suffix for plain numbers.' },
      { name: 'precision', description: 'Decimal precision for display.' },
      { name: 'repeat', description: 'Hold repeat mode.', values: ['hold', 'off'] },
      { name: 'action', description: 'Current-node action called on value changes.' },
      { name: 'actions', description: 'Action bindings. Supported phases: change, live, commit, increase, decrease.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and value signal.' },
      { name: 'arg-type', description: 'Parser for emitted value.', values: ['number', 'string', 'json'] },
      { name: 'variant', description: 'Stepper visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Stepper button tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable both buttons.' },
      { name: 'readout', description: 'Show or hide the numeric readout.', values: ['show', 'hide'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled') }
    ],
    snippet: '<nodel-group label="Temperature">\n  <nodel-stepper action="SetTemp" signal="Temp" min="16" max="28" step="0.5" suffix="C"></nodel-stepper>\n</nodel-group>'
  },
  {
    name: 'nodel-pad',
    description: 'Directional touch pad with click or momentary press/release modes.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'center', description: 'Centre button behavior.', values: ['auto', 'show', 'hide', 'disabled'] },
      { name: 'press-mode', description: 'Button action mode.', values: ['click', 'momentary'] },
      { name: 'action', description: 'Shared action called with direction arg.' },
      { name: 'actions', description: 'Shared action bindings. Supported phases: click, press, release.' },
      { name: 'up-action', description: 'Action for the up button.' },
      { name: 'down-action', description: 'Action for the down button.' },
      { name: 'left-action', description: 'Action for the left button.' },
      { name: 'right-action', description: 'Action for the right button.' },
      { name: 'center-action', description: 'Action for the centre button.' },
      { name: 'variant', description: 'Pad visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Pad button tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable the whole pad.' },
      { name: 'center-disabled', description: 'Disable only the centre button.' },
      { name: 'signals', description: signalsBindingDescription('disabled, label, center-disabled') }
    ],
    snippet: '<nodel-group label="Navigate">\n  <nodel-pad action="Navigate" center="show"></nodel-pad>\n</nodel-group>'
  },
  {
    name: 'nodel-readout',
    description: 'Read-only touch value/status tile with optional bar, ring, or status visuals.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'value', description: 'Current displayed value.' },
      { name: 'type', description: 'Value type.', values: ['text', 'number', 'percent', 'db', 'boolean', 'duration'] },
      { name: 'visual', description: 'Graphical representation.', values: ['none', 'bar', 'ring', 'status'] },
      { name: 'min', description: 'Minimum numeric value for visuals.' },
      { name: 'max', description: 'Maximum numeric value for visuals.' },
      { name: 'suffix', description: 'Display suffix.' },
      { name: 'precision', description: 'Decimal precision.' },
      { name: 'variant', description: 'Readout visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Readout value/visual tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, variant, suffix, prefix') }
    ],
    snippet: '<nodel-group label="Brightness">\n  <nodel-readout type="percent" visual="ring" value="72"></nodel-readout>\n</nodel-group>'
  },
  {
    name: 'nodel-palette',
    description: 'Swatch-first colour picker with predefined colour buttons and optional native custom colour input.',
    attributes: [
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'value', description: 'Current selected colour or preset value.' },
      { name: 'action', description: 'Current-node action called when a swatch is selected.' },
      { name: 'actions', description: 'Action bindings. Supported phase: select.' },
      { name: 'join', description: 'Shorthand that uses the same name for action and value signal.' },
      { name: 'arg-type', description: 'Parser for selected values.', values: ['string', 'json'] },
      { name: 'columns', description: 'Internal swatch column count.' },
      { name: 'shape', description: 'Swatch shape.', values: ['square', 'rounded', 'circle'] },
      { name: 'picker', description: 'Optional custom colour picker.', values: ['off', 'native'] },
      { name: 'show-labels', description: 'Swatch label visibility.', values: ['auto', 'show', 'hide'] },
      { name: 'variant', description: 'Palette visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'] },
      { name: 'tone', description: 'Palette swatch/custom-control tone.', values: ['solid', 'soft', 'outline'] },
      { name: 'disabled', description: 'Disable all swatches.' },
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label, disabled, custom-color') }
    ],
    snippet: '<nodel-group label="Colour">\n  <nodel-palette action="SetColour" signal="Colour" picker="native">\n    <nodel-button value="#ff0000" color="#ff0000">Red</nodel-button>\n    <nodel-button value="#00ff00" color="#00ff00">Green</nodel-button>\n    <nodel-button value="#0000ff" color="#0000ff">Blue</nodel-button>\n  </nodel-palette>\n</nodel-group>'
  },
  {
    name: 'nodel-meter',
    description: 'Signal-driven level meter for percent or dB values.',
    attributes: [
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, peak, label') },
      { name: 'value', description: 'Current meter value.' },
      { name: 'min', description: 'Minimum value.' },
      { name: 'max', description: 'Maximum value.' },
      { name: 'unit', description: 'Value display unit and default range.', values: ['percent', 'db', 'none'] },
      { name: 'curve', description: 'Visual display curve. Defaults to linear for percent/none and vu for dB.', values: ['linear', 'vu', 'audio'] },
      { name: 'orientation', description: 'Meter orientation.', values: ['vertical', 'horizontal'] },
      { name: 'warn', description: 'Warning zone threshold.' },
      { name: 'danger', description: 'Danger zone threshold.' },
      { name: 'peak', description: 'Peak marker behavior.', values: ['off', 'hold'] },
      { name: 'readout', description: 'Show or hide numeric value readout.', values: ['show', 'hide'] },
      { name: 'label', description: 'Accessible meter label.' }
    ],
    snippet: '<nodel-meter signal="Level" label="Level"></nodel-meter>'
  },
  {
    name: 'nodel-image',
    description: 'Standalone or inline control image.',
    attributes: [
      { name: 'src', description: 'Image URL.' },
      { name: 'alt', description: 'Alternative text.' },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
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
    description: 'Standalone or inline control icon.',
    attributes: [
      { name: 'name', description: 'Built-in icon name.' },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'alt', description: 'Accessible label without visible text.' },
      { name: 'tone', description: 'Icon tone.', values: ['default', 'muted', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Icon size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'signal', description: signalBindingDescription('name') },
      { name: 'signals', description: signalsBindingDescription('name, alt, label, tone') }
    ],
    snippet: '<nodel-icon name="power"></nodel-icon>'
  },
  {
    name: 'nodel-status-indicator',
    description: 'Small signal-driven status indicator for control children.',
    attributes: [
      { name: 'signal', description: signalBindingDescription('value') },
      { name: 'signals', description: signalsBindingDescription('value, label') },
      { name: 'value', description: 'Current indicator value.' },
      { name: 'on-value', description: 'Exact value that means on.' },
      { name: 'off-value', description: 'Exact value that means off.' },
      { name: 'tone', description: 'On-state tone.', values: ['success', 'info', 'warning', 'danger'] },
      { name: 'off-tone', description: 'Off-state tone.', values: ['off', 'muted'] },
      { name: 'label', description: 'Accessible status label.' }
    ],
    snippet: '<nodel-status-indicator signal="${}" label="Status"></nodel-status-indicator>'
  },
  {
    name: 'nodel-status',
    description: 'Signal-driven status block with group-like surfaces and flexible state mapping.',
    attributes: [
      { name: 'label', description: 'Visible status title and group accessible label.' },
      { name: 'value', description: 'Raw status value used for message text and state inference.' },
      { name: 'state', description: 'Explicit normalized state or inferable state text.', values: ['unknown', 'success', 'info', 'warning', 'danger', 'muted'] },
      { name: 'level', description: 'V1-style numeric status level. 0=success, 1=warning, 2-4=danger, 5=info.' },
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
    name: 'nodel-theme-toggle',
    description: 'Theme toggle button for the nearest nodel-app.',
    attributes: []
  },
  {
    name: 'nodel-host-icon',
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
      { name: 'page-size', description: 'Initial number of visible rows.' },
      { name: 'show-filter', description: 'Show filter control.', values: ['true', 'false'] },
      { name: 'show-total', description: 'Show total count.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-node-list scope="local"></nodel-node-list>'
  },
  {
    name: 'nodel-add-node',
    description: 'Create or duplicate a node.',
    attributes: [
      { name: 'redirect', description: 'Redirect after creating node.', values: ['true', 'false'] },
      { name: 'recipes', description: 'Enable recipe selection.', values: ['true', 'false'] },
      { name: 'duplicate', description: 'Enable duplicate-from-existing-node.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-add-node redirect="false"></nodel-add-node>'
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
    description: 'Node file editor using CodeMirror.',
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
  }
];

export const nodelDocumentSnippets: Completion[] = [
  {
    label: 'nodel-page scaffold',
    type: 'text',
    apply: '<nodel-page title="Page">\n  <nodel-row>\n    <nodel-column>\n      ${}\n    </nodel-column>\n  </nodel-row>\n</nodel-page>',
    detail: 'Nodel page with row and column'
  },
  {
    label: 'nodel custom page head',
    type: 'text',
    apply: '<link rel="stylesheet" href="./v2/nodel-webui.css" />\n<script type="module" src="./v2/nodel-webui.js"></script>',
    detail: 'Stable v2 asset references'
  }
];

export function findNodelElement(name: string) {
  return nodelDocumentElements.find((element) => element.name === name);
}

function elementCompletions(): Completion[] {
  return nodelDocumentElements.map((element) => ({
    label: element.name,
    type: 'class',
    detail: element.description,
    apply: element.snippet ?? `<${element.name}></${element.name}>`
  }));
}

function attributeCompletions(tagName: string): Completion[] {
  const element = findNodelElement(tagName);
  const attributes = tagName.startsWith('nodel-')
    ? [...(element?.attributes ?? []), ...commonNodelAttributes.filter((common) => !element?.attributes.some((attribute) => attribute.name === common.name))]
    : (element?.attributes ?? []);

  return attributes.map((attribute) => ({
    label: attribute.name,
    type: 'property',
    detail: attribute.description,
    apply: attribute.values?.length ? `${attribute.name}="${attribute.values[0]}"` : `${attribute.name}=""`
  }));
}

function valueCompletions(tagName: string, attributeName: string): Completion[] {
  const element = findNodelElement(tagName);
  const attribute = element?.attributes.find((item) => item.name === attributeName)
    ?? (tagName.startsWith('nodel-') ? commonNodelAttributes.find((item) => item.name === attributeName) : undefined);

  return (attribute?.values ?? []).map((value) => ({
    label: value,
    type: 'constant',
    apply: value
  }));
}

export function completeNodelDocument(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
  const tagName = before.match(/<\/?([a-z][\w-]*)[^<>]*$/i)?.[1] ?? '';
  const attributeValue = before.match(/<([a-z][\w-]*)[^<>]*\s([a-z][\w-]*)="[^"]*$/i);

  if (attributeValue) {
    return {
      from: context.pos,
      options: valueCompletions(attributeValue[1], attributeValue[2])
    };
  }

  if (tagName && before.includes('<') && !before.endsWith('</')) {
    const word = context.matchBefore(/[\w-]*$/);
    return {
      from: word?.from ?? context.pos,
      options: attributeCompletions(tagName)
    };
  }

  const tag = context.matchBefore(/<\/?[\w-]*$/);
  if (tag) {
    const slashOffset = tag.text.startsWith('</') ? 2 : 1;
    return {
      from: tag.from + slashOffset,
      options: elementCompletions()
    };
  }

  const word = context.matchBefore(/[\w-]*$/);
  if (context.explicit && word) {
    return {
      from: word.from,
      options: [...elementCompletions(), ...nodelDocumentSnippets]
    };
  }

  return null;
}
