import {
  faArrowRight,
  faBars,
  faChevronDown,
  faChevronRight,
  faChevronUp,
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faImage,
  faLink,
  faMoon,
  faPause,
  faMinus,
  faPersonRunning,
  faPlay,
  faPlus,
  faPowerOff,
  faSliders,
  faStop,
  faSun,
  faTrafficLight,
  faTriangleExclamation,
  faVolumeHigh,
  faVolumeLow,
  faVolumeXmark,
  faXmark
} from '@fortawesome/free-solid-svg-icons';

type FontAwesomeIcon = typeof faSun;

export const themeIcons = {
  moon: faMoon,
  sun: faSun
};

export const logIcons = {
  action: faPersonRunning,
  event: faTrafficLight,
  actionBinding: faLink,
  eventBinding: faLink,
  remote: faArrowRight
};

export const uiIcons = {
  bars: faBars,
  chevronDown: faChevronDown,
  chevronRight: faChevronRight,
  chevronUp: faChevronUp,
  image: faImage,
  pause: faPause,
  minus: faMinus,
  play: faPlay,
  plus: faPlus,
  power: faPowerOff,
  sliders: faSliders,
  stop: faStop,
  volume: faVolumeHigh,
  volumeLow: faVolumeLow,
  volumeMute: faVolumeXmark,
  xmark: faXmark
};

export const toastIcons = {
  danger: faCircleXmark,
  info: faCircleInfo,
  success: faCircleCheck,
  warning: faTriangleExclamation
};

export const controlIcons = {
  action: logIcons.action,
  arrow: logIcons.remote,
  event: logIcons.event,
  image: uiIcons.image,
  info: toastIcons.info,
  link: logIcons.actionBinding,
  moon: themeIcons.moon,
  mute: uiIcons.volumeMute,
  pause: uiIcons.pause,
  play: uiIcons.play,
  power: uiIcons.power,
  sliders: uiIcons.sliders,
  stop: uiIcons.stop,
  success: toastIcons.success,
  sun: themeIcons.sun,
  warning: toastIcons.warning,
  volume: uiIcons.volume,
  'volume-low': uiIcons.volumeLow
} as const;

export type ControlIconName = keyof typeof controlIcons;

export function iconForName(value: string | null, fallback?: FontAwesomeIcon) {
  const key = (value ?? '').trim() as ControlIconName;
  return controlIcons[key] ?? fallback;
}

export function renderFontAwesomeIcon(icon: FontAwesomeIcon, className = 'h-3.5 w-3.5') {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  const pathMarkup = paths.map((path) => `<path fill="currentColor" d="${path}"></path>`).join('');

  return `<svg aria-hidden="true" focusable="false" data-icon="${icon.iconName}" viewBox="0 0 ${width} ${height}" class="${className}">${pathMarkup}</svg>`;
}
