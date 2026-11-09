export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** True when a pointer step from `from` to `to` heads into the submenu panel `box`, on either side of its trigger. */
export function movingIntoSubmenu(from: Point, to: Point, box: Box): boolean {
  if (box.right <= box.left || box.bottom <= box.top) return false;
  const towardLeft = box.right <= from.x;
  const towardRight = box.left >= from.x;
  if (!towardLeft && !towardRight) return false;
  if (towardLeft ? to.x > from.x : to.x < from.x) return false;
  const nearX = towardLeft ? box.right : box.left;
  return inTriangle(to, from, { x: nearX, y: box.top }, { x: nearX, y: box.bottom });
}

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (u: Point, v: Point) => (p.x - v.x) * (u.y - v.y) - (u.x - v.x) * (p.y - v.y);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}
