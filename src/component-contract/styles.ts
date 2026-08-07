import type { ComponentContractStyles } from './types';

const named = (names: string[], description: string) => names.map((name) => ({ name, description }));

/** Stable authoring vocabulary, grouped so consumers need not infer class intent. */
export const componentContractStyles: ComponentContractStyles = {
  semanticClasses: named(['nodel-button', 'nodel-field', 'nodel-link', 'nodel-choice', 'nodel-card', 'nodel-panel', 'nodel-popover', 'nodel-list', 'nodel-list-item', 'nodel-menu-item', 'nodel-section-heading', 'nodel-alert', 'nodel-toast-host', 'nodel-toast'], 'Stable Nodel semantic class.'),
  stateClasses: named(['nodel-button-primary', 'nodel-button-success', 'nodel-button-info', 'nodel-button-warning', 'nodel-button-danger', 'nodel-button-soft', 'nodel-button-outline', 'nodel-button-ghost', 'nodel-button-link', 'nodel-button-compact', 'nodel-field-compact', 'nodel-menu-item-active', 'nodel-alert-sm', 'nodel-alert-md', 'nodel-alert-danger', 'is-disabled', 'is-unreachable'], 'Stable Nodel variant or state class.'),
  tailwindUtilities: named(['text-nodel-muted', 'text-nodel-fg', 'bg-nodel-surface', 'border-nodel-border', 'ring-nodel-accent', 'rounded-control', 'rounded-card', 'rounded-panel'], 'Named Nodel Tailwind utility.')
};
