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

import { ref } from "vue";

export const CHART_ZOOM_MIN = 0.4;
export const CHART_ZOOM_MAX = 3;
export const CHART_ZOOM_STEP = 1.25;

export interface ZoomRange {
  min: number;
  max: number;
}

/** Narrows (factor > 1) or widens a range around its centre, kept inside `bounds` and no narrower than `minSpan`. */
export function zoomRange(
  range: ZoomRange,
  factor: number,
  bounds: ZoomRange,
  minSpan: number,
): ZoomRange {
  const fullSpan = bounds.max - bounds.min;
  const span = Math.min(fullSpan, Math.max(minSpan, (range.max - range.min) / factor));
  const centre = (range.min + range.max) / 2;
  const min = Math.min(bounds.max - span, Math.max(bounds.min, centre - span / 2));
  return { min, max: min + span };
}

/** Shifts a range by `delta` without changing its width, stopping at `bounds`. */
export function panRange(range: ZoomRange, delta: number, bounds: ZoomRange): ZoomRange {
  const span = range.max - range.min;
  const min = Math.min(bounds.max - span, Math.max(bounds.min, range.min + delta));
  return { min, max: min + span };
}

/** Button zoom for roam-enabled ECharts tree/graph series; `fitToScreen` recreates the chart through `chartKey`. */
export default function useChartZoom(getChart: () => any, onBeforeFit?: () => void) {
  const chartKey = ref(0);

  // Read the live zoom so a button press continues from the wheel's level.
  const currentZoom = (chart: any): number => {
    const z = chart.getOption?.()?.series?.[0]?.zoom;
    return typeof z === "number" && z > 0 ? z : 1;
  };

  const zoomBy = (factor: number) => {
    const chart = getChart();
    if (!chart) return;
    const next = Math.min(CHART_ZOOM_MAX, Math.max(CHART_ZOOM_MIN, currentZoom(chart) * factor));
    chart.setOption({ series: [{ zoom: next }] }, { lazyUpdate: true });
  };

  const zoomIn = () => zoomBy(CHART_ZOOM_STEP);
  const zoomOut = () => zoomBy(1 / CHART_ZOOM_STEP);

  const fitToScreen = () => {
    onBeforeFit?.();
    chartKey.value++;
  };

  return { chartKey, zoomIn, zoomOut, fitToScreen };
}
