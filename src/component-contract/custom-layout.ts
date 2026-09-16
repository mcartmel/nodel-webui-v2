import type { NodelAttributeDefinition, NodelElementDefinition } from './types';
import { signalBindingDescription, signalsBindingDescription } from './values';
import { BACKGROUND_ATTRIBUTE_NAMES, BACKGROUND_DEFAULTS, BACKGROUND_PATTERN_IDS } from '../backgrounds/contract';
import { BACKGROUND_FIT_VALUES, BACKGROUND_POSITION_KEYWORD_VALUES } from '../backgrounds/metadata';

const backgroundPatternValues = [...BACKGROUND_PATTERN_IDS, 'none'];
const backgroundAttributes: NodelAttributeDefinition[] = [
  { name: 'background-color', description: 'Theme, opaque rgb(...) or hex backdrop colour; no alpha or arbitrary CSS.', syntax: 'theme | rgb(R G B) | rgb(R, G, B) | #RGB | #RRGGBB' },
  { name: 'background-image', description: 'Validated image URL/path; none clears an inherited image.', syntax: 'image path or URL | none' },
  { name: 'background-pattern', description: 'Neutral texture; none clears an inherited pattern.', values: backgroundPatternValues },
  { name: 'background-pattern-strength', description: 'Texture opacity, clamped 0..100; 0 disables it.', numeric: { min: 0, max: 100, clamp: true } },
  { name: 'background-brightness', description: 'Colour/image brightness, clamped 0..200; 100 is unchanged.', numeric: { min: 0, max: 200, clamp: true } },
  { name: 'background-pattern-scale', description: 'Texture scale, clamped 25..400; 100 is designed size.', numeric: { min: 25, max: 400, clamp: true } },
  { name: 'background-image-fit', description: 'Image sizing; cover/contain do not repeat, tile does.', values: [...BACKGROUND_FIT_VALUES] },
  { name: 'background-image-position', description: 'Standard position keywords or two percentages (0%..100%).', values: [...BACKGROUND_POSITION_KEYWORD_VALUES], valueType: 'enum-or-string', syntax: 'keyword or two percentages, e.g. center, left top, 50% 30%' }
];

const appBackgroundAttributes = backgroundAttributes.map((attribute) => ({ ...attribute }));
const pageBackgroundAttributes = backgroundAttributes.map((attribute) => ({ ...attribute }));

const backgroundDefaultValues: Record<string, string> = {
  'background-color': BACKGROUND_DEFAULTS.color,
  'background-image': 'none',
  'background-pattern': BACKGROUND_DEFAULTS.pattern,
  'background-pattern-strength': String(BACKGROUND_DEFAULTS.patternStrength),
  'background-brightness': String(BACKGROUND_DEFAULTS.brightness),
  'background-pattern-scale': String(BACKGROUND_DEFAULTS.patternScale),
  'background-image-fit': BACKGROUND_DEFAULTS.imageFit,
  'background-image-position': BACKGROUND_DEFAULTS.imagePosition
};

for (const attribute of appBackgroundAttributes) {
  attribute.defaultValue = backgroundDefaultValues[attribute.name]!;
}
for (const attribute of pageBackgroundAttributes) {
  attribute.defaultDescription = 'Omitted/empty inherits from the app or active ancestors; use explicit resets where supported.';
}

// Keep the shared list referenced here so contract and runtime cannot drift.
if (appBackgroundAttributes.length !== BACKGROUND_ATTRIBUTE_NAMES.length) throw new Error('Background contract is incomplete');

export const customLayoutElements: NodelElementDefinition[] = [
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
      { name: 'signals', description: signalsBindingDescription('title') },
      ...appBackgroundAttributes
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
      { name: 'icon-alt', description: 'Static toolbar icon alt text.' },
      { name: 'show-host-icon', description: 'Opt in to the generated host identicon and link.' }
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
      { name: 'arg-type', description: 'Parser for the activation argument.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'min-height', description: 'Minimum page height mode. auto preserves natural document flow; viewport uses the dynamic available height left by normal-flow shell content and may grow for intrinsic content.', values: ['auto', 'viewport'] },
      { name: 'bleed', description: 'Remove page-owned containment for an opted-in leaf page. Presence-only; does not affect navigation groups or fill ownership.', defaultValue: 'false' },
      ...pageBackgroundAttributes
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
      { name: '2xl', description: '2XL breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: 'fill', description: 'Request available height when this is the sole visible substantive child of a nodel-column, or directly inside a viewport leaf nodel-page.' }
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
      { name: 'padding', description: 'Group interior padding.', values: ['default', 'compact', 'none'] },
      { name: 'fill', description: 'Request available height when this is the sole visible substantive child of a nodel-column, or directly inside a viewport leaf nodel-page.' }
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
];
