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

export interface ClickPoint {
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  sessionId?: string;
  frustrated?: boolean;
}

export interface ElementGroup {
  selector: string;
  name: string;
  clicks: number;
  sessions: number;
  frustrated: number;
  points: ClickPoint[];
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
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Position and target arrive as JSON text columns on current SDKs and as flat columns on older ones. */
export function toClickPoint(row: Record<string, unknown>): ClickPoint | null {
  const pos = parseObject(row.pos);
  const target = parseObject(row.tgt);
  const selector = target?.selector ?? row.sel;
  const x = Number(pos?.x ?? row.x);
  const y = Number(pos?.y ?? row.y);
  if (!selector || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const frustration = Array.isArray(row.frus)
    ? row.frus.join(",")
    : typeof row.frus === "string"
      ? row.frus.trim()
      : "";
  return {
    selector: String(selector),
    x,
    y,
    width: Number(target?.width ?? row.w) || 0,
    height: Number(target?.height ?? row.h) || 0,
    name,
    sessionId: row.sid == null ? undefined : String(row.sid),
    frustrated: frustration !== "" && frustration !== "[]",
  };
}

export function groupBySelector(points: ClickPoint[]): ElementGroup[] {
  const groups = new Map<
    string,
    ElementGroup & { names: Map<string, number>; sids: Set<string> }
  >();
  for (const p of points) {
    const g = groups.get(p.selector) ?? {
      selector: p.selector,
      name: "",
      clicks: 0,
      sessions: 0,
      frustrated: 0,
      points: [],
      names: new Map<string, number>(),
      sids: new Set<string>(),
    };
    g.clicks += 1;
    if (p.frustrated) g.frustrated += 1;
    if (p.sessionId) g.sids.add(p.sessionId);
    if (p.name) g.names.set(p.name, (g.names.get(p.name) ?? 0) + 1);
    g.points.push(p);
    groups.set(p.selector, g);
  }
  return [...groups.values()]
    .map(({ names, sids, ...g }) => ({
      ...g,
      sessions: sids.size,
      name: [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }))
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.sessions - a.sessions ||
        b.frustrated - a.frustrated ||
        a.selector.localeCompare(b.selector),
    );
}

export function summarizeClicks(points: ClickPoint[], groups: ElementGroup[]): ClickSummary {
  return {
    clicks: points.length,
    sessions: new Set(points.map((p) => p.sessionId).filter(Boolean)).size,
    frustrated: points.filter((p) => p.frustrated).length,
    top: groups[0] ?? null,
  };
}

export function sharePercent(clicks: number, total: number): number {
  return total > 0 ? Math.round((clicks / total) * 1000) / 10 : 0;
}

/** Positions are relative to the clicked element, so each click is scaled to the element's size when it was recorded. */
export function placeGroup(
  group: ElementGroup,
  rect: DOMRect,
  scrollX: number,
  scrollY: number,
): HeatSpot[] {
  return group.points.map((p) => {
    const fx = p.width > 0 ? Math.min(Math.max(p.x / p.width, 0), 1) : 0.5;
    const fy = p.height > 0 ? Math.min(Math.max(p.y / p.height, 0), 1) : 0.5;
    return {
      x: rect.left + scrollX + fx * rect.width,
      y: rect.top + scrollY + fy * rect.height,
    };
  });
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
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgb(37, 99, 235)";
  ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/** Draws additive alpha blobs, then recolours by accumulated density (blue = few clicks, red = many). */
export function renderHeat(canvas: HTMLCanvasElement, spots: HeatSpot[], radius = 28): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!spots.length) return;

  for (const s of spots) {
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
    grad.addColorStop(0, "rgba(0,0,0,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(s.x - radius, s.y - radius, radius * 2, radius * 2);
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
