import { cardHeight, type FixtureNode, type Point } from './fixture';

/** Find space for a single insertion using live top-lefts and current card heights. */
export function placeEnrichedPeer(
  peer: FixtureNode, owner: FixtureNode, side: -1 | 1, occupied: Iterable<FixtureNode>
): Point {
  const rowGap = 28;
  const columnGap = 150;
  const height = cardHeight(peer);
  const bounds = [...occupied].map((node) => ({
    left: node.x, right: node.x + node.width, top: node.y, bottom: node.y + cardHeight(node)
  }));
  const clear = (x: number, y: number) => bounds.every((b) =>
    x + peer.width + rowGap <= b.left || x >= b.right + rowGap || y + height + rowGap <= b.top || y >= b.bottom + rowGap);

  for (const direction of [side, -side]) {
    const nearestX = direction > 0 ? owner.x + owner.width + columnGap : owner.x - peer.width - columnGap;
    for (let column = 0; column < 3; column += 1) {
      const x = nearestX + direction * column * (peer.width + columnGap);
      for (const row of [0, 1, -1, 2, -2]) {
        const y = owner.y + row * (height + rowGap);
        if (clear(x, y)) return { x, y };
      }
    }
  }

  // Finite fallback outside all cards, on the preferred side of the graph.
  const outside = side > 0 ? bounds.reduce((max, b) => Math.max(max, b.right), owner.x + owner.width) + columnGap
    : bounds.reduce((min, b) => Math.min(min, b.left), owner.x) - peer.width - columnGap;
  return { x: outside, y: owner.y };
}
