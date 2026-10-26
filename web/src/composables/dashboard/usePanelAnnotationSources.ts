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

import { computed, inject, type InjectionKey, type Ref } from "vue";
import type { QueryAnnotationMarker } from "@/ts/interfaces/dashboard";

// Kept out of useDashboardAnnotationSources.ts: that file's annotationSources.ts import reaches sqlIdentifiers.ts's store read at load time, which every panel (via PanelSchemaRenderer.vue) must not carry.

export interface DashboardAnnotationSources {
  /** True while any enabled source is fetching or waiting on its variables. */
  loading: Ref<boolean>;
  markersForPanel: (_panelId: string, _panelType: string) => QueryAnnotationMarker[];
  failedSourcesForPanel: (_panelId: string, _panelType: string) => string[];
  truncatedSourcesForPanel: (_panelId: string, _panelType: string) => string[];
}

export const DASHBOARD_ANNOTATION_SOURCES_KEY: InjectionKey<DashboardAnnotationSources> = Symbol(
  "dashboardAnnotationSources",
);

/** The markers and failed source names for one panel; empty outside a dashboard. */
export const usePanelAnnotationSources = (
  panelId: () => string | undefined,
  panelType: () => string | undefined,
) => {
  const provider = inject(DASHBOARD_ANNOTATION_SOURCES_KEY, null);
  const markers = computed<QueryAnnotationMarker[]>(() => {
    const id = panelId();
    const type = panelType();
    if (!provider || !id || !type) return [];
    return provider.markersForPanel(id, type);
  });
  const failedSources = computed<string[]>(() => {
    const id = panelId();
    const type = panelType();
    if (!provider || !id || !type) return [];
    return provider.failedSourcesForPanel(id, type);
  });
  const truncatedSources = computed<string[]>(() => {
    const id = panelId();
    const type = panelType();
    if (!provider || !id || !type) return [];
    return provider.truncatedSourcesForPanel(id, type);
  });
  return { markers, failedSources, truncatedSources };
};
