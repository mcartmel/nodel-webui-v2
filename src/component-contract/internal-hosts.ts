import type { NodelElementDefinition } from './types';

export const internalHostElements: NodelElementDefinition[] = [
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
