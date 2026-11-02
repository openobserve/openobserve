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

import { toZonedTime } from "date-fns-tz";
import type { I18nText } from "@/types/i18n";

interface AxisField {
  alias: string;
  column: string;
  color: null;
  label: I18nText;
}

const axis = (alias: string, label: I18nText): AxisField => ({
  alias,
  column: alias,
  color: null,
  label,
});

export interface ChartMarker {
  version: string;
  /** Release first-seen time in epoch milliseconds. */
  ms: number;
}

export interface ChartLabels {
  title: I18nText;
  time: I18nText;
  sessions: I18nText;
  errors: I18nText;
}

// The engine zone-shifts SQL x values, so the marker is shifted alike; its label would print the raw timestamp.
export const buildOverviewChartPanel = (
  sql: string,
  labels: ChartLabels,
  marker: ChartMarker | null,
  timezone: string,
): Record<string, unknown> => ({
  version: 2,
  id: "rum-overview-chart",
  title: labels.title,
  description: "",
  type: "line",
  config: {
    show_legends: true,
    legends_position: "bottom",
    decimals: 0,
    axis_border_show: true,
    connect_nulls: true,
    no_value_replacement: "",
    show_symbol: false,
    base_map: { type: "osm" },
    map_view: { zoom: 1, lat: 0, lng: 0 },
    mark_line: marker
      ? [
          {
            name: marker.version,
            type: "xAxis",
            value: toZonedTime(new Date(marker.ms), timezone),
            show_label: false,
          },
        ]
      : [],
  },
  queryType: "sql",
  queries: [
    {
      query: sql,
      customQuery: true,
      vrlFunctionQuery: "",
      fields: {
        stream: "_rumdata",
        stream_type: "logs",
        x: [axis("x_axis_1", labels.time)],
        y: [axis("y_axis_1", labels.sessions), axis("y_axis_2", labels.errors)],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        latitude: null,
        longitude: null,
        weight: null,
      },
      config: {
        promql_legend: "",
        layer_type: "scatter",
        weight_fixed: 1,
        limit: 0,
        min: 0,
        max: 100,
        time_shift: [],
      },
    },
  ],
});
