import { faArrowRight, faLink, faMoon, faPersonRunning, faSun, faTrafficLight } from '@fortawesome/free-solid-svg-icons';

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

export function renderFontAwesomeIcon(icon: FontAwesomeIcon, className = 'h-3.5 w-3.5') {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  const pathMarkup = paths.map((path) => `<path fill="currentColor" d="${path}"></path>`).join('');

  return `<svg aria-hidden="true" focusable="false" data-icon="${icon.iconName}" viewBox="0 0 ${width} ${height}" class="${className}">${pathMarkup}</svg>`;
}
