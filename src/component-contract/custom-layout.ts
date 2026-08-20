import type { NodelElementDefinition } from './types';
import { signalBindingDescription, signalsBindingDescription } from './values';

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
      { name: '2xl', description: '2XL breakpoint control column count. Finite input is truncated and clamped to 1..12.' },
      { name: 'fill', description: 'Request available column height when this is the sole visible substantive child of a nodel-column.' }
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
      { name: 'fill', description: 'Request available column height when this is the sole visible substantive child of a nodel-column.' }
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
