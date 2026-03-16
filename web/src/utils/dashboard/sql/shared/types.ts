// Copyright 2023 OpenObserve Inc.
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

/**
 * SQLContext
 *
 * Carries all shared, computed state that is built once (before the chart-type
 * switch) and consumed by every chart-specific handler.  Chart handlers receive
 * this object, mutate `ctx.options` as needed, and return.
 */
export interface SQLContext {
  // Raw inputs
  panelSchema: any;
  searchQueryData: any;
  store: any;
  chartPanelRef: any;
  hoveredSeriesState: any;
  chartPanelStyle: any;
  annotations: any;
  metadata: any;
  resultMetaData: any;

  // Computed axis keys
  xAxisKeys: string[];
  yAxisKeys: string[];
  zAxisKeys: string[];
  breakDownKeys: string[];

  // Processed data
  missingValueData: any[];
  extras: any;

  // Derived scalars
  showGridlines: boolean;
  hasTimestampField: boolean;
  isHorizontalChart: boolean;
  dynamicXAxisNameGap: number;
  convertedTimeStampToDataFormat: string;
  defaultSeriesProps: any;
  chartMin: any;
  chartMax: any;
  defaultGrid: any;

  // Mutable ECharts options object (mutated by chart handlers)
  options: any;

  // Closure-based helpers
  /** Returns axis data array for the given field alias. */
  getAxisDataFromKey: (key: string) => any[];
  /** Builds series array for the current chart type. */
  getSeries: (seriesConfig?: Record<string, any>) => any[];
  /** Returns annotation mark-line config. */
  getAnnotationMarkLine: () => any;
  /** Returns annotation mark-area config. */
  getSeriesMarkArea: () => any;
  /** Calculates pie/donut chart radius accounting for legend space. */
  getPieChartRadius: (seriesData?: any[]) => number;
  /** Applies trellis grid layout to options (only for trellis chart types). */
  updateTrellisConfig: () => void;
}
