export const controlIconNames = [
  'action', 'arrow', 'event', 'image', 'info', 'link', 'moon', 'mute', 'pause', 'play',
  'power', 'sliders', 'stop', 'success', 'sun', 'warning', 'volume', 'volume-low'
] as const;

export type ControlIconName = (typeof controlIconNames)[number];
