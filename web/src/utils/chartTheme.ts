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
 * Token-driven chart palette.
 *
 * Charting libraries (ECharts / Plotly) need *resolved* color strings, not CSS
 * `var()` references. `chartColor()` reads the computed value of a design token
 * off `<html>` so chart code can consume tokens without hardcoding hex or writing
 * `theme === 'dark' ? '#x' : '#y'` ternaries. Values are cached and invalidated on
 * theme change via `invalidateChartTheme()` (called from `utils/theme.ts`).
 *
 * This is one of exactly two files permitted to be theme-aware in JS (the other is
 * `composables/useTheme.ts`); everything else must go through tokens or these seams.
 */

const cache = new Map<string, string>();

// Fallback light-theme values, used when the computed value is empty — i.e. the
// token stylesheet hasn't applied yet (very early call) or there is no live CSSOM
// (jsdom unit tests / SSR). Keeps charts from rendering with empty color strings.
// These are the light-theme resolutions of the corresponding tokens.
const FALLBACKS: Record<string, string> = {
  "--color-text-heading": "#171717",
  "--color-text-secondary": "#737373",
  "--color-border-default": "#e5e5e5",
  "--color-border-subtle": "#ededed",
  "--color-surface-base": "#ffffff",
  "--color-tooltip-text": "#171717",
  "--color-tooltip-bg": "#ffffff",
  "--color-tooltip-border": "#ededed",
  "--color-service-health-critical": "#f5222d",
  "--color-service-health-degraded": "#faad14",
  "--color-service-health-healthy": "#52c41a",
  "--color-service-health-warning": "#fa8c16",
  // Dashboard classic series palette (light values) — so getColorPalette() has
  // sensible colors before the token stylesheet is live (jsdom / very-early render).
  "--color-chart-series-1": "#5b8ef0",
  "--color-chart-series-2": "#34d399",
  "--color-chart-series-3": "#fb923c",
  "--color-chart-series-4": "#f472b6",
  "--color-chart-series-5": "#a78bfa",
  "--color-chart-series-6": "#fbbf24",
  "--color-chart-series-7": "#38bdf8",
  "--color-chart-series-8": "#f87171",
  "--color-chart-series-9": "#2dd4bf",
  "--color-chart-series-10": "#4ade80",
  "--color-chart-series-11": "#e879f9",
  "--color-chart-series-12": "#facc15",
  // Dashboard table row-highlight palette (light values) + grid line.
  "--color-chart-table-1": "#FFCDEE",
  "--color-chart-table-2": "#FFD2D3",
  "--color-chart-table-3": "#C8FCFA",
  "--color-chart-table-4": "#B2DAFB",
  "--color-chart-table-5": "#C0E9FC",
  "--color-chart-table-6": "#FFCDE5",
  "--color-chart-table-7": "#C0EFF5",
  "--color-chart-table-8": "#FFFDBA",
  "--color-chart-table-9": "#E6F3FF",
  "--color-chart-table-10": "#F2B9B9",
  "--color-chart-table-11": "#A6E8F0",
  "--color-chart-table-12": "#C8E5FC",
  "--color-chart-table-13": "#E8A3F4",
  "--color-chart-table-14": "#C0E5E2",
  "--color-chart-table-15": "#C9FFBD",
  "--color-chart-table-16": "#F8B1C9",
  "--color-chart-table-17": "#BDDFFF",
  "--color-chart-table-18": "#D2B9FF",
  "--color-chart-table-19": "#D2EBDA",
  "--color-chart-table-20": "#C0E3C2",
  "--color-chart-table-21": "#F0F8E8",
  "--color-chart-table-22": "#FFF2CC",
  "--color-chart-table-23": "#FFE6E6",
  "--color-chart-table-24": "#E8F4FD",
  "--color-chart-gridline": "rgba(0, 0, 0, 0.08)",
  // Trace span palette (HEX/canvas variant), light values.
  "--color-trace-span-1": "#10B981",
  "--color-trace-span-2": "#06B6D4",
  "--color-trace-span-3": "#84CC16",
  "--color-trace-span-4": "#6366F1",
  "--color-trace-span-5": "#F59E0B",
  "--color-trace-span-6": "#3B82F6",
  "--color-trace-span-7": "#14B8A6",
  "--color-trace-span-8": "#D946EF",
  "--color-trace-span-9": "#7C3AED",
  "--color-trace-span-10": "#F59E0B",
  "--color-trace-span-11": "#0284C7",
  "--color-trace-span-12": "#84CC16",
  "--color-trace-span-13": "#6366F1",
  "--color-trace-span-14": "#F9A8D4",
  "--color-trace-span-15": "#10B981",
  "--color-trace-span-16": "#8B5CF6",
  "--color-trace-span-17": "#F97316",
  "--color-trace-span-18": "#22D3EE",
  "--color-trace-span-19": "#06B6D4",
  "--color-trace-span-20": "#21cb60",
  "--color-trace-span-21": "#A855F7",
  "--color-trace-span-22": "#FBBF24",
  "--color-trace-span-23": "#3B82F6",
  "--color-trace-span-24": "#14B8A6",
  "--color-trace-span-25": "#6366F1",
  "--color-trace-span-26": "#FB923C",
  "--color-trace-span-27": "#0EA5E9",
  "--color-trace-span-28": "#F472B6",
  "--color-trace-span-29": "#A855F7",
  "--color-trace-span-30": "#818CF8",
  "--color-trace-span-31": "#F97316",
  "--color-trace-span-32": "#FCA5A5",
  "--color-trace-span-33": "#06B6D4",
  "--color-trace-span-34": "#A78BFA",
  "--color-trace-span-35": "#3B82F6",
  // Metric-panel text default (contrast fallback when a panel has no background).
  "--color-chart-metric-text": "#000000",
};

/** Resolve a `--color-*` (or `--text-*`) design token to its computed value. */
export function chartColor(token: `--${string}`): string {
  const cached = cache.get(token);
  if (cached !== undefined) return cached;
  // No live DOM (SSR / node-env unit tests): fall back without touching the CSSOM.
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return FALLBACKS[token] ?? "";
  }
  const computed = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (computed) {
    cache.set(token, computed); // only cache real values; retry until CSS is live
    return computed;
  }
  return FALLBACKS[token] ?? "";
}

/** Clear the resolved-token cache. Call on theme change so charts pick up new values. */
export function invalidateChartTheme(): void {
  cache.clear();
}

/**
 * Resolve a NUMERIC design token (opacity, threshold, …) to a number — the number
 * version of chartColor(). The token's light/dark values live in CSS (base/dark.css),
 * so chart code branches on neither the token nor the theme. `fallback` is returned
 * when there's no live CSSOM (jsdom / node-env / SSR) or the value doesn't parse.
 */
export function chartNumber(token: `--${string}`, fallback: number): number {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(token),
  );
  return Number.isFinite(v) ? v : fallback;
}

// Convenience getters used by the dashboard/trace chart converters.
export const chartTextColor = (): string => chartColor("--color-text-secondary");
export const chartAxisLine = (): string => chartColor("--color-border-default");
export const chartBg = (): string => chartColor("--color-surface-base");
export const chartGridLine = (): string => chartColor("--color-border-subtle");
