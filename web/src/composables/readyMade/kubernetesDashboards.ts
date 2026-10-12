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

import { getReadyMadeSource, readyMadeMarker } from "./catalog";

const placeholder = (title: string, role: string): Record<string, any> => ({
  version: 8,
  dashboardId: "",
  title,
  description: "",
  role,
  owner: "",
  created: new Date().toISOString(),
  tabs: [
    {
      tabId: "default",
      name: "Overview",
      panels: [
        {
          id: "Panel_ID1000001",
          type: "markdown",
          title: "Placeholder",
          description: "",
          config: { show_legends: false, legends_position: null, decimals: 2 },
          queryType: "sql",
          queries: [
            {
              query: "",
              vrlFunctionQuery: "",
              customQuery: false,
              fields: {
                stream: "",
                stream_type: "logs",
                x: [],
                y: [],
                z: [],
                filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
              },
              config: {
                promql_legend: "",
                layer_type: "scatter",
                weight_fixed: 1,
                limit: 0,
                min: 0,
                max: 100,
              },
            },
          ],
          layout: { x: 0, y: 0, w: 192, h: 8, i: 1 },
          htmlContent: "",
          markdownContent: "Placeholder",
        },
      ],
    },
  ],
  variables: { list: [], showDynamicFilters: true },
  defaultDatetimeDuration: {
    type: "relative",
    relativeTimePeriod: "15m",
    startTime: 0,
    endTime: 0,
  },
});

/** The 4 Kubernetes dashboards, rendered for this org, in the catalog's order. */
export async function buildKubernetesDashboards(_orgId: string): Promise<Record<string, any>[]> {
  return getReadyMadeSource("kubernetes").dashboards.map((ref) =>
    placeholder(ref.title, readyMadeMarker("kubernetes", ref.key)),
  );
}
