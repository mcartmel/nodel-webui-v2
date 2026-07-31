export type NodelColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsv';

export interface NodelColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const nodelColorFormats: NodelColorFormat[] = ['hex', 'rgb', 'hsl', 'hsv'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function numericToken(value: string, unit: 'none' | 'percent' | 'angle' = 'none') {
  const suffix = unit === 'percent' ? '%' : unit === 'angle' ? '(?:deg)?' : '';
  const match = new RegExp(`^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?${suffix}$`, 'i').exec(value.trim());
  return match ? Number.parseFloat(value) : null;
}

function channel(value: string) {
  const isPercent = value.trim().endsWith('%');
  const parsed = numericToken(value, isPercent ? 'percent' : 'none');
  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }
  return isPercent ? clamp(parsed * 2.55, 0, 255) : clamp(parsed, 0, 255);
}

function percentage(value: string) {
  if (!value.trim().endsWith('%')) {
    return null;
  }
  const parsed = numericToken(value, 'percent');
  return parsed !== null && Number.isFinite(parsed) ? clamp(parsed / 100, 0, 1) : null;
}

function alpha(value: string | undefined) {
  if (value === undefined) {
    return 1;
  }
  const isPercent = value.trim().endsWith('%');
  const parsed = numericToken(value, isPercent ? 'percent' : 'none');
  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }
  return isPercent ? clamp(parsed / 100, 0, 1) : clamp(parsed, 0, 1);
}

function functionParts(value: string, name: string) {
  const match = new RegExp(`^${name}a?\\((.*)\\)$`, 'i').exec(value.trim());
  if (!match) {
    return null;
  }
  const [channels, alphaPart, ...extra] = match[1].split(/\s*\/\s*/);
  if (extra.length > 0 || (alphaPart !== undefined && channels.includes(','))) {
    return null;
  }
  const parts = channels.includes(',') ? channels.split(',').map((part) => part.trim()) : channels.trim().split(/\s+/);
  if (alphaPart !== undefined) {
    parts.push(alphaPart.trim());
  }
  return parts;
}

function hue(value: string) {
  const parsed = numericToken(value, 'angle');
  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }
  return ((parsed % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): Pick<NodelColor, 'r' | 'g' | 'b'> {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function hsvToRgb(h: number, s: number, v: number): Pick<NodelColor, 'r' | 'g' | 'b'> {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function parseColor(value: string): NodelColor | null {
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? Array.from(hex, (part) => `${part}${part}`).join('') : hex;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    };
  }

  const rgb = functionParts(trimmed, 'rgb');
  if (rgb && (rgb.length === 3 || rgb.length === 4)) {
    const [r, g, b] = rgb.slice(0, 3).map(channel);
    const a = alpha(rgb[3]);
    return r === null || g === null || b === null || a === null ? null : { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
  }

  for (const mode of ['hsl', 'hsv'] as const) {
    const parts = functionParts(trimmed, mode);
    if (!parts || (parts.length !== 3 && parts.length !== 4)) {
      continue;
    }
    const h = hue(parts[0]);
    const s = percentage(parts[1]);
    const third = percentage(parts[2]);
    const a = alpha(parts[3]);
    if (h === null || s === null || third === null || a === null) {
      return null;
    }
    return { ...(mode === 'hsl' ? hslToRgb(h, s, third) : hsvToRgb(h, s, third)), a };
  }

  return null;
}

function hexChannel(value: number) {
  return Math.round(value).toString(16).padStart(2, '0');
}

function concise(value: number) {
  return String(Number(value.toFixed(1)));
}

function conciseAlpha(value: number) {
  return String(Number(value.toFixed(6)));
}

function rgbToHsl(color: NodelColor) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  const h = delta === 0 ? 0
    : max === r ? 60 * (((g - b) / delta) % 6)
      : max === g ? 60 * ((b - r) / delta + 2)
        : 60 * ((r - g) / delta + 4);
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

function rgbToHsv(color: NodelColor) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const h = delta === 0 ? 0
    : max === r ? 60 * (((g - b) / delta) % 6)
      : max === g ? 60 * ((b - r) / delta + 2)
        : 60 * ((r - g) / delta + 4);
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max * 100, v: max * 100 };
}

export function formatColor(color: NodelColor, format: NodelColorFormat) {
  const alphaSuffix = color.a < 1 ? `, ${conciseAlpha(color.a)}` : '';
  if (format === 'rgb') {
    return color.a < 1
      ? `rgba(${color.r}, ${color.g}, ${color.b}${alphaSuffix})`
      : `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  if (format === 'hsl') {
    const hsl = rgbToHsl(color);
    return color.a < 1
      ? `hsla(${concise(hsl.h)}, ${concise(hsl.s)}%, ${concise(hsl.l)}%${alphaSuffix})`
      : `hsl(${concise(hsl.h)}, ${concise(hsl.s)}%, ${concise(hsl.l)}%)`;
  }
  if (format === 'hsv') {
    const hsv = rgbToHsv(color);
    return color.a < 1
      ? `hsva(${concise(hsv.h)}, ${concise(hsv.s)}%, ${concise(hsv.v)}%${alphaSuffix})`
      : `hsv(${concise(hsv.h)}, ${concise(hsv.s)}%, ${concise(hsv.v)}%)`;
  }
  return `#${hexChannel(color.r)}${hexChannel(color.g)}${hexChannel(color.b)}${color.a < 1 ? hexChannel(color.a * 255) : ''}`;
}

export function colorsEqual(left: NodelColor | null, right: NodelColor | null) {
  return Boolean(left && right && left.r === right.r && left.g === right.g && left.b === right.b && Math.abs(left.a - right.a) < 0.002);
}
