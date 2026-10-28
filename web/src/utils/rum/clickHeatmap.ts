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

import { cssToken } from "@/utils/theme";

export interface ElementGroup {
  selector: string;
  name: string;
  clicks: number;
  sessions: number;
  rage: number;
  dead: number;
  error: number;
  frustrated: number;
}

export interface ClickSummary {
  clicks: number;
  sessions: number;
  frustrated: number;
  top: ElementGroup | null;
}

export interface OutlineRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HeatSpot {
  x: number;
  y: number;
  weight?: number;
  radius?: number;
}

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Reads one ranking row; rows without a selector cannot be placed and are dropped. */
export function toElementGroup(row: Record<string, unknown>): ElementGroup | null {
  const selector = typeof row.selector === "string" ? row.selector : "";
  if (!selector) return null;
  return {
    selector,
    name: typeof row.name === "string" ? row.name.trim() : "",
    clicks: count(row.clicks),
    sessions: count(row.sessions),
    rage: count(row.rage),
    dead: count(row.dead),
    error: count(row.err),
    frustrated: count(row.frustrated),
  };
}

/** Busiest first; ties fall to sessions, then frustrated clicks, then selector so the order is stable. */
export function sortElements(groups: ElementGroup[]): ElementGroup[] {
  return [...groups].sort(
    (a, b) =>
      b.clicks - a.clicks ||
      b.sessions - a.sessions ||
      b.frustrated - a.frustrated ||
      (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0),
  );
}

export function sharePercent(clicks: number, total: number): number {
  return total > 0 ? Math.round((clicks / total) * 1000) / 10 : 0;
}

const MIN_HEAT_WEIGHT = 0.3;
const MIN_SPOT_RADIUS = 28;
const MAX_SPOT_RADIUS = 90;
const OUTLINE_LINE_WIDTH = 3;
const OUTLINE_FILL_ALPHA = 0.08;
const OUTLINE_FALLBACK_COLOR = "currentColor";

/** Positions are not fetched, so each element glows at its centre, brighter the more it was clicked; unrendered (zero-size) elements have no centre and return null. */
export function placeGroup(
  group: ElementGroup,
  maxClicks: number,
  rect: DOMRect,
  scrollX: number,
  scrollY: number,
): HeatSpot | null {
  if (rect.width < 1 || rect.height < 1) return null;
  const share = maxClicks > 0 ? Math.min(group.clicks / maxClicks, 1) : 0;
  return {
    x: rect.left + scrollX + rect.width / 2,
    y: rect.top + scrollY + rect.height / 2,
    weight: MIN_HEAT_WEIGHT + (1 - MIN_HEAT_WEIGHT) * share,
    radius: Math.min(
      Math.max(Math.max(rect.width, rect.height) / 2, MIN_SPOT_RADIUS),
      MAX_SPOT_RADIUS,
    ),
  };
}

function hslToRgb(h: number): [number, number, number] {
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => 1 - Math.max(Math.min(k(n), 4 - k(n), 1), 0);
  return [Math.round(255 * f(5)), Math.round(255 * f(3)), Math.round(255 * f(1))];
}

function buildPalette(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = hslToRgb((1 - i / 255) * 120);
    palette.set([r, g, b], i * 3);
  }
  return palette;
}

/** Strokes a rounded box around one element so a table row can point at it on the page. */
export function drawOutline(canvas: HTMLCanvasElement, rect: OutlineRect): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  // Canvas cannot use CSS variables, so resolve the token once per draw to follow light and dark mode.
  const color = cssToken("--color-focus-ring-accent", OUTLINE_FALLBACK_COLOR);
  ctx.lineWidth = OUTLINE_LINE_WIDTH;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = OUTLINE_FILL_ALPHA;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.globalAlpha = 1;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/** Recolours by accumulated density because a single blob alpha cannot show overlapping clicks. */
export function renderHeat(canvas: HTMLCanvasElement, spots: HeatSpot[], radius = 28): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!spots.length) return;

  for (const s of spots) {
    const r = s.radius ?? radius;
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    grad.addColorStop(0, `rgba(0,0,0,${0.75 * (s.weight ?? 1 / 3)})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  }

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const palette = buildPalette();
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (!a) continue;
    img.data[i] = palette[a * 3];
    img.data[i + 1] = palette[a * 3 + 1];
    img.data[i + 2] = palette[a * 3 + 2];
    img.data[i + 3] = Math.min(200, a * 2);
  }
  ctx.putImageData(img, 0, 0);
}
