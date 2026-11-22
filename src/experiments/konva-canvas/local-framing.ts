import { graphBounds, type GraphBounds } from './camera-selection';
import { cardHeight, type Curve, type FixtureNode, type Point } from './fixture';

/** Cache local world extents independently of the camera and the stage's pixel size. */
export class LocalFraming {
  private readonly cards = new Map<string, GraphBounds>();
  private readonly routes = new Map<string, GraphBounds>();
  private version = 0;
  private framedVersion = 0;
  private cached: GraphBounds | undefined;

  get revision(): number { return this.version; }

  updateCard(node: FixtureNode): void {
    this.cards.set(node.id, { left: node.x, top: node.y, right: node.x + node.width, bottom: node.y + cardHeight(node) });
    this.version += 1;
  }

  updateRoute(id: string, curves: readonly Curve[], arrow?: { tip: Point; left: Point; right: Point }): void {
    const bounds = graphBounds([], [curves]);
    if (!bounds) return;
    if (arrow) {
      for (const { x, y } of [arrow.tip, arrow.left, arrow.right]) {
        bounds.left = Math.min(bounds.left, x);
        bounds.right = Math.max(bounds.right, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.bottom = Math.max(bounds.bottom, y);
      }
    }
    this.routes.set(id, bounds);
    this.version += 1;
  }

  bounds(): GraphBounds | undefined {
    if (this.framedVersion === this.version) return this.cached;
    let bounds: GraphBounds | undefined;
    for (const source of [this.cards, this.routes]) {
      for (const current of source.values()) {
        if (!bounds) bounds = { ...current };
        else {
          bounds.left = Math.min(bounds.left, current.left);
          bounds.right = Math.max(bounds.right, current.right);
          bounds.top = Math.min(bounds.top, current.top);
          bounds.bottom = Math.max(bounds.bottom, current.bottom);
        }
      }
    }
    this.cached = bounds;
    this.framedVersion = this.version;
    return bounds;
  }
}
