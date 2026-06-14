export type LevelUnit = 'percent' | 'db' | 'none';
export type LevelCurve = 'linear' | 'vu';

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

export function normalizeLevelCurve(value: string | null, unit: LevelUnit): LevelCurve {
  if (value === 'linear') {
    return 'linear';
  }
  if (value === 'vu' || value === 'audio') {
    return 'vu';
  }
  return unit === 'db' ? 'vu' : 'linear';
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

export function valueToDisplayFraction(value: number, min: number, max: number, curve: LevelCurve) {
  if (curve === 'linear') {
    return valueToFraction(value, min, max);
  }

  return vuValueToFraction(value, min, max);
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

function vuValueToFraction(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 0;
  }

  const clampedValue = clampValue(value, min, max);
  if (min >= 0 || max <= min) {
    return valueToFraction(clampedValue, min, max);
  }

  if (max <= 0) {
    return exponentialDbFraction(clampedValue, min, max);
  }

  if (clampedValue <= 0) {
    return exponentialDbFraction(clampedValue, min, 0) * 0.88;
  }

  return 0.88 + valueToFraction(clampedValue, 0, max) * 0.12;
}

function exponentialDbFraction(value: number, min: number, max: number) {
  if (max <= min) {
    return 0;
  }

  const minPower = Math.pow(10, min / 40);
  const maxPower = Math.pow(10, max / 40);
  const valuePower = Math.pow(10, value / 40);
  if (maxPower === minPower) {
    return 0;
  }

  return clampValue((valuePower - minPower) / (maxPower - minPower), 0, 1);
}

function decimalPlaces(value: number) {
  const text = String(value);
  const decimalIndex = text.indexOf('.');
  return decimalIndex === -1 ? 0 : text.length - decimalIndex - 1;
}
