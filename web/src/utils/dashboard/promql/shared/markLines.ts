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

import { chartColor } from "@/utils/chartTheme";

interface MarkLineConfig {
  name?: string;
  type?: string;
  value?: unknown;
  color?: string;
  show_label?: boolean;
}

interface MarkLinePanel {
  config?: { mark_line?: MarkLineConfig[] };
}

/** The panel's configured mark lines as ECharts markLine data items. */
const getMarkLineData = (panelSchema: MarkLinePanel | null | undefined) => {
  return (
    panelSchema?.config?.mark_line?.map((markLine) => {
      return {
        name: markLine.name,
        type: markLine.type,
        xAxis: markLine.type === "xAxis" ? markLine.value : null,
        yAxis: markLine.type === "yAxis" ? markLine.value : null,
        label: {
          // The alert preview hides labels: its lines are colour-coded and a label clips at the top.
          show: markLine.show_label !== false,
          formatter: markLine.name ? "{b}:{c}" : "{c}",
          position: "insideEndTop",
        },
        ...(markLine.color ? { lineStyle: { color: markLine.color } } : {}),
      };
    }) ?? []
  );
};

/** A series' markLine block drawing the panel's mark lines. */
export const buildSeriesMarkLine = (panelSchema: MarkLinePanel | null | undefined) => ({
  silent: true,
  animation: false,
  data: getMarkLineData(panelSchema),
  lineStyle: {
    color: "#8B5A2B",
    type: [8, 4],
    width: 2,
    shadowColor: chartColor("--color-chart-markline-shadow"),
    shadowBlur: 2,
  },
});
