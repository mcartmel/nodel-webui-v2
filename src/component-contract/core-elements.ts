import type { NodelElementDefinition } from './types';

export const coreElements: NodelElementDefinition[] = [
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
    name: 'nodel-node-list',
    description: 'Local or network node list.',
    attributes: [
      { name: 'scope', description: 'Node list scope.', values: ['local', 'network'] },
      { name: 'poll-interval', description: 'Polling interval in milliseconds.' },
      { name: 'page-size', description: 'Initial number of visible rows.', values: ['10', '20', '50', '100', '99999'] },
      { name: 'query-param', description: 'URL query parameter used once to prefill the initial filter.' },
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
];
