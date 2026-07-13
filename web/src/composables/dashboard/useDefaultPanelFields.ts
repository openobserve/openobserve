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
import {
  buildDefaultSqlFields,
  SKIP_SEED_TYPES,
} from "@/utils/dashboard/defaultFields";
import {
  applyPromqlSeed,
  isAutoSeededSlot,
} from "@/utils/dashboard/promqlSeed";

/**
 * Shared default-field seeding for the Add Panel and Metrics pages (both render
 * the same PanelEditor). Seeds the current query based on queryType + stream_type:
 * PromQL -> the metrics rule set's default for the stream (the same query, unit
 * and chart type the Metrics Explorer would chart it with — `sum(rate(...))` for
 * a counter, a heatmap for a histogram, …), falling back to the bare `${stream}{}`
 * when the rule set has nothing better; SQL logs/traces -> count(_timestamp);
 * SQL metrics -> avg(value) if the stream has a "value" column, else
 * count(_timestamp).
 */
const useDefaultPanelFields = (pageKey: string = "dashboard") => {
  const {
    dashboardPanelData,
    updateGroupedFields,
    makeAutoSQLQuery,
    isAddXAxisNotAllowed,
    isAddYAxisNotAllowed,
  } = useDashboardPanelData(pageKey);

  const applyDefaultPanelFields = async () => {
    const idx = dashboardPanelData.layout.currentQueryIndex;
    const query = dashboardPanelData.data.queries[idx];
    if (!query) return;
    if (SKIP_SEED_TYPES.includes(dashboardPanelData.data.type)) return;

    const queryType = dashboardPanelData.data.queryType;
    const stream = query.fields?.stream;
    const streamType = query.fields?.stream_type;

    query.customQuery = false;

    if (queryType === "promql") {
      // Only a slot that still holds what we put there. The Builder toggle comes
      // back through here on a panel the user has been building in, and seeding
      // it again would drop their label filters and operations.
      if (stream && isAutoSeededSlot(dashboardPanelData)) {
        applyPromqlSeed(dashboardPanelData, stream);
      }
      return;
    }

    if (stream) {
      // updateGroupedFields has no catch of its own; swallow so a failed schema
      // load can't reject the toggle/watcher.
      try {
        await updateGroupedFields();
      } catch (e) {
        console.error("useDefaultPanelFields: updateGroupedFields failed", e);
      }
    }

    // hasValueColumn is scoped to `stream`, so a missing/stale schema (incl. join
    // streams) falls back to count(_timestamp).
    const { x, y } = buildDefaultSqlFields(
      streamType,
      dashboardPanelData.meta?.streamFields?.groupedFields ?? [],
      stream,
    );

    // Respect chart-type axis rules: metric/gauge etc. don't allow an x-axis, so
    // only seed x/y where the current chart type permits it (computed from the
    // now-empty field state after removeXYFilters).
    query.fields.x = isAddXAxisNotAllowed.value ? [] : x;
    query.fields.y = isAddYAxisNotAllowed.value ? [] : y;
    query.fields.breakdown = [];
    query.fields.filter = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };

    if (stream) await makeAutoSQLQuery();
  };

  return { applyDefaultPanelFields };
};

export default useDefaultPanelFields;
