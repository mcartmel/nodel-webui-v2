export const controlIconNames = [
  'action', 'arrow', 'event', 'image', 'info', 'link', 'moon', 'mute', 'pause', 'play',
  'power', 'sliders', 'stop', 'success', 'sun', 'warning', 'volume', 'volume-low'
] as const;

export const controlIconAliases = { action: 'person-running', arrow: 'arrow-right', event: 'traffic-light', mute: 'volume-xmark' } as const;

export type ControlIconName = (typeof controlIconNames)[number];
