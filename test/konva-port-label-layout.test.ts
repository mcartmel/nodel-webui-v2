import { describe, expect, it } from 'vitest';
import { portLabelBounds, portLabelLayouts, PORT_LABEL_GUTTER, PORT_LABEL_INSET } from '../src/experiments/konva-canvas/port-label-layout';

describe('Konva endpoint label bounds', () => {
  it('uses the socket inset and full inner width for an unpaired row on either side', () => {
    expect(portLabelBounds(320, 'left', false)).toEqual({ x: PORT_LABEL_INSET, width: 292 });
    expect(portLabelBounds(320, 'right', false)).toEqual({ x: PORT_LABEL_INSET, width: 292 });
  });

  it('splits opposing rows around a centre gutter without overlap', () => {
    const left = portLabelBounds(321, 'left', true);
    const right = portLabelBounds(321, 'right', true);
    expect(left.x).toBe(PORT_LABEL_INSET);
    expect(left.x + left.width).toBe(160.5 - PORT_LABEL_GUTTER / 2);
    expect(right.x).toBe(160.5 + PORT_LABEL_GUTTER / 2);
    expect(right.x + right.width).toBe(321 - PORT_LABEL_INSET);
    expect(right.x - (left.x + left.width)).toBe(PORT_LABEL_GUTTER);
  });

  it('recomputes an existing label when a late opposite-side slot arrives, excluding overflow', () => {
    const visible = [{ id: 'left', side: 'left' as const, row: 0 }];
    const original = portLabelLayouts(320, visible).get('left')!;
    expect(original).toEqual(portLabelBounds(320, 'left', false));
    const afterOppositeInsertion = portLabelLayouts(320, [...visible, { id: 'right', side: 'right' as const, row: 0 }]);
    expect(afterOppositeInsertion.get('left')!.x).toBe(original.x);
    expect(afterOppositeInsertion.get('left')!.width).toBeLessThan(original.width);
    expect(afterOppositeInsertion.get('right')!.x + afterOppositeInsertion.get('right')!.width).toBe(306);
    // A hidden endpoint is absent from the visible rows and cannot narrow text.
    expect(portLabelLayouts(320, visible).get('left')).toEqual(original);
  });

  it('clamps narrow-card widths to nonnegative values', () => {
    expect(portLabelBounds(8, 'left', true).width).toBe(0);
    expect(portLabelBounds(8, 'right', true).width).toBe(0);
  });
});
