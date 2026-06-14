import {
  clampValue,
  defaultRangeForUnit,
  formatValue,
  fractionToValue,
  normalizeLevelCurve,
  normalizeLevelUnit,
  parseNumber,
  snapToStep,
  valueToDisplayFraction,
  valueToFraction
} from '../src/utils/level-scale';

describe('level-scale', () => {
  it('normalizes units and default ranges', () => {
    expect(normalizeLevelUnit('db')).toBe('db');
    expect(normalizeLevelUnit('none')).toBe('none');
    expect(normalizeLevelUnit('invalid')).toBe('percent');
    expect(defaultRangeForUnit('percent')).toEqual({ min: 0, max: 100 });
    expect(defaultRangeForUnit('none')).toEqual({ min: 0, max: 100 });
    expect(defaultRangeForUnit('db')).toEqual({ min: -60, max: 10 });
    expect(normalizeLevelCurve(null, 'percent')).toBe('linear');
    expect(normalizeLevelCurve(null, 'none')).toBe('linear');
    expect(normalizeLevelCurve(null, 'db')).toBe('vu');
    expect(normalizeLevelCurve('audio', 'percent')).toBe('vu');
    expect(normalizeLevelCurve('linear', 'db')).toBe('linear');
  });

  it('clamps, snaps, and maps values linearly', () => {
    expect(clampValue(120, 0, 100)).toBe(100);
    expect(clampValue(-20, 0, 100)).toBe(0);
    expect(snapToStep(6.26, 0, 0.5)).toBe(6.5);
    expect(valueToFraction(50, 0, 100)).toBe(0.5);
    expect(fractionToValue(0.5, -60, 10)).toBe(-25);
    expect(valueToFraction(10, 10, 10)).toBe(0);
  });

  it('formats percent, dB, and raw values', () => {
    expect(formatValue(55, 'percent')).toBe('55%');
    expect(formatValue(-12.5, 'db')).toBe('-12.5 dB');
    expect(formatValue(3, 'db')).toBe('+3 dB');
    expect(formatValue(4.4, 'none')).toBe('4.4');
  });

  it('parses numeric signal text safely', () => {
    expect(parseNumber('55%', 0)).toBe(55);
    expect(parseNumber('-12 dB', 0)).toBe(-12);
    expect(parseNumber('bad', 7)).toBe(7);
    expect(parseNumber(null, 9)).toBe(9);
  });

  it('maps VU display fractions for dB-style meters', () => {
    expect(valueToDisplayFraction(-60, -60, 10, 'vu')).toBe(0);
    expect(valueToDisplayFraction(0, -60, 10, 'vu')).toBeCloseTo(0.88, 5);
    expect(valueToDisplayFraction(10, -60, 10, 'vu')).toBe(1);
    expect(valueToDisplayFraction(-20, -60, 10, 'vu')).toBeCloseTo(0.2586, 3);
    expect(valueToDisplayFraction(-20, -60, 10, 'linear')).toBeCloseTo(40 / 70, 5);
  });
});
