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

import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { buildDefaultSqlFields } from "@/utils/dashboard/defaultFields";

// Chart types that drive their own builder (latitude/longitude, source/target,
// raw HTML/markdown, custom charts) and must NOT receive the cartesian x/y seed.
const SKIP_SEED_TYPES = [
  "geomap",
  "sankey",
  "maps",
  "custom_chart",
  "html",
  "markdown",
];

/**
 * Centralized, page-aware default-field seeding shared by the Add Panel page and
 * the Metrics page (both render the same PanelEditor). Replaces the metrics-only
 * `applyMetricsDefaults` logic that used to live in plugins/metrics/Index.vue.
 *
 * Seeds the current query's builder fields based on queryType + stream_type:
 *  - PromQL                -> default builder query `${stream}{}`
 *  - SQL, logs / traces    -> x = histogram(_timestamp), y = count(_timestamp)
 *  - SQL, metrics          -> x = histogram(_timestamp),
 *                             y = avg(value) if the stream has a "value" column,
 *                                 else count(_timestamp)
 */
const useDefaultPanelFields = (pageKey: string = "dashboard") => {
  const { dashboardPanelData, updateGroupedFields, makeAutoSQLQuery } =
    useDashboardPanelData(pageKey);

  const applyDefaultPanelFields = async () => {
    const idx = dashboardPanelData.layout.currentQueryIndex;
    const query = dashboardPanelData.data.queries[idx];
    if (!query) return;

    // Leave non-cartesian / custom chart builders untouched.
    if (SKIP_SEED_TYPES.includes(dashboardPanelData.data.type)) return;

    const queryType = dashboardPanelData.data.queryType;
    const stream = query.fields?.stream;
    const streamType = query.fields?.stream_type;

    // Defaults only apply in builder mode.
    query.customQuery = false;

    if (queryType === "promql") {
      // PromQL builder default: an empty selector for the chosen metric stream.
      if (stream) {
        query.query = `${stream}{}`;
      }
      return;
    }

    // SQL builder: load the stream schema first so the metrics value-column
    // heuristic can be evaluated, then seed x/y and regenerate the query.
    if (stream) {
      await updateGroupedFields();
    }

    const groupedFields =
      dashboardPanelData.meta?.streamFields?.groupedFields ?? [];
    const { x, y } = buildDefaultSqlFields(streamType, groupedFields);

    query.fields.x = x;
    query.fields.y = y;
    query.fields.breakdown = [];
    query.fields.filter = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };

    if (stream) {
      await makeAutoSQLQuery();
    }
  };

  return { applyDefaultPanelFields };
};

export default useDefaultPanelFields;
