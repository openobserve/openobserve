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

import { toRaw } from "vue";
import type { PanelFailedRefreshHold } from "@/composables/dashboard/panelFailedRefreshHold";

/** The part of the Traces search state the charts' failed-refresh policy reads and writes. */
export interface TracesRunState {
  meta: {
    searchMode?: string;
    refreshFailedAt: number | null;
    lastRunAt?: number;
    chartRefreshFailed: boolean;
    chartsDataFrom?: number;
  };
  data: { editorValue?: string; stream: { selectedStream: { value?: string } } };
}

/** The RED panels' hold, told the source of each dashboard it generates. */
export interface TracesFailedRefreshHold extends PanelFailedRefreshHold {
  /** Ties each generated panel to the source its request was built from. */
  generated: (panels: object[], source: string) => void;
}

/** The stream, mode and query a chart's result belongs to; a chart of another one is never kept, as with the rows. */
export const tracesChartSource = (searchObj: TracesRunState) =>
  [
    searchObj.data.stream.selectedStream?.value ?? "",
    searchObj.meta.searchMode ?? "",
    String(searchObj.data.editorValue ?? "").trim(),
  ].join("\u0000");

/** Marks a chart load starting; the charts on screen until it lands date from the last run. */
export function startTracesChartLoad(searchObj: TracesRunState) {
  searchObj.meta.chartRefreshFailed = false;
  searchObj.meta.chartsDataFrom = searchObj.meta.lastRunAt;
}

/** A chart kept its older result after a failed refresh: the page shows the failed-refresh marker, and the data age stays at that result (ruling 18). */
export function reportTracesChartRefreshFailed(searchObj: TracesRunState) {
  searchObj.meta.chartRefreshFailed = true;
  searchObj.meta.refreshFailedAt = Date.now();
  searchObj.meta.lastRunAt = searchObj.meta.chartsDataFrom;
}

/** RED panels keep a chart of the last generated stream, mode and query when its refresh fails, and the results header reports it. */
export function createTracesFailedRefreshHold(searchObj: TracesRunState): TracesFailedRefreshHold {
  const builtFrom = new WeakMap<object, string>();
  let lastGenerated = "";
  return {
    generated: (panels, source) => {
      lastGenerated = source;
      panels.forEach((panel) => builtFrom.set(toRaw(panel), source));
    },
    source: (panel) => (panel ? (builtFrom.get(toRaw(panel)) ?? "") : ""),
    hold: (_panelId, source) => {
      if (!source || source !== lastGenerated) return false;
      reportTracesChartRefreshFailed(searchObj);
      return true;
    },
  };
}
