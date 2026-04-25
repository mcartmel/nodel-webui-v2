import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';

type FontAwesomeIcon = typeof faSun;

export const themeIcons = {
  moon: faMoon,
  sun: faSun
};

export function renderFontAwesomeIcon(icon: FontAwesomeIcon) {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  const pathMarkup = paths.map((path) => `<path fill="currentColor" d="${path}"></path>`).join('');

  return `<svg aria-hidden="true" focusable="false" data-icon="${icon.iconName}" viewBox="0 0 ${width} ${height}" class="h-3.5 w-3.5">${pathMarkup}</svg>`;
}
