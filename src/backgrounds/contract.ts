export const BACKGROUND_ATTRIBUTE_NAMES = [
  'background-color',
  'background-image',
  'background-pattern',
  'background-pattern-strength',
  'background-brightness',
  'background-pattern-scale',
  'background-image-fit',
  'background-image-position'
] as const;

export type BackgroundAttributeName = typeof BACKGROUND_ATTRIBUTE_NAMES[number];

export const BACKGROUND_PATTERN_IDS = [
  'carbon-fibre',
  'checkerplate',
  'brushed-metal',
  'woven-fabric',
  'diagonal-grain',
  'dotted-grid',
  'hexagonal-mesh',
  'ripples',
  'concentric-waves'
] as const;

export type BackgroundPattern = typeof BACKGROUND_PATTERN_IDS[number] | 'none';
export type BackgroundFit = 'cover' | 'contain' | 'tile';
export type BackgroundPosition = 'left' | 'center' | 'right' | 'top' | 'bottom' | `${number}% ${number}%`;
export type BackgroundColor = 'theme' | `rgb(${number} ${number} ${number})`;

export interface BackgroundSettings {
  color: BackgroundColor;
  image: string | null;
  pattern: BackgroundPattern;
  patternStrength: number;
  brightness: number;
  patternScale: number;
  imageFit: BackgroundFit;
  imagePosition: BackgroundPosition;
}

export const BACKGROUND_DEFAULTS: BackgroundSettings = {
  color: 'theme',
  image: null,
  pattern: 'none',
  patternStrength: 25,
  brightness: 100,
  patternScale: 100,
  imageFit: 'cover',
  imagePosition: 'center'
};

const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const unsignedNumberPattern = /^(?:\d+\.?\d*|\.\d+)$/;
const percentagePositionPattern = /^(\d+\.?\d*|\.\d+)% (\d+\.?\d*|\.\d+)%$/;
const keywordPositionPattern = /^(?:(?:left|center|right)(?: (?:top|center|bottom))?|(?:top|bottom)(?: (?:left|center|right))?)$/;

export function normalizeBackgroundColor(value: string): BackgroundColor | null {
  const cleaned = value.trim();
  if (cleaned === 'theme') return 'theme';
  const hexMatch = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(cleaned);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const channels = hex.length === 3 ? [...hex].map((channel) => channel.repeat(2)) : hex.match(/../g)!;
    return `rgb(${channels.map((channel) => parseInt(channel, 16)).join(' ')})` as BackgroundColor;
  }
  const body = cleaned.startsWith('rgb(') && cleaned.endsWith(')') ? cleaned.slice(4, -1).trim() : '';
  if (!body) return null;
  const channels = body.split(body.includes(',') ? /\s*,\s*/ : /\s+/);
  if (channels.length !== 3 || channels.some((channel) => !unsignedNumberPattern.test(channel))) return null;
  const numbers = channels.map(Number);
  return numbers.every((channel) => channel <= 255)
    ? `rgb(${numbers.map((channel) => Number(channel.toFixed(4))).join(' ')})` as BackgroundColor
    : null;
}

export function normalizeBackgroundNumber(value: string, minimum: number, maximum: number) {
  const cleaned = value.trim();
  if (!numberPattern.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : null;
}

export function normalizeBackgroundPosition(value: string): BackgroundPosition | null {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (keywordPositionPattern.test(cleaned)) return cleaned as BackgroundPosition;
  const percentages = percentagePositionPattern.exec(cleaned);
  if (!percentages) return null;
  const first = Number(percentages[1]);
  const second = Number(percentages[2]);
  return first <= 100 && second <= 100
    ? `${first}% ${second}%`
    : null;
}
