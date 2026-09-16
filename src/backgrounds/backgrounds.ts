import { safeImageSrc } from '../utils/urls';
import { cssBackgroundUrl } from './css';
import {
  BACKGROUND_ATTRIBUTE_NAMES,
  BACKGROUND_DEFAULTS,
  BACKGROUND_PATTERN_IDS,
  normalizeBackgroundColor,
  normalizeBackgroundNumber,
  normalizeBackgroundPosition,
  type BackgroundPattern,
  type BackgroundSettings
} from './contract';

export * from './contract';

const patternDimensions: readonly (readonly [number, number])[] = [
  [48, 48], [192, 192], [768, 192], [192, 192], [32, 32],
  [48, 48], [60, 52], [240, 96], [360, 240]
];

function imageValue(value: string, base: string) {
  const safe = value === 'none' ? null : safeImageSrc(value, base);
  return safe ? new URL(safe, base).href : null;
}

export function isBackgroundElementOwnedBy(page: Element, app: Element) {
  return page.closest('nodel-app') === app;
}

function applyLevel(settings: BackgroundSettings, element: Element, base: string) {
  let customized = false;
  for (const name of BACKGROUND_ATTRIBUTE_NAMES) {
    const value = element.getAttribute(name)?.trim();
    if (!value) continue;
    switch (name.slice(11)) {
      case 'color': {
        const normalized = normalizeBackgroundColor(value);
        if (normalized) {
          settings.color = normalized;
          customized = true;
        }
        break;
      }
      case 'image':
        settings.image = imageValue(value, base);
        customized = true;
        break;
      case 'pattern':
        if (value === 'none' || (BACKGROUND_PATTERN_IDS as readonly string[]).includes(value)) {
          settings.pattern = value as BackgroundPattern;
          customized = true;
        }
        break;
      case 'pattern-strength': {
        const normalized = normalizeBackgroundNumber(value, 0, 100);
        if (normalized !== null) {
          settings.patternStrength = normalized;
          customized = true;
        }
        break;
      }
      case 'brightness': {
        const normalized = normalizeBackgroundNumber(value, 0, 200);
        if (normalized !== null) {
          settings.brightness = normalized;
          customized = true;
        }
        break;
      }
      case 'pattern-scale': {
        const normalized = normalizeBackgroundNumber(value, 25, 400);
        if (normalized !== null) {
          settings.patternScale = normalized;
          customized = true;
        }
        break;
      }
      case 'image-fit':
        if (value === 'cover' || value === 'contain' || value === 'tile') {
          settings.imageFit = value;
          customized = true;
        }
        break;
      case 'image-position': {
        const normalized = normalizeBackgroundPosition(value);
        if (normalized) {
          settings.imagePosition = normalized;
          customized = true;
        }
        break;
      }
    }
  }
  return customized;
}

export function resolveBackgroundSettings(app: Element, pages: readonly Element[] = [], base = document.baseURI) {
  const settings = { ...BACKGROUND_DEFAULTS };
  let customized = applyLevel(settings, app, base);
  for (const page of pages) {
    if (isBackgroundElementOwnedBy(page, app)) customized = applyLevel(settings, page, base) || customized;
  }
  return { settings, customized };
}

export function patternAsset(pattern: BackgroundPattern) {
  return pattern === 'none' ? null : `var(--nodel-background-pattern-${pattern})`;
}

export function patternSize(pattern: BackgroundPattern, scale: number) {
  const [width, height] = patternDimensions[(BACKGROUND_PATTERN_IDS as readonly string[]).indexOf(pattern)] ?? [1, 1];
  return `${width * scale / 100}px ${height * scale / 100}px`;
}

export function renderBackground(app: HTMLElement, resolved: ReturnType<typeof resolveBackgroundSettings>) {
  const { settings, customized } = resolved;
  if (!customized) {
    clearBackground(app);
    return;
  }
  app.dataset.backgroundActive = 'true';
  const values = [
    settings.color === 'theme' ? 'rgb(var(--nodel-bg))' : settings.color,
    cssBackgroundUrl(settings.image),
    patternAsset(settings.pattern) ?? 'none',
    String(settings.brightness / 100),
    String(settings.patternStrength / 100),
    patternSize(settings.pattern, settings.patternScale),
    settings.imageFit === 'tile' ? 'auto' : settings.imageFit,
    settings.imageFit === 'tile' ? 'repeat' : 'no-repeat',
    settings.imagePosition
  ];
  backgroundProperties.forEach((property, index) => app.style.setProperty(`--nodel-background-${property}`, values[index]!));
}

const backgroundProperties = [
  'color', 'image', 'pattern', 'brightness', 'pattern-opacity',
  'pattern-size', 'image-size', 'image-repeat', 'image-position'
] as const;

export function clearBackground(app: HTMLElement) {
  app.dataset.backgroundActive = 'false';
  for (const property of backgroundProperties) app.style.removeProperty(`--nodel-background-${property}`);
}
