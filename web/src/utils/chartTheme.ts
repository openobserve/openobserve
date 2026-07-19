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
};

/** Resolve a `--color-*` (or `--text-*`) design token to its computed value. */
export function chartColor(token: `--${string}`): string {
  const cached = cache.get(token);
  if (cached !== undefined) return cached;
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

// Convenience getters used by the dashboard/trace chart converters.
export const chartTextColor = (): string => chartColor("--color-text-secondary");
export const chartAxisLine = (): string => chartColor("--color-border-default");
export const chartBg = (): string => chartColor("--color-surface-base");
export const chartGridLine = (): string => chartColor("--color-border-subtle");
