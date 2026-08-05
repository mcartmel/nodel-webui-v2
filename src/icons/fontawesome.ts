import {
  faArrowRight,
  faBars,
  faChevronDown,
  faChevronRight,
  faChevronUp,
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faCopy,
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
  faSpinner,
  faStop,
  faSun,
  faTrafficLight,
  faTriangleExclamation,
  faVolumeHigh,
  faVolumeLow,
  faVolumeXmark,
  faXmark
} from '@fortawesome/free-solid-svg-icons';
import { controlIconNames, type ControlIconName } from './control-icon-names';

export { controlIconNames } from './control-icon-names';
export type { ControlIconName } from './control-icon-names';

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
  copy: faCopy,
  image: faImage,
  pause: faPause,
  minus: faMinus,
  play: faPlay,
  plus: faPlus,
  power: faPowerOff,
  sliders: faSliders,
  spinner: faSpinner,
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

const controlIconMap = {
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
} satisfies Record<ControlIconName, FontAwesomeIcon>;

export const controlIcons = Object.fromEntries(
  controlIconNames.map((name) => [name, controlIconMap[name]])
) as Record<ControlIconName, FontAwesomeIcon>;

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
