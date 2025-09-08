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
