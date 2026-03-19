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
 * Typed contract between the main thread and the SQL data worker.
 *
 * All types here must be fully serializable (structured-clone safe):
 * plain objects, arrays, strings, numbers, booleans, null ΓÇö no Functions,
 * no DOM nodes, no Vue Proxies, no Vuex stores.
 */

// ---------------------------------------------------------------------------
// Input ΓÇö what the main thread sends to the worker
// ---------------------------------------------------------------------------

export interface SQLWorkerStoreSnapshot {
  theme: string;
  timezone: string;
  timestampColumn: string;
  maxDashboardSeries: number;
}

export interface SQLWorkerHoveredSeriesSnapshot {
  panelId: string | null;
  hoveredSeriesName: string | null;
}

export interface SQLWorkerInput {
  panelSchema: any;
  searchQueryData: any;
  /** Unwrapped resultMetaData array (no .value wrapper) */
  resultMetaData: any;
  metadata: any;
  /** Unwrapped annotations array (from Vue ref) */
  annotationsValue: any[];
  /** Unwrapped chartPanelStyle plain object */
  chartPanelStyle: {
    height?: string;
    [key: string]: any;
  };
  /** Pixel dimensions read from the DOM ref before posting */
  chartDimensions: {
    width: number;
    height: number;
  };
  /** Scalar values extracted from the Vuex store Proxy */
  storeSnapshot: SQLWorkerStoreSnapshot;
  /** Scalar values extracted from the Vue hoveredSeriesState ref */
  hoveredSeriesSnapshot: SQLWorkerHoveredSeriesSnapshot | null;
}

// ---------------------------------------------------------------------------
// Output ΓÇö what the worker sends back (fully serializable; no functions)
// Contains every value built during the data-processing phase of buildSQLContext.
// The main thread receives this and uses it to build the ECharts options object
// (which requires formatter function closures that cannot cross postMessage).
// ---------------------------------------------------------------------------

export interface SerializableDataContext {
  // Axis keys
  xAxisKeys: string[];
  yAxisKeys: string[];
  zAxisKeys: string[];
  breakDownKeys: string[];

  // Processed / filled data rows (plain array of plain objects)
  missingValueData: any[];
  extras: any;

  // Derived scalars ΓÇö computed from data, all primitive values
  showGridlines: boolean;
  hasTimestampField: boolean;
  isHorizontalChart: boolean;
  dynamicXAxisNameGap: number;
  additionalBottomSpace: number;
  convertedTimeStampToDataFormat: string;
  defaultSeriesProps: any;

  // Numeric bounds for series colour mapping
  chartMin: any;
  chartMax: any;
  min: number;
  max: number;

  // Layout defaults
  defaultGrid: any;

  // Label metrics (pixels)
  labelRotation: number;
  labelWidth: number;

  // Mark line data (plain objects, no functions)
  markLineData: any[];

  // Config values forwarded to assembler
  noValueConfigOption: string;
}

// ---------------------------------------------------------------------------
// Worker interface ΓÇö the shape accepted by convertMultiSQLData and
// convertPanelData so callers only depend on this contract, not the composable.
// ---------------------------------------------------------------------------

export interface SQLDataWorker {
  computeAsync(
    panelId: string,
    input: SQLWorkerInput,
  ): Promise<(SerializableDataContext | null)[]>;
  terminate(): void;
}

// ---------------------------------------------------------------------------
// Adapter helpers ΓÇö reconstruct minimal stand-ins from plain snapshots
// Used inside the worker to call existing utility functions unchanged.
// ---------------------------------------------------------------------------

/**
 * Reconstruct a minimal store-like object from a plain snapshot.
 * The worker calls this to pass a store-shaped object into buildSQLDataContext.
 */
export const storeFromSnapshot = (
  snap: SQLWorkerStoreSnapshot,
): {
  state: {
    theme: string;
    timezone: string;
    zoConfig: { timestamp_column: string; max_dashboard_series: number };
  };
} => ({
  state: {
    theme: snap.theme,
    timezone: snap.timezone,
    zoConfig: {
      timestamp_column: snap.timestampColumn,
      max_dashboard_series: snap.maxDashboardSeries,
    },
  },
});

/**
 * Reconstruct a chartPanelRef-like object from plain dimensions.
 * The worker calls this to pass a ref-shaped object into buildSQLDataContext.
 */
export const chartPanelRefFromDimensions = (dims: {
  width: number;
  height: number;
}): { value: { offsetWidth: number; offsetHeight: number } } => ({
  value: { offsetWidth: dims.width, offsetHeight: dims.height },
});
