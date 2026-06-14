export type LevelUnit = 'percent' | 'db' | 'none';

export interface LevelRange {
  min: number;
  max: number;
}

export interface LevelScale extends LevelRange {
  step: number;
  unit: LevelUnit;
}

export function normalizeLevelUnit(value: string | null): LevelUnit {
  return value === 'db' || value === 'none' ? value : 'percent';
}

export function defaultRangeForUnit(unit: LevelUnit): LevelRange {
  if (unit === 'db') {
    return { min: -60, max: 10 };
  }

  return { min: 0, max: 100 };
}

export function parseNumber(value: string | null, fallback = 0) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value.trim().replace(/%|db/gi, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, Math.max(low, value));
}

export function normalizeStep(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function snapToStep(value: number, min: number, step: number) {
  const normalizedStep = normalizeStep(step);
  const snapped = min + Math.round((value - min) / normalizedStep) * normalizedStep;
  const decimals = decimalPlaces(normalizedStep);
  return Number(snapped.toFixed(Math.min(10, decimals + 2)));
}

export function valueToFraction(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 0;
  }

  return clampValue((value - min) / (max - min), 0, 1);
}

export function fractionToValue(fraction: number, min: number, max: number) {
  const safeFraction = clampValue(fraction, 0, 1);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return min;
  }

  return min + (max - min) * safeFraction;
}

export function formatValue(value: number, unit: LevelUnit) {
  const displayValue = trimNumber(value);
  if (unit === 'db') {
    const sign = value > 0 ? '+' : '';
    return `${sign}${displayValue} dB`;
  }

  if (unit === 'percent') {
    return `${displayValue}%`;
  }

  return displayValue;
}

function trimNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  if (Number.isInteger(value)) {
    return String(Math.round(value));
  }

  return String(Number(value.toFixed(1)));
}

function decimalPlaces(value: number) {
  const text = String(value);
  const decimalIndex = text.indexOf('.');
  return decimalIndex === -1 ? 0 : text.length - decimalIndex - 1;
}
