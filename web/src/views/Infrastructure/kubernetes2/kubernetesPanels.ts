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

import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

export interface PanelQuery {
  query: string;
  // The stream the query reads, for the engine's stream bookkeeping.
  stream: string;
  legend?: string;
}

export interface MarkLine {
  value: number;
  name: string;
}

export interface PanelArgs {
  id: string;
  type: "area" | "bar" | "line";
  unit: "bytes" | "bps" | "numbers" | null;
  queries: PanelQuery[];
  markLines?: MarkLine[];
}

const DECIMALS = 2;

// The axis formats in the panel unit, so a raw-value label would read in a different scale.
const markLabel = (m: MarkLine, unit: PanelArgs["unit"]) =>
  `${m.name}: ${formatUnitValue(getUnitValue(m.value, unit ?? "default", "", DECIMALS))}`;

// A self-querying version-2 PromQL panel for PanelSchemaRenderer, the shape the DBM metric panels use.
export function promqlPanelSchema(args: PanelArgs): Record<string, any> {
  return {
    version: 2,
    id: args.id,
    title: "",
    description: "",
    type: args.type,
    config: {
      show_legends: args.queries.length > 1,
      legends_position: "bottom",
      decimals: DECIMALS,
      connect_nulls: true,
      no_value_replacement: "",
      show_symbol: false,
      axis_border_show: true,
      unit: args.unit,
      unit_custom: null,
      mark_line: (args.markLines ?? []).map((m) => ({
        type: "yAxis",
        value: m.value,
        name: m.name,
        label: markLabel(m, args.unit),
      })),
      // The engine takes max(y_axis_max, data), so a line above the data is still on the chart.
      y_axis_max: args.markLines?.length ? Math.max(...args.markLines.map((m) => m.value)) : null,
    },
    queryType: "promql",
    queries: args.queries.map((q) => ({
      query: q.query,
      customQuery: true,
      vrlFunctionQuery: "",
      fields: {
        stream: q.stream,
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        latitude: null,
        longitude: null,
        weight: null,
      },
      config: {
        promql_legend: q.legend ?? "",
        layer_type: "scatter",
        weight_fixed: 1,
        limit: 0,
        min: 0,
        max: 100,
        time_shift: [],
      },
    })),
  };
}
