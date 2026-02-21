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

import { b64EncodeUnicode, b64DecodeUnicode } from "@/utils/zincutils";

export const getVisualizationConfig = (dashboardPanelData: any) => {
  if (!dashboardPanelData?.data) {
    return null;
  }

  // Only store config object and chart type, not the entire dashboardPanelData
  return {
    config: dashboardPanelData.data.config || {},
    type: dashboardPanelData.data.type || "bar",
  };
};

export const encodeVisualizationConfig = (config: any) => {
  try {
    return b64EncodeUnicode(JSON.stringify(config));
  } catch (error) {
    console.error("Failed to encode visualization config:", error);
    return null;
  }
};

export const decodeVisualizationConfig = (encodedConfig: string) => {
  try {
    return JSON.parse(b64DecodeUnicode(encodedConfig) ?? "{}");
  } catch (error) {
    console.error("Failed to decode visualization config:", error);
    return null;
  }
};

// ============================================================================
// Build Page Configuration Helpers
// ============================================================================

/**
 * Extract build configuration from dashboard panel data for URL sharing
 * Includes builder fields, chart type, and config
 */
export const getBuildConfig = (dashboardPanelData: any) => {
  if (!dashboardPanelData?.data) {
    return null;
  }

  const currentQuery = dashboardPanelData.data.queries?.[0];
  if (!currentQuery) {
    return null;
  }

  return {
    config: dashboardPanelData.data.config || {},
    type: dashboardPanelData.data.type || "line",
    fields: {
      stream: currentQuery.fields?.stream || "",
      stream_type: currentQuery.fields?.stream_type || "logs",
      x: currentQuery.fields?.x || [],
      y: currentQuery.fields?.y || [],
      breakdown: currentQuery.fields?.breakdown || [],
      filter: currentQuery.fields?.filter || { filterType: "group", logicalOperator: "AND", conditions: [] },
    },
    joins: currentQuery.joins || [],
    customQuery: currentQuery.customQuery || false,
    query: currentQuery.query || "",
  };
};

/**
 * Encode build configuration for URL
 */
export const encodeBuildConfig = (config: any) => {
  try {
    return b64EncodeUnicode(JSON.stringify(config));
  } catch (error) {
    console.error("Failed to encode build config:", error);
    return null;
  }
};

/**
 * Decode build configuration from URL
 */
export const decodeBuildConfig = (encodedConfig: string) => {
  try {
    return JSON.parse(b64DecodeUnicode(encodedConfig) ?? "{}");
  } catch (error) {
    console.error("Failed to decode build config:", error);
    return null;
  }
};
