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

// ============================================================================
// Component Export
// ============================================================================

export { default as PanelEditor } from "./PanelEditor.vue";

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Page type
  PanelEditorPageType,

  // Props and configuration
  PanelEditorProps,
  PanelEditorConfig,

  // Events
  PanelEditorEmits,

  // Exposed interface
  PanelEditorExpose,

  // Data types
  PanelEditorDateTime,
  PanelEditorVariablesData,
  PanelEditorErrorData,
  PanelEditorSearchResponse,
  PanelEditorChartData,
  PanelEditorDashboardData,

  // Chart types
  ChartType,
} from "./types/panelEditor";

// ============================================================================
// Constant Exports
// ============================================================================

export {
  // Preset configurations
  DASHBOARD_PRESET,
  METRICS_PRESET,
  LOGS_PRESET,
  BUILD_PRESET,

  // Functions
  getPresetByPageType,
  resolveConfig,

  // Chart type constants
  ALL_CHART_TYPES,
  SELECT_STAR_ALLOWED_CHART_TYPES,
  AGGREGATION_REQUIRED_CHART_TYPES,
} from "./types/panelEditor";

// ============================================================================
// Composable Export
// ============================================================================

export { usePanelEditor } from "./composables/usePanelEditor";
export type { UsePanelEditorOptions } from "./composables/usePanelEditor";
