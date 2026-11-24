import type { PortSide } from './fixture';

export const PORT_LABEL_INSET = 14;
export const PORT_LABEL_GUTTER = 12;

export interface PortLabelBounds {
  x: number;
  width: number;
}

export interface VisiblePortLabelRow {
  id: string;
  side: PortSide;
  row: number;
}

/** Card-local text bounds; labels share neither space nor hit targets. */
export function portLabelBounds(cardWidth: number, side: PortSide, opposingRowOccupied: boolean): PortLabelBounds {
  const width = Math.max(0, Number.isFinite(cardWidth) ? cardWidth : 0);
  const innerLeft = Math.min(PORT_LABEL_INSET, width);
  const innerRight = Math.max(innerLeft, width - PORT_LABEL_INSET);
  if (!opposingRowOccupied) return { x: innerLeft, width: innerRight - innerLeft };

  const midpoint = width / 2;
  const halfGutter = PORT_LABEL_GUTTER / 2;
  if (side === 'left') {
    const end = Math.max(innerLeft, midpoint - halfGutter);
    return { x: innerLeft, width: end - innerLeft };
  }
  const start = Math.min(innerRight, midpoint + halfGutter);
  return { x: start, width: innerRight - start };
}

/** Layout only the rows supplied by the caller; overflow ports never occupy text rows. */
export function portLabelLayouts(cardWidth: number, rows: readonly VisiblePortLabelRow[]): ReadonlyMap<string, PortLabelBounds> {
  const occupied = new Set(rows.map(({ side, row }) => `${side}:${row}`));
  return new Map(rows.map(({ id, side, row }) => {
    const opposite = side === 'left' ? 'right' : 'left';
    return [id, portLabelBounds(cardWidth, side, occupied.has(`${opposite}:${row}`))];
  }));
}
