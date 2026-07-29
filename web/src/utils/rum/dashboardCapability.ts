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
 * Capability-based panel gating for the static RUM Performance dashboards.
 *
 * The Performance tabs render fixed dashboard JSON whose panels hardcode columns against
 * the shared `_rumdata` stream. Some of those columns exist only under the browser SDK
 * (Web Vitals) and some only under the mobile SDKs (frame rates, crashes) — naming a
 * column the stream does not have fails the WHOLE panel query, so a mobile-only user
 * would see raw SQL errors on browser panels (and vice versa).
 *
 * This filter drops any panel that references a column absent from the stream schema,
 * then reflows the survivors into a tidy grid. It is a strict no-op when nothing is
 * dropped, so the browser-only experience renders byte-for-byte as before.
 *
 * See docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
 */

/** 12-column dashboard grid (matches the RUM dashboard layouts). */
const GRID_WIDTH = 12;

/**
 * Columns referenced by the Performance dashboards that are NOT guaranteed to exist for
 * every SDK. A panel referencing any of these is kept only if the column is actually in
 * the stream schema; otherwise the panel would error and is dropped.
 *
 * Guaranteed-common columns (service, env, version, session_id, error_id, error_handling,
 * type, _timestamp) are intentionally NOT listed — panels using only those always survive.
 */
export const CAPABILITY_GATED_FIELDS: string[] = [
  // Browser-only Web Vitals / navigation timings
  "view_largest_contentful_paint",
  "view_interaction_to_next_paint",
  "view_cumulative_layout_shift",
  "view_first_contentful_paint",
  "view_first_byte",
  "view_loading_time",
  "view_dom_complete",
  "view_dom_content_loaded",
  "view_dom_interactive",
  "view_load_event",
  // Page URL — present for browser and for mobile apps that set it, absent otherwise
  "view_url",
  // Network / resource timing — present when the app instruments network calls
  "resource_url",
  "resource_duration",
  "resource_size",
  "resource_status_code",
  "resource_method",
  // Mobile-only vitals / stability (used by the Phase 2 mobile dashboards)
  "view_slow_frames_rate",
  "view_freeze_rate",
  "view_frozen_frame_count",
  "view_refresh_rate_average",
  "view_refresh_rate_min",
  "view_is_slow_rendered",
  "view_memory_max",
  "view_memory_average",
  "view_cpu_ticks_count",
  "view_cpu_ticks_per_second",
  "error_is_crash",
  "error_category",
  "freeze_duration",
  "vital_app_launch_metric",
  "vital_startup_type",
  "vital_duration",
];

// Word-boundary matchers, built once. `\b` is fine here because every gated field is a
// plain snake_case identifier.
const fieldMatchers: ReadonlyArray<readonly [string, RegExp]> = CAPABILITY_GATED_FIELDS.map(
  (field) => [field, new RegExp(`\\b${field}\\b`)] as const,
);

export interface DashboardPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number | string;
}

export interface DashboardPanel {
  layout: DashboardPanelLayout;
  queries?: Array<{ query?: string }>;
  [key: string]: unknown;
}

export interface RumDashboard {
  panels?: DashboardPanel[];
  [key: string]: unknown;
}

export interface FilterResult {
  dashboard: RumDashboard;
  droppedCount: number;
  keptCount: number;
}

/** The concatenated SQL of every query on a panel. */
const panelSql = (panel: DashboardPanel): string =>
  (panel?.queries ?? []).map((q) => q?.query ?? "").join("\n");

/**
 * True when the panel references a capability-gated column that is NOT in the schema —
 * i.e. running it would fail with "column not found".
 */
const panelReferencesAbsentField = (panel: DashboardPanel, presentFields: Set<string>): boolean => {
  const sql = panelSql(panel);
  if (!sql) return false;
  return fieldMatchers.some(([field, matcher]) => !presentFields.has(field) && matcher.test(sql));
};

/**
 * Repack panels into a tidy 12-col grid, preserving each panel's width/height and its
 * original reading order (top-to-bottom, left-to-right). Used only after panels are
 * removed, so gaps left by dropped panels don't remain in the layout.
 */
const reflowPanels = (panels: DashboardPanel[]): DashboardPanel[] => {
  const ordered = [...panels].sort(
    (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
  );

  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;

  return ordered.map((panel) => {
    const w = Math.min(panel.layout.w, GRID_WIDTH);
    if (cursorX + w > GRID_WIDTH) {
      rowY += rowHeight;
      cursorX = 0;
      rowHeight = 0;
    }
    const layout: DashboardPanelLayout = {
      ...panel.layout,
      x: cursorX,
      y: rowY,
      w,
    };
    cursorX += w;
    rowHeight = Math.max(rowHeight, panel.layout.h);
    return { ...panel, layout };
  });
};

/**
 * Remove panels whose queries reference columns absent from the stream schema, then
 * reflow the survivors.
 *
 * @param dashboard      A version-2 RUM dashboard (flat `panels[]` with per-panel layout).
 * @param presentFields  The set of column names in the `_rumdata` schema. When null or
 *                       empty (schema not yet known) the dashboard is returned UNCHANGED,
 *                       so a browser user is never degraded by an unresolved schema.
 * @returns The (possibly filtered) dashboard plus counts. When nothing is dropped, the
 *          SAME dashboard reference is returned so rendering is identical.
 */
export const filterDashboardBySchema = (
  dashboard: RumDashboard,
  presentFields: Set<string> | null | undefined,
): FilterResult => {
  const panels = dashboard?.panels ?? [];

  // Unknown schema → don't touch anything (non-regression for the common browser path).
  if (!presentFields || presentFields.size === 0) {
    return { dashboard, droppedCount: 0, keptCount: panels.length };
  }

  const kept = panels.filter((panel) => !panelReferencesAbsentField(panel, presentFields));
  const droppedCount = panels.length - kept.length;

  if (droppedCount === 0) {
    return { dashboard, droppedCount: 0, keptCount: kept.length };
  }

  return {
    dashboard: { ...dashboard, panels: reflowPanels(kept) },
    droppedCount,
    keptCount: kept.length,
  };
};

/**
 * Build the present-field Set from the `_rumdata` schema map held in `performanceState`
 * (`{ [fieldName]: field }`). Returns null when the schema isn't loaded, which callers
 * pass straight through to `filterDashboardBySchema` to get the no-op behavior.
 */
export const presentFieldsFromSchemaMap = (
  schemaMap: Record<string, unknown> | null | undefined,
): Set<string> | null => {
  if (!schemaMap) return null;
  const names = Object.keys(schemaMap);
  return names.length ? new Set(names) : null;
};
