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

/**
 * Mobile Session Replay — playback-time transform.
 *
 * The mobile SDKs record **wireframes** (abstract native-UI primitives), not a DOM, so
 * they cannot be played by the rrweb (browser) player. We store the SDK's records
 * losslessly and reconstruct + transform them to renderable frames here, on read.
 *
 * Record types (per doc 07):
 *   4  Meta          { width, height }            — viewport in dp
 *   6  Focus         { has_focus }
 *   10 FullSnapshot  { wireframes: Wireframe[] }   — the whole screen
 *   11 Incremental   { adds, removes, updates }    — wireframe mutations
 *
 * Wireframe: { id, x, y, width, height, type, ...style } where type ∈
 *   shape | text | image | placeholder | webview.
 */

export interface Wireframe {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  text?: string;
  label?: string;
  base64?: string;
  resourceId?: string;
  shapeStyle?: {
    backgroundColor?: string;
    opacity?: number;
    cornerRadius?: number;
  };
  border?: { color?: string; width?: number };
  textStyle?: { family?: string; size?: number; color?: string };
  textPosition?: {
    padding?: { top?: number; bottom?: number; left?: number; right?: number };
    alignment?: { horizontal?: string; vertical?: string };
  };
  clip?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface MobileRecord {
  type: number;
  timestamp: number;
  data: any;
}

export interface MobileSegment {
  start?: number;
  end?: number;
  records?: MobileRecord[];
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MobileTimeline {
  records: MobileRecord[];
  startTime: number;
  endTime: number;
  duration: number;
}

const REC_META = 4;
const REC_FULL_SNAPSHOT = 10;
const REC_INCREMENTAL = 11;

/**
 * Flatten every segment's records into a single, timestamp-ordered timeline.
 * Segments may arrive unordered and overlap; sorting by timestamp yields the true stream.
 */
export function buildMobileTimeline(segments: MobileSegment[]): MobileTimeline {
  const records: MobileRecord[] = [];
  for (const seg of segments) {
    if (Array.isArray(seg?.records)) {
      for (const r of seg.records) {
        if (r && typeof r.type === "number" && typeof r.timestamp === "number") {
          records.push(r);
        }
      }
    }
  }
  records.sort((a, b) => a.timestamp - b.timestamp);

  const startTime = records.length ? records[0].timestamp : 0;
  const endTime = records.length ? records[records.length - 1].timestamp : 0;
  return { records, startTime, endTime, duration: Math.max(0, endTime - startTime) };
}

/** The viewport in effect at time `t` — from the latest Meta record at or before `t`. */
export function viewportAt(records: MobileRecord[], t: number): Viewport {
  let vp: Viewport = { width: 0, height: 0 };
  for (const r of records) {
    if (r.timestamp > t) break;
    if (r.type === REC_META && r.data) {
      vp = { width: Number(r.data.width) || 0, height: Number(r.data.height) || 0 };
    }
  }
  return vp;
}

/**
 * Reconstruct the ordered wireframe list at time `t`:
 *   seed from the latest full snapshot ≤ t, then apply incrementals (add/remove/update)
 *   after that snapshot up to `t`, preserving paint order.
 *
 * Order matters (z-index): an ordered array is maintained; `adds` insert after
 * `previousId` (or append), `removes` delete, `updates` shallow-merge by id.
 */
export function wireframesAt(records: MobileRecord[], t: number): Wireframe[] {
  // Find the index of the latest full snapshot at or before t.
  let snapshotIdx = -1;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.timestamp > t) break;
    if (r.type === REC_FULL_SNAPSHOT) snapshotIdx = i;
  }
  if (snapshotIdx === -1) return [];

  const order: Wireframe[] = (records[snapshotIdx].data?.wireframes ?? []).map(
    (w: Wireframe) => ({ ...w }),
  );
  const indexById = new Map<number, number>();
  const rebuildIndex = () => {
    indexById.clear();
    order.forEach((w, i) => indexById.set(w.id, i));
  };
  rebuildIndex();

  for (let i = snapshotIdx + 1; i < records.length; i++) {
    const r = records[i];
    if (r.timestamp > t) break;
    if (r.type !== REC_INCREMENTAL || !r.data) continue;

    for (const rem of r.data.removes ?? []) {
      const idx = indexById.get(rem.id);
      if (idx !== undefined) {
        order.splice(idx, 1);
        rebuildIndex();
      }
    }
    for (const add of r.data.adds ?? []) {
      if (!add?.wireframe) continue;
      const wf: Wireframe = { ...add.wireframe };
      const prevIdx = add.previousId != null ? indexById.get(add.previousId) : undefined;
      if (prevIdx === undefined) order.push(wf);
      else order.splice(prevIdx + 1, 0, wf);
      rebuildIndex();
    }
    for (const upd of r.data.updates ?? []) {
      const idx = indexById.get(upd.id);
      if (idx !== undefined) order[idx] = { ...order[idx], ...upd };
    }
  }
  return order;
}

/** Whether a session's source is a mobile SDK (→ use the wireframe player). */
export function isMobileReplaySource(source: string | undefined | null): boolean {
  return source === "react-native" || source === "ios" || source === "android" || source === "flutter";
}

/**
 * Absolute-positioned CSS for a wireframe. Untrusted values are only ever used as CSS
 * values / text nodes by the renderer — never injected as HTML.
 */
export function wireframeStyle(w: Wireframe): Record<string, string> {
  const style: Record<string, string> = {
    position: "absolute",
    left: `${w.x}px`,
    top: `${w.y}px`,
    width: `${w.width}px`,
    height: `${w.height}px`,
    overflow: "hidden",
    "box-sizing": "border-box",
  };

  if (w.shapeStyle) {
    if (w.shapeStyle.backgroundColor) style["background-color"] = w.shapeStyle.backgroundColor;
    if (w.shapeStyle.opacity != null) style.opacity = String(w.shapeStyle.opacity);
    if (w.shapeStyle.cornerRadius) style["border-radius"] = `${w.shapeStyle.cornerRadius}px`;
  }
  if (w.border && w.border.width) {
    style.border = `${w.border.width}px solid ${w.border.color ?? "transparent"}`;
  }
  if (w.type === "text" && w.textStyle) {
    if (w.textStyle.color) style.color = w.textStyle.color;
    if (w.textStyle.size) style["font-size"] = `${w.textStyle.size}px`;
    if (w.textStyle.family) style["font-family"] = w.textStyle.family;
    const align = w.textPosition?.alignment?.horizontal;
    if (align) style["text-align"] = align === "center" ? "center" : align === "right" ? "right" : "left";
    const valign = w.textPosition?.alignment?.vertical;
    style.display = "flex";
    style["align-items"] = valign === "center" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
    const p = w.textPosition?.padding;
    if (p) style.padding = `${p.top ?? 0}px ${p.right ?? 0}px ${p.bottom ?? 0}px ${p.left ?? 0}px`;
  }
  if (w.type === "placeholder") {
    style["background-color"] = style["background-color"] ?? "rgba(0,0,0,0.06)";
    style.display = "flex";
    style["align-items"] = "center";
    style["justify-content"] = "center";
    style.color = "rgba(0,0,0,0.4)";
    style["font-size"] = "10px";
  }
  return style;
}
