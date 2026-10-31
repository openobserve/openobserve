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

import { CARD_H, CARD_W, type Position } from "./dependencyGraph";

export interface Route {
  path: string;
  // Points along the route, for a label to sit on.
  spots: Position[];
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

const middle = (a: Position, b: Position) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

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
    return {
      path: `M${x},${sy} C${x + bow},${sy} ${x + bow},${ty} ${x},${ty}`,
      spots: [{ x: x + 0.75 * bow, y: (sy + ty) / 2 }],
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
  points.push({ x: forward ? to.x : to.x + CARD_W, y: ty });
  let path = `M${points[0].x},${points[0].y}`;
  const spots: Position[] = [];
  for (let i = 1; i < points.length; i++) {
    // Curves cross the gaps; lines cross the columns.
    if (i % 2 === 1) {
      path += ` ${curve(points[i - 1], points[i])}`;
      spots.push(middle(points[i - 1], points[i]));
    } else {
      path += ` L${points[i].x},${points[i].y}`;
    }
  }
  // The first gap is furthest from the arrowhead at the target.
  return { path, spots };
}

// The pill a rate label is drawn in, at 0.625rem text; narrow enough to sit in a gap clear of both cards.
export const labelBox = (text: string, at: Position): Box => {
  const w = text.length * 5.6 + 10;
  return { x: at.x - w / 2, y: at.y - 8, w, h: 16 };
};

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Busiest first, each label at the first spot on its route where it clears every card and every label placed so far;
// one that fits nowhere is left out. `forced` labels are placed first and wherever their first spot is.
export function placeLabels(
  wanted: { id: string; text: string; spots: Position[]; forced?: boolean }[],
  cards: Position[],
): Map<string, Position> {
  const cardBoxes = cards.map((c) => ({ x: c.x, y: c.y, w: CARD_W, h: CARD_H }));
  const placed: Box[] = [];
  const out = new Map<string, Position>();
  const order = [...wanted.filter((w) => w.forced), ...wanted.filter((w) => !w.forced)];
  for (const { id, text, spots, forced } of order) {
    const spot = forced
      ? spots[0]
      : spots.find((at) => {
          const box = labelBox(text, at);
          return ![...cardBoxes, ...placed].some((other) => overlaps(box, other));
        });
    if (!spot) continue;
    placed.push(labelBox(text, spot));
    out.set(id, spot);
  }
  return out;
}

// Zoom and offset that show every point with a margin, never past natural size nor below `minZoom`, centred in a
// width x height pane.
export function fitTransform(points: Position[], width: number, height: number, minZoom = 0) {
  if (!points.length || !width || !height) return { x: 0, y: 0, zoom: 1 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - left, Math.max(...ys) - top];
  // Room for a bow out of the right-most column, and a little air on every side.
  const margin = 32;
  const zoom = Math.max(minZoom, Math.min(1, width / (w + 2 * margin), height / (h + 2 * margin)));
  return {
    x: width / 2 - (left + w / 2) * zoom,
    y: height / 2 - (top + h / 2) * zoom,
    zoom,
  };
}
