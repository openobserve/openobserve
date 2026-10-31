// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Edge routes and rate labels for the dependency map. Cards sit in columns; an edge curves only in the gaps between
// columns and runs straight through the slot layoutColumns kept for it in each column it passes, so it never goes
// behind a card.

import { CARD_H, CARD_W, COLUMN_GAP, type Position } from "./dependencyGraph";

// The room between a card and the next column.
const GAP = COLUMN_GAP - CARD_W;

export interface Route {
  path: string;
  // Where a label may sit along the route, best first: the gaps furthest from the target first, several places in each.
  spots: Position[];
  // The point the route ends at, and whether it enters the target from the left.
  end: Position;
  fromLeft: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A curve between two points with level tangents, so it leaves and enters each card or slot horizontally.
const curve = (a: Position, b: Position) => {
  const mid = (a.x + b.x) / 2;
  return `C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
};

// The point at t along that curve.
const along = (a: Position, b: Position, t: number) => {
  const mid = (a.x + b.x) / 2;
  const u = 1 - t;
  const [k0, k1, k2, k3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: k0 * a.x + (k1 + k2) * mid + k3 * b.x, y: (k0 + k1) * a.y + (k2 + k3) * b.y };
};

// Places tried in each gap, the middle first.
const STEPS = [0.5, 0.38, 0.62, 0.26, 0.74];

// Room left for a bow between a card and the next column.
const BOW_MAX = 48;

// From the side of the source facing the target to the side of the target facing the source, through each slot.
// `from` and `to` are the cards' top-left corners; `through` is layoutColumns' waypoints for the edge.
export function routeEdge(from: Position, to: Position, through: Position[]): Route {
  const sy = from.y + CARD_H / 2;
  const ty = to.y + CARD_H / 2;
  if (from.x === to.x) {
    // Both ends in one column: a bow out of the right-hand sides, into the gap, deeper the further apart they are.
    const x = from.x + CARD_W;
    const bow = Math.min(BOW_MAX, 16 + 0.15 * Math.abs(ty - sy)) / 0.75;
    const tip = { x: x + 0.75 * bow, y: (sy + ty) / 2 };
    // A shallow bow's tip is close to the cards, so the gap's middle is tried too, at the same heights.
    const out = { x: x + GAP / 2, y: tip.y };
    const heights = [tip.y, (3 * sy + ty) / 4, (sy + 3 * ty) / 4];
    return {
      path: `M${x},${sy} C${x + bow},${sy} ${x + bow},${ty} ${x},${ty}`,
      spots: [...heights.map((y) => ({ ...tip, y })), ...heights.map((y) => ({ ...out, y }))],
      end: { x, y: ty },
      fromLeft: false,
    };
  }
  const forward = from.x < to.x;
  const slots = [...through].sort((a, b) => (forward ? a.x - b.x : b.x - a.x));
  // Points in order of travel: each card side, and each slot's two sides.
  const points: Position[] = [{ x: forward ? from.x + CARD_W : from.x, y: sy }];
  for (const slot of slots) {
    const [enter, leave] = forward ? [slot.x, slot.x + CARD_W] : [slot.x + CARD_W, slot.x];
    points.push({ x: enter, y: slot.y }, { x: leave, y: slot.y });
  }
  const end = { x: forward ? to.x : to.x + CARD_W, y: ty };
  points.push(end);
  let path = `M${points[0].x},${points[0].y}`;
  const gaps: [Position, Position][] = [];
  for (let i = 1; i < points.length; i++) {
    // Curves cross the gaps; lines cross the columns.
    if (i % 2 === 1) {
      path += ` ${curve(points[i - 1], points[i])}`;
      gaps.push([points[i - 1], points[i]]);
    } else {
      path += ` L${points[i].x},${points[i].y}`;
    }
  }
  return {
    path,
    spots: gaps.flatMap(([a, b]) => STEPS.map((t) => along(a, b, t))),
    end,
    fromLeft: forward,
  };
}

// A rate label's pill. DependencyMap.vue draws it at exactly this size and text size, in pixels, so the overlap checks
// here hold for what is on screen.
export const LABEL_H = 18;
export const LABEL_FONT = 11;
export const labelWidth = (text: string) => Math.ceil(text.length * 6.2 + 14);
export const labelBox = (text: string, at: Position): Box => {
  const w = labelWidth(text);
  return { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H };
};

// The stretch before a target an arrowhead takes, kept clear of labels.
const ARROW_CLEARANCE = 24;
export const arrowBox = (route: Route): Box => ({
  x: route.fromLeft ? route.end.x - ARROW_CLEARANCE : route.end.x,
  y: route.end.y - 10,
  w: ARROW_CLEARANCE,
  h: 20,
});

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Busiest first, each label at the first spot on its route where it clears every card, every obstacle such as an
// arrowhead, and every label placed so far; one that fits nowhere is left out.
export function placeLabels(
  wanted: { id: string; text: string; spots: Position[] }[],
  cards: Position[],
  obstacles: Box[] = [],
): Map<string, Position> {
  const blocked: Box[] = [
    ...cards.map((c) => ({ x: c.x, y: c.y, w: CARD_W, h: CARD_H })),
    ...obstacles,
  ];
  const out = new Map<string, Position>();
  for (const { id, text, spots } of wanted) {
    const spot = spots.find((at) => !blocked.some((other) => overlaps(labelBox(text, at), other)));
    if (!spot) continue;
    blocked.push(labelBox(text, spot));
    out.set(id, spot);
  }
  return out;
}

// Zoom and offset that show every point with a margin, never past natural size nor below `minZoom`, in a width x height
// pane. A map that fits is centred; one that does not, at the floor, starts at its top-left, where the callers are,
// and is centred only along a side that fits.
export function fitTransform(points: Position[], width: number, height: number, minZoom = 0) {
  if (!points.length || !width || !height) return { x: 0, y: 0, zoom: 1 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - left, Math.max(...ys) - top];
  // Room for a bow out of the right-most column, and a little air on every side.
  const margin = 32;
  const [outerW, outerH] = [w + 2 * margin, h + 2 * margin];
  const zoom = Math.max(minZoom, Math.min(1, width / outerW, height / outerH));
  const place = (pane: number, outer: number, start: number, size: number) =>
    outer * zoom <= pane ? pane / 2 - (start + size / 2) * zoom : (margin - start) * zoom;
  return { x: place(width, outerW, left, w), y: place(height, outerH, top, h), zoom };
}
