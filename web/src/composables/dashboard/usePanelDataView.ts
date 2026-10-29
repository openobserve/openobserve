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

import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";

export type PanelPreviewView = "chart" | "data";

// Already tabular, or not query-driven, so a raw-rows view adds nothing.
const NO_DATA_VIEW_TYPES = ["table", "html", "markdown", "custom_chart"];

/** Per-viewer Chart | Data switch state for a rendered panel; never saved with the panel. */
export function usePanelDataView({
  panelType,
  renderer,
  enabled = true,
}: {
  panelType: MaybeRefOrGetter<string | undefined>;
  renderer: MaybeRefOrGetter<any>;
  enabled?: MaybeRefOrGetter<boolean>;
}) {
  const previewView = ref<PanelPreviewView>("chart");

  const showDataViewToggle = computed(
    () => toValue(enabled) && !NO_DATA_VIEW_TYPES.includes(toValue(panelType) ?? ""),
  );

  const isDataView = computed(() => showDataViewToggle.value && previewView.value === "data");

  // A failed query keeps its error on screen; its data may be the panel's error placeholder.
  const showDataOverlay = computed(
    () => isDataView.value && !toValue(renderer)?.errorDetail?.message,
  );

  // filteredData drops queries hidden in the legend, so the rows match the chart.
  const rawData = computed(() => toValue(renderer)?.filteredData);

  return { previewView, showDataViewToggle, isDataView, showDataOverlay, rawData };
}
