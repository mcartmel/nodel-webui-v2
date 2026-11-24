const PIXELS_PER_ROW = 24;
const PIXELS_PER_LINE = 16;
export const PORT_WHEEL_BURST_QUIET_MS = 32;
export type PortWindowMode = 'chooser' | 'B' | 'C' | 'D';

/** Treat native page units as one window of travel in either variant. */
export function portWheelStep(deltaY: number, deltaMode: number, rows: number, remainder: number, mode: Exclude<PortWindowMode, 'chooser'>) {
  const unit = deltaMode === 2 ? rows * PIXELS_PER_ROW : deltaMode === 1 ? PIXELS_PER_LINE : 1;
  const available = remainder + (Number.isFinite(deltaY) ? deltaY * unit : 0);
  const stride = mode === 'C' ? Math.max(1, rows) : 1;
  const threshold = stride * PIXELS_PER_ROW;
  const steps = Math.trunc(available / threshold);
  return { rows: steps * stride, remainder: available - (steps * threshold) };
}
