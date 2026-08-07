import type { ComponentContract } from './types';

const actionFields = ['action', 'phase', 'phases', 'arg', 'payload', 'results', 'failures', 'committed', 'live'];
const actionErrorFields = ['action', 'phase', 'phases', 'value', 'arg', 'payload', 'results', 'failures', 'committed', 'live', 'error'];

function event(name: string, description: string, detailFields: string[], composed = false): ComponentContract['events'][number] {
  return { name, description, bubbles: true, composed, detailFields };
}

function controlEvents(name: string, submittedName: string, submittedDescription: string, submittedFields: string[]): ComponentContract['events'] {
  return [
    event(submittedName, submittedDescription, submittedFields),
    event(`nodel-${name}-error`, `Reports a failed ${name} action.`, actionErrorFields)
  ];
}

export const componentEventMap: Record<string, ComponentContract['events']> = {
  'nodel-app': [
    event('nodel-node-restarted', 'Reports a detected node restart.', ['previousTimestamp', 'timestamp', 'expectation']),
    event('nodel-theme-change', 'Reports the active application theme.', ['theme'])
  ],
  'nodel-page': [event('nodel-page-action-error', 'Reports a failed page activation action.', [...actionFields, 'error'], true)],
  'nodel-template': [event('nodel-template-rendered', 'Reports completion of a template render.', ['repeat'])],
  'nodel-button': controlEvents('button', 'nodel-button-submitted', 'Reports a completed button action submission.', actionFields),
  'nodel-toggle': controlEvents('toggle', 'nodel-toggle-change', 'Reports a toggle state change.', [...actionFields, 'state', 'value']),
  'nodel-segmented': [
    ...controlEvents('segmented', 'nodel-segmented-change', 'Reports a segmented option selection.', [...actionFields, 'value']),
    event('nodel-options-updated', 'Reports a reconciled dynamic option set.', ['count', 'state']),
    event('nodel-options-error', 'Reports an invalid dynamic option payload.', ['message', 'issues'])
  ],
  'nodel-select': [
    ...controlEvents('select', 'nodel-select-change', 'Reports a selected option.', [...actionFields, 'value']),
    event('nodel-options-updated', 'Reports a reconciled dynamic option set.', ['count', 'state']),
    event('nodel-options-error', 'Reports an invalid dynamic option payload.', ['message', 'issues'])
  ],
  'nodel-fader': controlEvents('fader', 'nodel-fader-change', 'Reports a live or committed fader value.', [...actionFields, 'value']),
  'nodel-stepper': controlEvents('stepper', 'nodel-stepper-change', 'Reports a live or committed stepper value.', [...actionFields, 'value', 'direction']),
  'nodel-pad': controlEvents('pad', 'nodel-pad-action', 'Reports a directional pad action phase.', [...actionFields, 'direction', 'value']),
  'nodel-palette': controlEvents('palette', 'nodel-palette-change', 'Reports a selected, live, or committed colour.', [...actionFields, 'value']),
  'nodel-qrcode': [event('nodel-qrcode-error', 'Reports an invalid or unrenderable QR payload.', ['message', 'reason'])],
  'nodel-collapse': [event('nodel-collapse-toggle', 'Reports a disclosure state change.', ['open'])],
  'nodel-add-node': [
    event('nodel-node-duplicate-partial', 'Reports a node duplication that retained partial results.', ['url', 'copied', 'skipped', 'skippedDetails', 'failed']),
    event('nodel-node-created', 'Reports a created node URL.', ['url']),
    event('nodel-add-node-error', 'Reports a failed node creation or duplication.', ['error', 'name', 'url'])
  ],
  'nodel-node-menu': [event('nodel-node-menu-navigate', 'Requests navigation from the node menu.', ['url'])],
  'nodel-console': [event('nodel-collapse-preview', 'Reports a plain-text preview for a parent collapse.', ['source', 'text'])],
  'nodel-actsig': [
    event('nodel-actsig-submitted', 'Reports a submitted action or signal form.', ['type', 'name', 'payload']),
    event('nodel-actsig-error', 'Reports a failed action or signal submission.', ['type', 'name', 'error'])
  ],
  'nodel-params': [
    event('nodel-params-saved', 'Reports saved node parameters.', ['payload']),
    event('nodel-params-error', 'Reports a failed parameter save.', ['error', 'payload'])
  ],
  'nodel-bindings': [
    event('nodel-bindings-saved', 'Reports saved remote bindings.', ['payload']),
    event('nodel-bindings-error', 'Reports a failed remote-binding save.', ['error', 'payload'])
  ],
  'nodel-editor': [
    event('nodel-editor-error', 'Reports a file editor operation error.', ['message']),
    event('nodel-editor-file-saved', 'Reports a saved node file.', ['path']),
    event('nodel-editor-file-created', 'Reports a created node file.', ['path']),
    event('nodel-editor-file-deleted', 'Reports a deleted node file.', ['path'])
  ]
};
