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

import type { AnnotationSource } from "@/ts/interfaces/dashboard";

// Kept out of annotationSources.ts: that file's sqlIdentifiers.ts import reads the live store at load time, which commons.ts (this function's caller) must not carry.

/** Drops panel ids that no longer exist from every source's list; a list emptied this way targets no panel. */
export const pruneAnnotationSourcePanels = <
  T extends {
    tabs?: Array<{ panels?: Array<{ id?: string }> }>;
    annotationSources?: AnnotationSource[];
  },
>(
  dashboard: T,
): T => {
  if (!Array.isArray(dashboard?.tabs) || !Array.isArray(dashboard.annotationSources)) {
    return dashboard;
  }
  const panelIds = new Set(
    dashboard.tabs.flatMap((tab) => (tab?.panels ?? []).map((panel) => panel?.id)),
  );
  dashboard.annotationSources.forEach((source) => {
    if (!Array.isArray(source?.panels)) return;
    const kept = source.panels.filter((id) => panelIds.has(id));
    if (kept.length !== source.panels.length) source.panels = kept;
  });
  return dashboard;
};
