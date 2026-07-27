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
 * The query-param keys that mark a `/metrics` URL as an *editor* deep link.
 *
 * Deliberately a standalone, dependency-free module. The router guard needs
 * these keys to decide whether `/metrics` should redirect to `/metrics/editor`,
 * and importing the full `metricsParamRegistry` would drag the Vuex store into
 * the router's module graph (the registry needs it to clone a default panel).
 *
 * `metricsParamRegistry.spec.ts` asserts this list stays in sync with the
 * registry's actual descriptors, so the two cannot drift apart.
 */

/** Keys and aliases from METRICS_PARAMS, plus the whole-panel blob. */
export const METRICS_EDITOR_PARAM_KEYS = [
  "metrics_data",
  "chart_type",
  "query_type",
  "stream_name",
  "stream",
  "query",
] as const;

/**
 * Whether a URL's query carries editor-specific params.
 *
 * `perQuery` params are indexed (`query`, `query.1`, `query.2`, …), so a bare
 * key match is not enough — a shared multi-query link would otherwise be seen
 * as a plain `/metrics` visit and land on the explorer instead of the chart the
 * sender meant to share.
 */
export function hasMetricsEditorParams(query: Record<string, any> | undefined | null): boolean {
  if (!query) return false;
  return Object.keys(query).some((raw) => {
    const base = raw.split(".")[0];
    return (METRICS_EDITOR_PARAM_KEYS as readonly string[]).includes(base);
  });
}
