import type { NodelElementDefinition } from './types';
import { preferredToggleIconNames, signalBindingDescription, signalsBindingDescription } from './values';

export const customContentElements: NodelElementDefinition[] = [
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
      { name: 'name', description: 'Preferred Nodel icon aliases plus canonical names from the generated Font Awesome catalogue, which is the exhaustive source for authored icon values.', valueType: 'enum-or-string', syntax: 'Generated catalogue canonical name or preserved Nodel alias', values: ['image', ...preferredToggleIconNames.filter((iconName) => iconName !== 'image')] },
      { name: 'family', description: 'Icon family selected from the installed generated catalogue.', valueType: 'string', syntax: 'Generated catalogue family identifier' },
      { name: 'style', description: 'Icon style selected from the installed generated catalogue for the effective family.', valueType: 'string', syntax: 'Generated catalogue style identifier' },
      { name: 'label', description: 'Accessibility/fallback label. Use nodel-group label for visible captions.' },
      { name: 'alt', description: 'Accessible label without visible text.' },
      { name: 'aria-label', description: 'Explicit accessible label.' },
      { name: 'aria-labelledby', description: 'ID reference for the accessible label.' },
      { name: 'tone', description: 'Icon tone.', values: ['default', 'muted', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Icon size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'signal', description: signalBindingDescription('name') },
      { name: 'signals', description: signalsBindingDescription('name, family, style, alt, label, tone') }
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
];
