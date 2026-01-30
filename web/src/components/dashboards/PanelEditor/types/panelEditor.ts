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

import type { Ref } from "vue";

// ============================================================================
// Page Type
// ============================================================================

/**
 * The page context where PanelEditor is being used.
 * - 'dashboard': Full-featured panel editor with variables, save/discard
 * - 'metrics': PromQL-focused metrics visualization with auto-refresh
 * - 'logs': Simplified logs visualization receiving external data
 */
export type PanelEditorPageType = "dashboard" | "metrics" | "logs";

// ============================================================================
// DateTime Types
// ============================================================================

/**
 * Selected date time object passed from parent's DateTimePicker
 */
export interface PanelEditorDateTime {
  start_time: number | string;
  end_time: number | string;
  valueType?: "relative" | "absolute";
  relativeTimePeriod?: string;
}

// ============================================================================
// Variables Types
// ============================================================================

/**
 * Variables data structure for dashboard mode
 */
export interface PanelEditorVariablesData {
  isVariablesLoading: boolean;
  values: Array<{
    name: string;
    value: any;
    type?: string;
    isLoading?: boolean;
    options?: any[];
    isHidden?: boolean;
  }>;
}

// ============================================================================
// Error Data Types
// ============================================================================

/**
 * Error data structure for chart errors
 */
export interface PanelEditorErrorData {
  errors: string[];
}

// ============================================================================
// Search Response Types (for logs mode)
// ============================================================================

/**
 * Search response object passed from logs page
 */
export interface PanelEditorSearchResponse {
  hits?: any[];
  total?: number;
  took?: number;
  [key: string]: any;
}

// ============================================================================
// Chart Data Types
// ============================================================================

/**
 * Chart data object that contains panel configuration
 */
export interface PanelEditorChartData {
  version?: number;
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  config?: Record<string, any>;
  htmlContent?: string;
  markdownContent?: string;
  customChartContent?: string;
  customChartResult?: Record<string, any>;
  queryType?: "sql" | "promql";
  queries?: Array<{
    query: string;
    vrlFunctionQuery?: string;
    customQuery?: boolean;
    joins?: any[];
    fields?: {
      stream?: string;
      stream_type?: string;
      x?: any[];
      y?: any[];
      z?: any[];
      breakdown?: any[];
      promql_labels?: any[];
      promql_operations?: any[];
      filter?: any;
      latitude?: any;
      longitude?: any;
      weight?: any;
      name?: any;
      value_for_maps?: any;
      source?: any;
      target?: any;
      value?: any;
    };
    config?: {
      promql_legend?: string;
      step_value?: number | null;
      layer_type?: string;
      weight_fixed?: number;
      limit?: number;
      min?: number;
      max?: number;
      time_shift?: any[];
    };
  }>;
  [key: string]: any;
}

// ============================================================================
// Dashboard Data Types (for query builder)
// ============================================================================

/**
 * Dashboard data structure for dashboard mode
 */
export interface PanelEditorDashboardData {
  dashboardId?: string;
  title?: string;
  description?: string;
  tabs?: any[];
  variables?: {
    list?: any[];
  };
  defaultDatetimeDuration?: {
    type?: "relative" | "absolute";
    startTime?: string;
    endTime?: string;
    relativeTimePeriod?: string;
  };
  [key: string]: any;
}

// ============================================================================
// Props Interface
// ============================================================================

/**
 * PanelEditor component props.
 *
 * NOTE: Header-related props are NOT included here.
 * Each wrapper component (AddPanel, Metrics, Logs) manages its own header.
 */
export interface PanelEditorProps {
  // ---- Page Identification ----
  /**
   * The page type determines preset configuration and behavior.
   * @required
   */
  pageType: PanelEditorPageType;

  // ---- Content Configuration ----
  /**
   * Whether to show the query editor section at the bottom.
   * @default true (dashboard, metrics), false (logs)
   */
  showQueryEditor?: boolean;

  /**
   * Whether to show the query builder (drag-drop fields).
   * @default true (dashboard, metrics), false (logs)
   */
  showQueryBuilder?: boolean;

  /**
   * Whether to show variables selector above the chart.
   * @default true (dashboard), false (metrics, logs)
   */
  showVariablesSelector?: boolean;

  /**
   * Whether to show the last refreshed timestamp.
   * @default true (dashboard, metrics), false (logs)
   */
  showLastRefreshedTime?: boolean;

  /**
   * Whether to show the "Out of Date" warning when panel data differs from chart data.
   * @default true
   */
  showOutdatedWarning?: boolean;

  /**
   * Whether to show "Add to Dashboard" button inside chart area.
   * @default false (dashboard), true (metrics, logs)
   */
  showAddToDashboardButton?: boolean;

  // ---- Chart Configuration ----
  /**
   * Array of allowed chart types. If not specified, all chart types are allowed.
   * Used in logs mode to restrict chart types based on query type.
   */
  allowedChartTypes?: string[];

  // ---- External Data Props (for logs mode) ----
  /**
   * External chart data passed from parent (logs visualization).
   * When provided, PanelEditor uses this instead of running its own query.
   */
  externalChartData?: PanelEditorChartData;

  /**
   * Search response data from logs page.
   * Used by PanelSchemaRenderer to render charts.
   */
  searchResponse?: PanelEditorSearchResponse;

  /**
   * Whether this is a UI histogram (logs mode).
   * Affects chart rendering and query handling.
   */
  isUiHistogram?: boolean;

  /**
   * Whether to refresh without using cache (logs mode).
   * Triggers cache-busting when running queries.
   */
  shouldRefreshWithoutCache?: boolean;

  // ---- DateTime (passed from parent's DateTimePicker) ----
  /**
   * Selected date time from parent's DateTimePicker.
   * PanelEditor does NOT render DateTimePicker - that stays in wrapper.
   */
  selectedDateTime?: PanelEditorDateTime;

  // ---- Variables Data (passed from parent's VariablesSelector) ----
  /**
   * Variables data for query execution (dashboard mode).
   * PanelEditor does NOT manage variables - that stays in wrapper for dashboard.
   */
  variablesData?: PanelEditorVariablesData;

  // ---- Dashboard Data (for query builder) ----
  /**
   * Dashboard data for query builder context (dashboard mode).
   * Contains dashboard configuration, tabs, and variables definitions.
   */
  dashboardData?: PanelEditorDashboardData;

  // ---- Mode Flags ----
  /**
   * Whether the panel is in edit mode (editing existing panel vs creating new).
   * @default false
   */
  editMode?: boolean;
}

// ============================================================================
// Emits Interface
// ============================================================================

/**
 * Events emitted by PanelEditor component.
 */
export interface PanelEditorEmits {
  /**
   * Emitted when variables data is updated (dashboard mode).
   * Parent should update its variablesData and sync to URL.
   */
  (e: "variablesDataUpdated", data: PanelEditorVariablesData): void;

  /**
   * Emitted when "Add Variable" is clicked (dashboard mode).
   * Parent should open the AddSettingVariable drawer.
   */
  (e: "openAddVariable"): void;

  /**
   * Emitted when "Add to Dashboard" is clicked (metrics, logs mode).
   * Parent should open the AddToDashboard dialog.
   */
  (e: "addToDashboard"): void;

  /**
   * Emitted when chart API returns an error.
   * Parent can handle the error (e.g., show notification).
   */
  (e: "chartApiError", error: any): void;

  /**
   * Emitted when user zooms on chart (for datetime update).
   * Parent should update its DateTimePicker with new time range.
   */
  (e: "dataZoom", event: { start: number; end: number }): void;

  /**
   * Emitted when chart data changes (for parent to track).
   */
  (e: "chartDataUpdated", data: PanelEditorChartData): void;

  /**
   * Emitted when metadata is updated (for QueryInspector in dashboard mode).
   */
  (e: "metaDataUpdated", metadata: any): void;
}

// ============================================================================
// Expose Interface
// ============================================================================

/**
 * Methods and properties exposed by PanelEditor via ref.
 * Parent components access these via templateRef.value.
 */
export interface PanelEditorExpose {
  // ---- Actions ----
  /**
   * Run the chart query.
   * @param withoutCache - If true, bypass cache (enterprise feature)
   */
  runQuery: (withoutCache?: boolean) => void;

  /**
   * Reset error state.
   */
  resetErrors: () => void;

  /**
   * Collapse or expand the field list sidebar.
   */
  collapseFieldList: () => void;

  /**
   * Update the datetime for queries.
   * @param dateTime - The new datetime object
   */
  updateDateTime: (dateTime: PanelEditorDateTime) => void;

  // ---- State Refs ----
  /**
   * Current chart data (result of query execution).
   */
  chartData: Ref<PanelEditorChartData>;

  /**
   * Error data from chart queries.
   */
  errorData: PanelEditorErrorData;

  /**
   * Metadata from query execution (for QueryInspector).
   */
  metaData: Ref<any>;

  /**
   * Series data from chart rendering.
   */
  seriesData: Ref<any[]>;

  /**
   * Timestamp of last query execution.
   */
  lastTriggeredAt: Ref<Date | null>;

  // ---- Panel Data (from useDashboardPanelData) ----
  /**
   * Dashboard panel data object (reactive).
   * Contains panel configuration, queries, layout, etc.
   */
  dashboardPanelData: any;

  /**
   * Whether the chart is out of date (panel data differs from chart data).
   */
  isOutDated: Ref<boolean>;

  // ---- Loading State ----
  /**
   * Whether queries are currently running.
   */
  isLoading: Ref<boolean>;

  /**
   * Array of search request trace IDs (for cancel functionality).
   */
  searchRequestTraceIds: Ref<string[]>;

  // ---- Warning Messages ----
  /**
   * Max query range warning message.
   */
  maxQueryRangeWarning: Ref<string>;

  /**
   * Series limit warning message.
   */
  limitNumberOfSeriesWarningMessage: Ref<string>;

  /**
   * General error message.
   */
  errorMessage: Ref<string>;
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Configuration options for PanelEditor.
 * These are the resolved values after merging props with presets.
 */
export interface PanelEditorConfig {
  showQueryEditor: boolean;
  showQueryBuilder: boolean;
  showVariablesSelector: boolean;
  showLastRefreshedTime: boolean;
  showOutdatedWarning: boolean;
  showAddToDashboardButton: boolean;
}

/**
 * Preset configuration for dashboard page.
 * Full-featured panel editor with variables support.
 */
export const DASHBOARD_PRESET: PanelEditorConfig = {
  showQueryEditor: true,
  showQueryBuilder: true,
  showVariablesSelector: true,
  showLastRefreshedTime: true,
  showOutdatedWarning: true,
  showAddToDashboardButton: false, // Dashboard has Save button instead
};

/**
 * Preset configuration for metrics page.
 * PromQL-focused with auto-refresh support.
 */
export const METRICS_PRESET: PanelEditorConfig = {
  showQueryEditor: true,
  showQueryBuilder: true,
  showVariablesSelector: false,
  showLastRefreshedTime: true,
  showOutdatedWarning: true,
  showAddToDashboardButton: true, // Show inside chart area
};

/**
 * Preset configuration for logs visualization page.
 * Simplified - no query editor, receives external data.
 */
export const LOGS_PRESET: PanelEditorConfig = {
  showQueryEditor: false, // No query editor in visualization
  showQueryBuilder: false, // No query builder in visualization
  showVariablesSelector: false,
  showLastRefreshedTime: false,
  showOutdatedWarning: true,
  showAddToDashboardButton: true, // Show inside chart area
};

/**
 * Get preset configuration by page type.
 * @param pageType - The page type
 * @returns The preset configuration
 */
export function getPresetByPageType(
  pageType: PanelEditorPageType,
): PanelEditorConfig {
  switch (pageType) {
    case "dashboard":
      return DASHBOARD_PRESET;
    case "metrics":
      return METRICS_PRESET;
    case "logs":
      return LOGS_PRESET;
    default:
      return DASHBOARD_PRESET;
  }
}

/**
 * Merge props with preset configuration.
 * Props take precedence over preset defaults.
 * @param props - Component props
 * @returns Resolved configuration
 */
export function resolveConfig(props: PanelEditorProps): PanelEditorConfig {
  const preset = getPresetByPageType(props.pageType);

  return {
    showQueryEditor: props.showQueryEditor ?? preset.showQueryEditor,
    showQueryBuilder: props.showQueryBuilder ?? preset.showQueryBuilder,
    showVariablesSelector:
      props.showVariablesSelector ?? preset.showVariablesSelector,
    showLastRefreshedTime:
      props.showLastRefreshedTime ?? preset.showLastRefreshedTime,
    showOutdatedWarning:
      props.showOutdatedWarning ?? preset.showOutdatedWarning,
    showAddToDashboardButton:
      props.showAddToDashboardButton ?? preset.showAddToDashboardButton,
  };
}

// ============================================================================
// Chart Types (for allowedChartTypes prop)
// ============================================================================

/**
 * All available chart types.
 */
export const ALL_CHART_TYPES = [
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "line",
  "scatter",
  "pie",
  "donut",
  "metric",
  "gauge",
  "table",
  "heatmap",
  "geomap",
  "sankey",
  "html",
  "markdown",
  "custom_chart",
] as const;

export type ChartType = (typeof ALL_CHART_TYPES)[number];

/**
 * Chart types allowed when query contains SELECT * (logs visualization).
 * These charts can render without aggregation.
 */
export const SELECT_STAR_ALLOWED_CHART_TYPES: ChartType[] = ["table"];

/**
 * Chart types that require aggregation (cannot use SELECT *).
 */
export const AGGREGATION_REQUIRED_CHART_TYPES: ChartType[] = [
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "line",
  "scatter",
  "pie",
  "donut",
  "metric",
  "gauge",
  "heatmap",
  "geomap",
  "sankey",
];
