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
 * Pure helpers used by `LLMTrendPanel.vue` for axis label / cell
 * formatting and small math. Extracted so they can be unit-tested
 * without mounting the component (which depends on quasar + echarts).
 *
 * No Vue / DOM imports.
 */

/**
 * Convert a histogram interval string ("5 minutes", "1 hour") to its
 * duration in milliseconds. Used for the empty-data gap-fill: we
 * synthesise zero-points aligned to bucket boundaries so the x-axis
 * matches what other panels show for the same time range.
 *
 * Defaults to 60_000ms (1 minute) for unparseable input — the panel
 * still renders, just with possibly mis-aligned ticks for that single
 * empty case.
 *
 * @example intervalToMs("10 seconds")  // 10_000
 * @example intervalToMs("5 minutes")   // 300_000
 * @example intervalToMs("2 hours")     // 7_200_000
 * @example intervalToMs("1 day")       // 86_400_000
 * @example intervalToMs("garbage")     // 60_000  (default)
 */
export function intervalToMs(interval: string): number {
  const m = interval.match(/^(\d+)\s+(second|minute|hour|day)s?$/i);
  if (!m) return 60_000;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === "second") return n * 1000;
  if (unit === "minute") return n * 60_000;
  if (unit === "hour") return n * 3_600_000;
  return n * 86_400_000;
}

/**
 * Compact number format for axis tick labels and bar end-labels. Keeps
 * labels short enough to fit beside small panels.
 *
 *   ≥ 1M    → "1.2M" (1 decimal)
 *   ≥ 1K    → "1.2K"
 *   ≥ 100   → "456"  (no decimal — panel is already wide enough)
 *   ≥ 1     → "1.5"  (1 decimal, helps distinguish 1.0 from 1.5)
 *   < 1     → toString() — keeps small values readable
 *
 * @example formatCompact(2_500_000) // "2.5M"
 * @example formatCompact(12_345)    // "12.3K"
 * @example formatCompact(456)       // "456"
 * @example formatCompact(1.5)       // "1.5"
 * @example formatCompact(0.1)       // "0.1"
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  if (n >= 100) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toString();
}

/**
 * Format a latency in milliseconds for axis labels / threshold lines.
 * Switches to seconds beyond 1000ms for readability.
 *
 * @example formatLatencyMs(450)    // "450ms"
 * @example formatLatencyMs(1500)   // "1.5s"
 * @example formatLatencyMs(123.7)  // "124ms" (rounded)
 */
export function formatLatencyMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

/**
 * Format a timestamp cell in the recent-errors table as `HH:mm:ss`
 * in the browser's local timezone. Accepts:
 *   - number in microseconds (>1e15)
 *   - number in milliseconds (1e12 – 1e15)
 *   - number in seconds (<1e12)
 *   - ISO-ish string with `T` or space separator
 *
 * Falls back to the raw input for unparseable values so the table
 * cell never shows "Invalid Date".
 *
 * @example formatTimeCell(1735776000000000) // "HH:MM:SS" in user TZ
 * @example formatTimeCell("2026-01-02 03:04:05") // "03:04:05" (parses)
 * @example formatTimeCell(null) // ""
 */
export function formatTimeCell(ts: any): string {
  if (ts == null) return "";
  let ms: number;
  if (typeof ts === "number") {
    ms = ts > 1e15 ? ts / 1000 : ts > 1e12 ? ts : ts * 1000;
  } else {
    const str = String(ts);
    const isoLike =
      str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") + "Z" : str;
    const d = new Date(isoLike);
    ms = d.getTime();
  }
  if (!isFinite(ms)) return String(ts);
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Format a cost cell. Adapts precision so very small values still
 * show non-zero (4 decimals for sub-cent, 3 for sub-dollar, 2 above).
 *
 * @example formatCostCell({ cost: 12.34 }) // "$12.34"
 * @example formatCostCell({ cost: 0.05 })  // "$0.050"
 * @example formatCostCell({ cost: 0.001 }) // "$0.0010"
 * @example formatCostCell({ cost: 0 })     // "$0"
 * @example formatCostCell({ cost: NaN })   // "—"
 * @example formatCostCell({})              // "—"
 */
export function formatCostCell(row: any): string {
  const c = Number(row?.cost);
  if (!isFinite(c)) return "—";
  if (c <= 0) return "$0";
  if (c >= 1) return `$${c.toFixed(2)}`;
  if (c >= 0.01) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(4)}`;
}

/** Stable palette for service-name chips in the recent-errors table. */
const CHIP_PALETTE = [
  "#6366f1",
  "#10b981",
  "#f97316",
  "#ec4899",
  "#0ea5e9",
  "#a855f7",
  "#eab308",
  "#14b8a6",
];

/**
 * Pick a stable color for a service-name chip from the palette. Uses
 * a simple string hash so the same value always gets the same color
 * (visual continuity across renders).
 *
 * @example chipColor("api")     // a fixed color from the palette
 * @example chipColor("api")     // ...same color on every call
 * @example chipColor("worker")  // different color
 * @example chipColor(null)      // first palette entry
 */
export function chipColor(value: any): string {
  const s = String(value || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return CHIP_PALETTE[Math.abs(hash) % CHIP_PALETTE.length];
}

/**
 * Format a histogram bucket label as `HH:mm` for the chart x-axis.
 * Falls back to the raw input when parsing fails (defensive — avoids
 * "Invalid Date" labels).
 *
 * @example formatTimeLabel("2026-01-02 03:04:05") // "03:04"
 * @example formatTimeLabel("not a date")          // "not a date"
 */
export function formatTimeLabel(ts: string): string {
  const d = new Date(ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
