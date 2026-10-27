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

import { color as echartsColor } from "echarts/core";
import { chartColor } from "@/utils/chartTheme";
import { labelColorOn } from "./chartLabelContrast";
import { escapeHtml } from "@/utils/html";
import { calculateWidthText } from "./chartDimensionUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { buildTreemapNodes, paintByPalette, type TreemapNode } from "./convertTreemapData";

// Rings thinner than this many degrees drop their label instead of overprinting the neighbour.
const MIN_LABEL_ANGLE = 8;
// A radial label is one text line across the slice, so the slice must be at least this wide at its middle.
const LABEL_LINE_HEIGHT = 14;
// Below this the ring is too shallow for even a few characters, so its labels are hidden.
const MIN_LABEL_WIDTH = 24;
const LABEL_PADDING = 4;
// eslint-disable-next-line local/no-hardcoded-px -- ECharts label fontSize is a plain canvas px value
const LABEL_FONT_SIZE = "12px";
const OUTER_RING_OPACITY = 0.72;
const OUTER_RADIUS = 0.92;
const FALLBACK_PANEL = { width: 800, height: 400 };

/** Minimum slice angle for a ring between radii r0 and r, in pixels, or no labels when the ring is too shallow. */
const ringLabel = (r0: number, r: number) => {
  if (r - r0 - 2 * LABEL_PADDING < MIN_LABEL_WIDTH) return { show: false };
  const minAngle = (LABEL_LINE_HEIGHT / ((r0 + r) / 2)) * (180 / Math.PI);
  return { minAngle: Math.max(MIN_LABEL_ANGLE, minAngle) };
};

/** True when the name fits whole along the ring's depth and the slice is a text line wide at its middle. */
const labelFits = (name: string, share: number, r0: number, r: number) =>
  calculateWidthText(name, LABEL_FONT_SIZE) <= r - r0 - 2 * LABEL_PADDING &&
  share * 2 * Math.PI * ((r0 + r) / 2) >= LABEL_LINE_HEIGHT;

/** Converts SQL rows into a sunburst: the x field is the inner ring, the breakdown the outer ring. */
export const convertSunburstData = (
  panelSchema: any,
  data: any,
  store: any,
  chartPanelRef?: any,
) => {
  const config = panelSchema?.config ?? {};
  const nodes = buildTreemapNodes(panelSchema, Array.isArray(data) ? data : []);
  if (!nodes.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(nodes, config, store?.state?.theme);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const hasDrilldown = (config.drilldown?.length ?? 0) > 0;
  const nested = nodes.some((node) => node.children?.length);
  const surface = chartColor("--color-surface-base");
  // The outer ring is painted as its parent's colour faded onto the panel, so its label contrast can be judged.
  nodes.forEach((node) => {
    const color = node.itemStyle?.color;
    if (!color) return;
    node.label = { color: labelColorOn(color) };
    node.children?.forEach((child) => {
      const faded = echartsColor.lerp(OUTER_RING_OPACITY, [surface, color]) || color;
      child.itemStyle = { color: faded };
      child.label = { color: labelColorOn(faded) };
    });
  });
  const base =
    Math.min(
      chartPanelRef?.value?.offsetWidth || FALLBACK_PANEL.width,
      chartPanelRef?.value?.offsetHeight || FALLBACK_PANEL.height,
    ) / 2;
  const innerRadius = nested ? 0.12 : 0.3;
  const split = nested ? (innerRadius + OUTER_RADIUS) / 2 : OUTER_RADIUS;
  const total = nodes.reduce((sum, node) => sum + node.value, 0) || 1;
  // A label that does not fit whole is hidden rather than cut; the tooltip still names the slice.
  const hideUnfitting = (node: TreemapNode, r0: number, r: number) => {
    if (!labelFits(node.name, node.value / total, r0 * base, r * base)) {
      node.label = { ...node.label, show: false };
    }
  };
  nodes.forEach((node) => {
    hideUnfitting(node, innerRadius, split);
    node.children?.forEach((child) => hideUnfitting(child, split, OUTER_RADIUS));
  });

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
        radius: [`${innerRadius * 100}%`, `${OUTER_RADIUS * 100}%`],
        // A click opens the drilldown menu, so it must not also re-root the chart under it.
        nodeClick: hasDrilldown ? false : "rootToNode",
        emphasis: { focus: "ancestor" },
        itemStyle: { borderColor: surface, borderWidth: 1 },
        label: {
          show: config.sunburst_show_labels !== false,
          rotate: "radial",
          minAngle: MIN_LABEL_ANGLE,
          fontSize: 12,
          color: chartColor("--color-text-inverse"),
        },
        levels: [
          {},
          { label: ringLabel(innerRadius * base, split * base) },
          { label: ringLabel(split * base, OUTER_RADIUS * base) },
        ],
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
