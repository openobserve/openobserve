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
import { calculateGridPositions } from "./calculateGridForSubPlot";
import {
  calculateMetricFontSize,
  METRIC_SPARKLINE,
  type SparklineConfig,
} from "./sql/charts/convertSQLMetricChart";

/** Lays metric cells out as a grid: sets each cell's `_metricLayout` and a `renderItem` that draws it in panel pixels. */
export const layoutMetricGrid = (
  cells: any[],
  panelSpark: SparklineConfig | null | undefined,
  panelW: number,
  panelH: number,
): void => {
  const gridData = calculateGridPositions(panelW, panelH, cells.length);
  const longestText = cells.reduce(
    (acc: string, s: any) =>
      (s._metricText ?? "").length > acc.length ? (s._metricText ?? "") : acc,
    "",
  );
  const labelFontSize = Math.max(11, Math.min(14, Math.round(gridData.gridWidth / 30)));

  // Panel-level sparkline (all metric cells share the same config).
  const sparkOn = !!panelSpark?.enabled;
  const sparkBackground = sparkOn && panelSpark?.layout === "background";
  const sparkBottom = sparkOn && !sparkBackground;

  // The label sits below the value in the same cell, so it comes out of the value's height budget.
  const valueBandHeight = sparkBottom
    ? gridData.gridHeight * 0.58 - labelFontSize - 10
    : gridData.gridHeight - labelFontSize - 10;
  const sharedFontSize = calculateMetricFontSize(
    longestText,
    gridData.gridWidth,
    Math.max(1, valueBandHeight),
  );

  // Draw a mini sparkline (line/area/bar) inside a cell rect.
  const buildCellSparkline = (
    data: number[],
    cfg: any,
    left: number,
    top: number,
    width: number,
    height: number,
  ): any[] => {
    const n = data.length;
    if (n < 2) return [];
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const hpad = width * 0.02;
    const bandTop = sparkBackground
      ? top
      : top + height * (METRIC_SPARKLINE.bottomBandTopPct / 100);
    // Band height is intentionally cell-specific (not shared with the series path).
    const bandH = sparkBackground ? height : height * 0.33;
    const vGap = sparkBackground ? bandH * 0.02 : 0;
    const ceilY = bandTop + vGap;
    const floorY = bandTop + bandH - vGap;
    const xAt = (i: number) => left + hpad + (i / (n - 1)) * (width - 2 * hpad);
    const yAt = (v: number) => floorY - ((v - min) / range) * (floorY - ceilY);
    const color = cfg?.color || chartColor("--color-chart-metric-text");
    const opacity = sparkBackground ? METRIC_SPARKLINE.faintOpacity : 1;
    const out: any[] = [];
    if (cfg?.type === "bar") {
      const bw = ((width - 2 * hpad) / n) * 0.6;
      for (let i = 0; i < n; i++) {
        const x = xAt(i);
        const y = yAt(data[i]);
        out.push({
          type: "rect",
          shape: { x: x - bw / 2, y, width: bw, height: floorY - y },
          style: { fill: color, opacity },
          silent: true,
        });
      }
    } else {
      const points = data.map((v, i) => [xAt(i), yAt(v)]);
      if (cfg?.type === "area") {
        const fillOpacity =
          typeof cfg?.fillOpacity === "number" ? cfg.fillOpacity : METRIC_SPARKLINE.fillOpacity;
        out.push({
          type: "polygon",
          shape: {
            points: [...points, [xAt(n - 1), floorY], [xAt(0), floorY]],
          },
          style: {
            fill: color,
            opacity: sparkBackground ? fillOpacity * METRIC_SPARKLINE.faintAreaFactor : fillOpacity,
          },
          silent: true,
        });
      }
      out.push({
        type: "polyline",
        shape: { points },
        style: {
          stroke: color,
          lineWidth:
            typeof cfg?.lineWidth === "number" ? cfg.lineWidth : METRIC_SPARKLINE.lineWidth,
          fill: "none",
          opacity,
        },
        silent: true,
      });
    }
    return out;
  };

  cells.forEach((s: any, idx: number) => {
    const cell = gridData?.gridArray?.[idx];
    if (!cell) return;
    const cellLeft = (parseFloat(cell.left) / 100) * panelW;
    const cellTop = (parseFloat(cell.top) / 100) * panelH;
    const cellWidth = (parseFloat(cell.width) / 100) * panelW;
    const cellHeight = (parseFloat(cell.height) / 100) * panelH;
    const cx = cellLeft + cellWidth / 2;
    const cy = cellTop + cellHeight / 2;
    const fill = s?._metricFillColor ?? chartColor("--color-text-heading");
    const cellBg = s?._metricBgColor;
    // With a bottom sparkline the value sits in the top band; otherwise centered.
    const valueY = sparkBottom ? cellTop + cellHeight * 0.3 : cy - labelFontSize / 2 - 2;
    const labelY = sparkBottom
      ? valueY + sharedFontSize / 2 + labelFontSize / 2 + 4
      : cy + sharedFontSize / 2 + 4;
    // The cell rect is the copy hover zone; cx/cy/fontSize place the copy icon beside the number.
    s._metricLayout = {
      left: cellLeft,
      top: cellTop,
      width: cellWidth,
      height: cellHeight,
      cx,
      cy: valueY,
      fontSize: sharedFontSize,
      // A copy button placed below the value must clear the field label.
      labelClearance: labelFontSize * 1.2 + 8,
    };
    s.renderItem = () => {
      try {
        const children: any[] = [];
        // per-cell mapped background drawn behind the value
        if (cellBg) {
          children.push({
            type: "rect",
            shape: { x: cellLeft, y: cellTop, width: cellWidth, height: cellHeight },
            style: { fill: cellBg },
            silent: true,
          });
        }
        // per-cell sparkline trend (behind the value)
        if (sparkOn && Array.isArray(s._metricSparkData)) {
          children.push(
            ...buildCellSparkline(
              s._metricSparkData,
              s._metricSparkConfig,
              cellLeft,
              cellTop,
              cellWidth,
              cellHeight,
            ),
          );
        }
        children.push({
          type: "text",
          style: {
            text: s._metricText ?? "",
            fontSize: sharedFontSize,
            fontWeight: 500,
            align: "center",
            verticalAlign: "middle",
            x: cx,
            y: valueY,
            fill,
          },
        });
        children.push({
          type: "text",
          style: {
            text: s._metricLabel ?? "",
            fontSize: labelFontSize,
            fontWeight: 400,
            align: "center",
            verticalAlign: "middle",
            x: cx,
            y: labelY,
            fill,
            opacity: 0.65,
          },
        });
        return { type: "group", children };
      } catch {
        return "";
      }
    };
  });
};
