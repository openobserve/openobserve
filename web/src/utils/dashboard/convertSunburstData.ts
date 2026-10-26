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
import { escapeHtml } from "@/utils/html";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { buildTreemapNodes, paintByPalette } from "./convertTreemapData";

// Rings thinner than this many degrees drop their label instead of overprinting the neighbour.
const MIN_LABEL_ANGLE = 8;

/** Converts SQL rows into a sunburst: the x field is the inner ring, the breakdown the outer ring. */
export const convertSunburstData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const nodes = buildTreemapNodes(panelSchema, Array.isArray(data) ? data : []);
  if (!nodes.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(nodes, config, store?.state?.theme);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const hasDrilldown = (config.drilldown?.length ?? 0) > 0;
  const nested = nodes.some((node) => node.children?.length);

  const options = {
    backgroundColor: "transparent",
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) => {
        const path: string[] = params?.data?.path ?? [params?.name ?? ""];
        return `${escapeHtml(path.join(" / "))}: <strong>${escapeHtml(format(params?.value))}</strong>`;
      },
    },
    series: [
      {
        type: "sunburst",
        data: nodes,
        center: ["50%", "50%"],
        radius: [nested ? "12%" : "30%", "92%"],
        // A click opens the drilldown menu, so it must not also re-root the chart under it.
        nodeClick: hasDrilldown ? false : "rootToNode",
        emphasis: { focus: "ancestor" },
        itemStyle: { borderColor: chartColor("--color-surface-base"), borderWidth: 1 },
        label: {
          show: config.sunburst_show_labels !== false,
          rotate: "radial",
          minAngle: MIN_LABEL_ANGLE,
          overflow: "truncate",
          color: chartColor("--color-text-inverse"),
        },
        levels: [{}, {}, { itemStyle: { opacity: 0.72 } }],
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
