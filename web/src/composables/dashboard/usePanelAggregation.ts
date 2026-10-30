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

import { toRaw } from "vue";
import {
  STATE_TIMELINE_Y_FUNCTION,
  buildDefaultBuilderFields,
  keepRawValueFields,
} from "@/utils/dashboard/defaultFields";
import { isCustomSqlPanel, isRowTimeline } from "@/utils/dashboard/chartTypeGroups";
import {
  HOSTMAP_DEFAULT_COLOR,
  HOSTMAP_MAX_GROUP_LEVELS,
} from "@/utils/dashboard/convertHostmapData";
import { TREEMAP_MAX_LEVELS, TREEMAP_SIZE_FUNCTIONS } from "@/utils/dashboard/convertTreemapData";
import { isAdditiveSizeField, SUNBURST_MAX_LEVELS } from "@/utils/dashboard/convertSunburstData";

// Types that reset their own queries on a switch, so no builder state carries into them.
const NON_BUILDER_TYPES = ["html", "markdown", "custom_chart", "alert-list"];

// Starter SQL seeded in this editor session, per query; saved or typed SQL is never a starter, whatever its shape.
const seededStarters = new WeakMap<object, string>();

/** The SQL a new flame graph panel starts from: folded stacks and their summed samples. */
export const defaultFlameGraphPanelQuery = (stream: string): string =>
  stream ? `SELECT stack, sum(samples) AS value FROM "${stream}" GROUP BY stack` : "";

// The SQL each custom-SQL panel type starts from, keyed by panel type.
const STARTER_QUERIES: Record<string, (stream: string, timestampColumn: string) => string> = {
  "flame-graph": (stream) => defaultFlameGraphPanelQuery(stream),
};

/** Records the query's current SQL as the starter it was just seeded with. */
export const markPanelStarterQuery = (query: any) => {
  if (query && typeof query.query === "string") seededStarters.set(toRaw(query), query.query);
};

/** Whether the query still holds exactly the starter SQL it was seeded with. */
export const isPanelStarterQuery = (query: any): boolean =>
  !!query && typeof query.query === "string" && seededStarters.get(toRaw(query)) === query.query;

const BY_SERIES_COLOR_MODES = ["palette-classic-by-series", "palette-classic"];

/** A host map colours cells by value, so a by-series palette left from another type becomes its scale. */
const applyHostmapColorScale = (dashboardPanelData: any) => {
  const config = dashboardPanelData.data.config;
  if (!config) return;
  if (!config.color?.mode || BY_SERIES_COLOR_MODES.includes(config.color.mode)) {
    config.color = { ...HOSTMAP_DEFAULT_COLOR, fixedColor: [...HOSTMAP_DEFAULT_COLOR.fixedColor] };
  }
};

export const usePanelAggregation = ({
  dashboardPanelData,
  getDefaultQueries,
  getDefaultCustomChartText,
  getTimestampColumn = () => "_timestamp",
}: {
  dashboardPanelData: any;
  getDefaultQueries: () => any;
  getDefaultCustomChartText: () => string;
  getTimestampColumn?: () => string;
}) => {
  // Keeps the chosen stream across the reset, as the html and markdown switches do.
  const resetToSingleQuery = () => {
    const current = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
    const stream = current?.fields?.stream;
    const streamType = current?.fields?.stream_type;
    dashboardPanelData.data.queries = getDefaultQueries();
    dashboardPanelData.layout.currentQueryIndex = 0;
    const query = dashboardPanelData.data.queries[0];
    query.fields.stream = stream;
    query.fields.stream_type = streamType;
    query.config.time_shift = [];
    dashboardPanelData.data.htmlContent = "";
    dashboardPanelData.data.markdownContent = "";
    dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
    return query;
  };

  // An untouched starter is not the user's SQL, so a builder chart takes the query back.
  const returnStartersToBuilder = () => {
    dashboardPanelData.data.queries?.forEach((query: any) => {
      if (!query?.customQuery || !isPanelStarterQuery(query)) return;
      query.customQuery = false;
      query.query = "";
      if (query.fields.x.length || query.fields.y.length) return;
      const { x, y } = buildDefaultBuilderFields(
        dashboardPanelData.data.type,
        query.fields.stream_type,
        dashboardPanelData.meta?.streamFields?.groupedFields ?? [],
        query.fields.stream,
        getTimestampColumn(),
      );
      query.fields.x = x;
      query.fields.y = y;
    });
  };

  // A hand-written query survives a switch to a custom-SQL panel; anything else gets that type's starter.
  const seedCustomSqlPanel = () => {
    const current = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
    const typed =
      dashboardPanelData.data.queryType === "sql" &&
      current?.customQuery &&
      (current.query ?? "").trim() !== "" &&
      !isPanelStarterQuery(current)
        ? current.query
        : null;
    const query = resetToSingleQuery();
    query.customQuery = true;
    query.query =
      typed ??
      STARTER_QUERIES[dashboardPanelData.data.type]?.(
        query.fields.stream ?? "",
        getTimestampColumn(),
      ) ??
      "";
    if (!typed) markPanelStarterQuery(query);
    dashboardPanelData.data.queryType = "sql";
    // The builder is hidden for these types, so the SQL editor is where the panel is built.
    dashboardPanelData.layout.showQueryBar = true;
  };

  const resetAggregationFunction = () => {
    // Skip resetting fields for PromQL mode to preserve the query
    if (dashboardPanelData.data.queryType === "promql") {
      // A state timeline has no comparison window; a shift left over from another type must not run.
      if (
        isRowTimeline(dashboardPanelData.data.type) ||
        dashboardPanelData.data.type === "hostmap"
      ) {
        dashboardPanelData.data.queries?.forEach((query: any) => (query.config.time_shift = []));
      }
      if (dashboardPanelData.data.type === "hostmap") applyHostmapColorScale(dashboardPanelData);
      return;
    }

    const type = dashboardPanelData.data.type;
    if (!isCustomSqlPanel(type) && !NON_BUILDER_TYPES.includes(type)) returnStartersToBuilder();

    switch (type) {
      case "distribution":
        // A histogram buckets raw values, so every y field drops its aggregation and nothing is grouped by x.
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.isDerived) return;
            itemY.functionName = null;
            itemY.args = itemY?.args?.length ? [itemY?.args?.[0]] : [];
            // A HAVING on a raw, ungrouped column is invalid SQL, and the editor hides it for this type.
            itemY.havingConditions = [];
          });
          keepRawValueFields(
            query,
            dashboardPanelData.meta?.streamFields?.groupedFields ?? [],
            getTimestampColumn(),
          );
          query.fields.x = [];
          query.fields.z = [];
          query.fields.breakdown = query.fields.breakdown.slice(0, 1);
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
          query.config.time_shift = [];
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        break;

      case "hostmap":
        dashboardPanelData.data.queries?.forEach((query: any) => {
          // A time bucket cannot name a cell, so only a plain field stays as the entity.
          query.fields.x = query.fields.x
            .filter((itemX: any) => itemX.functionName !== "histogram")
            .slice(0, 1);
          query.fields.y = query.fields.y.slice(0, 1);
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.breakdown = (query.fields.breakdown ?? []).slice(
            0,
            HOSTMAP_MAX_GROUP_LEVELS,
          );
          query.fields.z = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
          query.config.time_shift = [];
        });
        applyHostmapColorScale(dashboardPanelData);
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        break;

      case "heatmap":
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            itemY.functionName = null;
            // take first arg
            itemY.args = itemY?.args?.length ? [itemY?.args?.[0]] : [];
          });
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;

      case "area":
      case "area-stacked":
      case "bar":
      case "line":
      case "scatter":
      case "h-bar":
      case "stacked":
      case "h-stacked":
      case "state-timeline":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          const isStateTimeline = dashboardPanelData.data.type === "state-timeline";
          const isRowChart = isRowTimeline(dashboardPanelData.data.type);
          // A count is never a state and the timeline reads one field, so only the first other y stays.
          if (isStateTimeline) {
            query.fields.y = query.fields.y
              .filter((itemY: any) => itemY.functionName !== "count")
              .slice(0, 1);
          }
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = isStateTimeline ? STATE_TIMELINE_Y_FUNCTION : "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            // if breakdown is empty, then take 2nd x axis field on breakdown and remove all other x axis
            if (query.fields.breakdown.length === 0) {
              query.fields.breakdown = [query.fields.x[1]];
              query.fields.x = [query.fields.x[0]];
            } else {
              query.fields.x = [query.fields.x[0]];
            }
          }
          // A state timeline has no comparison window; a shift left over from another type must not run.
          if (isRowChart) query.config.time_shift = [];
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        break;
      case "table":
        // Keep breakdown fields — they are used for pivot table mode
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "pie":
      case "donut":
      case "gauge":
      case "bar-gauge":
      case "funnel":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "treemap":
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (!itemY.isDerived && !TREEMAP_SIZE_FUNCTIONS.includes(itemY.functionName)) {
              itemY.functionName = "count";
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.x = query.fields.x.slice(0, TREEMAP_MAX_LEVELS);
          query.fields.y = query.fields.y.slice(0, 1);
          query.fields.z = [];
          query.fields.breakdown = query.fields.breakdown.slice(
            0,
            Math.min(1, TREEMAP_MAX_LEVELS - query.fields.x.length),
          );
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
          query.config.time_shift = [];
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        break;
      case "sunburst":
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if ((itemY.functionName === null && !itemY.isDerived) || !isAdditiveSizeField(itemY)) {
              itemY.functionName = "count";
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          // Each x field is a ring, so keep them up to the cap, leaving room for one breakdown ring.
          query.fields.x = query.fields.x.slice(0, SUNBURST_MAX_LEVELS);
          query.fields.y = query.fields.y.slice(0, 1);
          query.fields.z = [];
          query.fields.breakdown = query.fields.breakdown.slice(
            0,
            Math.min(1, SUNBURST_MAX_LEVELS - query.fields.x.length),
          );
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
          query.config.time_shift = [];
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        break;
      case "metric":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // remove all x axis fields
          query.fields.x = [];
          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "geomap":
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();

        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.limit =
          0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "html": {
        // Preserve current stream and stream_type before resetting
        const htmlCurrentStream =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream;
        const htmlCurrentStreamType =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();
        // These chart types reset to a single default query, so the active
        // query index must return to the first query — otherwise a previously
        // selected non-zero tab (multi-query layout) now points past the end of
        // the queries array and downstream reads of queries[currentQueryIndex]
        // would crash.
        dashboardPanelData.layout.currentQueryIndex = 0;

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream =
          htmlCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = htmlCurrentStreamType;

        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      }
      case "markdown": {
        // Preserve current stream and stream_type before resetting
        const markdownCurrentStream =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream;
        const markdownCurrentStreamType =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();
        // These chart types reset to a single default query, so the active
        // query index must return to the first query — otherwise a previously
        // selected non-zero tab (multi-query layout) now points past the end of
        // the queries array and downstream reads of queries[currentQueryIndex]
        // would crash.
        dashboardPanelData.layout.currentQueryIndex = 0;

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream =
          markdownCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = markdownCurrentStreamType;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();

        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      }
      case "alert-list": {
        // The alert list reads the alerts API, so the panel keeps one empty query.
        resetToSingleQuery();
        dashboardPanelData.data.queryType = "";
        break;
      }
      case "custom_chart": {
        // Preserve current stream and stream_type before resetting
        const customChartCurrentStream =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream;
        const customChartCurrentStreamType =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();
        // These chart types reset to a single default query, so the active
        // query index must return to the first query — otherwise a previously
        // selected non-zero tab (multi-query layout) now points past the end of
        // the queries array and downstream reads of queries[currentQueryIndex]
        // would crash.
        dashboardPanelData.layout.currentQueryIndex = 0;

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream =
          customChartCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = customChartCurrentStreamType;

        // Custom charts always use a hand-written (custom) query — the default
        // query from getDefaultQueries() is in builder mode, which would leave
        // the query editor read-only. Switch it to custom mode.
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery =
          true;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      }
      case "maps":
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        break;
      case "sankey":
      case "node-graph":
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter =
          {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          };
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent = getDefaultCustomChartText();
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.limit =
          0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      default:
        // Custom-SQL panels read raw rows of a hand-written query the builder cannot express.
        if (isCustomSqlPanel(type)) seedCustomSqlPanel();
        break;
    }

    // aggregation null then count
  };

  return {
    resetAggregationFunction,
  };
};
