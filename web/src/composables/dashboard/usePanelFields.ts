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

import { computed } from "vue";
import { generateLabelFromName } from "@/utils/dashboard/fieldLabel";
import { STATE_TIMELINE_Y_FUNCTION } from "@/utils/dashboard/defaultFields";
import { isRawValueChart, isRowTimeline } from "@/utils/dashboard/chartTypeGroups";
import {
  HOSTMAP_MAX_GROUP_LEVELS,
  HOSTMAP_NUMERIC_Y_FUNCTION,
} from "@/utils/dashboard/convertHostmapData";
import { isNumericYField } from "@/utils/dashboard/heatmapYAxis";
import { TREEMAP_MAX_LEVELS } from "@/utils/dashboard/convertTreemapData";
import { SUNBURST_MAX_LEVELS } from "@/utils/dashboard/convertSunburstData";

const colors = [
  "#5960b2",
  "#c23531",
  "#2f4554",
  "#61a0a8",
  "#d48265",
  "#91c7ae",
  "#749f83",
  "#ca8622",
  "#bda29a",
  "#6e7074",
  "#546570",
  "#c4ccd3",
];

export type PanelAxis = "x" | "y" | "z" | "breakdown";

export type AxisFields = Partial<Record<PanelAxis, unknown[] | undefined>>;

/** One cap on an axis: the axis is full once `count` reaches `max`; a `max` of 0 means the chart never takes it. */
export interface AxisLimit {
  count: number;
  max: number;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

const ONE_X_CHARTS = new Set([
  "pie",
  "donut",
  "heatmap",
  "gauge",
  "bar-gauge",
  "state-timeline",
  "funnel",
  "boxplot",
  "hostmap",
  "area",
  "bar",
  "h-bar",
  "line",
  "scatter",
  "area-stacked",
  "stacked",
  "h-stacked",
]);

const NO_X_CHARTS = new Set([
  "metric",
  "distribution",
  "node-graph",
  "alert-list",
  "flame-graph",
  "logs",
]);

const ONE_BREAKDOWN_CHARTS = new Set([
  "area",
  "bar",
  "h-bar",
  "line",
  "scatter",
  "area-stacked",
  "stacked",
  "h-stacked",
  "state-timeline",
  "distribution",
]);

const NO_BREAKDOWN_CHARTS = new Set([
  "funnel",
  "node-graph",
  "alert-list",
  "flame-graph",
  "boxplot",
  "logs",
]);

const ONE_Y_CHARTS = new Set([
  "pie",
  "donut",
  "gauge",
  "bar-gauge",
  "treemap",
  "sunburst",
  "funnel",
  "boxplot",
  "metric",
  "area-stacked",
  "heatmap",
  "state-timeline",
  "hostmap",
]);

const NO_Y_CHARTS = new Set(["node-graph", "alert-list", "flame-graph", "logs"]);

// Treemap groups and sunburst rings are fed by x and breakdown together, so their level cap counts both.
const levelCount = (fields: AxisFields) =>
  (fields.x?.length ?? 0) + (fields.breakdown?.length ?? 0);

function xLimits(chartType: string, fields: AxisFields): AxisLimit[] {
  const count = fields.x?.length ?? 0;
  if (ONE_X_CHARTS.has(chartType)) return [{ count, max: 1 }];
  if (NO_X_CHARTS.has(chartType)) return [{ count, max: 0 }];
  if (chartType === "sunburst") return [{ count: levelCount(fields), max: SUNBURST_MAX_LEVELS }];
  if (chartType === "treemap") return [{ count: levelCount(fields), max: TREEMAP_MAX_LEVELS }];
  if (chartType === "table") return [{ count, max: UNLIMITED }];
  return [{ count, max: 2 }];
}

function breakdownLimits(chartType: string, fields: AxisFields): AxisLimit[] {
  const count = fields.breakdown?.length ?? 0;
  if (ONE_BREAKDOWN_CHARTS.has(chartType)) return [{ count, max: 1 }];
  if (NO_BREAKDOWN_CHARTS.has(chartType)) return [{ count, max: 0 }];
  if (chartType === "treemap") {
    return [
      { count, max: 1 },
      { count: levelCount(fields), max: TREEMAP_MAX_LEVELS },
    ];
  }
  if (chartType === "sunburst") {
    return [
      { count, max: 1 },
      { count: levelCount(fields), max: SUNBURST_MAX_LEVELS },
    ];
  }
  if (chartType === "hostmap") return [{ count, max: HOSTMAP_MAX_GROUP_LEVELS }];
  if (chartType === "table") return [{ count, max: 3 }];
  return [{ count, max: UNLIMITED }];
}

function yLimits(chartType: string, fields: AxisFields): AxisLimit[] {
  const count = fields.y?.length ?? 0;
  if (ONE_Y_CHARTS.has(chartType)) return [{ count, max: 1 }];
  if (NO_Y_CHARTS.has(chartType)) return [{ count, max: 0 }];
  return [{ count, max: UNLIMITED }];
}

function zLimits(chartType: string, fields: AxisFields): AxisLimit[] {
  const count = fields.z?.length ?? 0;
  return [{ count, max: chartType === "heatmap" ? 1 : UNLIMITED }];
}

/** The caps a chart type puts on one axis of the current query; the add guards and the chip reasons both read them. */
export function axisLimits(chartType: string, axis: PanelAxis, fields: AxisFields): AxisLimit[] {
  if (axis === "x") return xLimits(chartType, fields);
  if (axis === "breakdown") return breakdownLimits(chartType, fields);
  if (axis === "y") return yLimits(chartType, fields);
  return zLimits(chartType, fields);
}

export const isAxisFull = (limits: AxisLimit[]) => limits.some(({ count, max }) => count >= max);

export const isAxisUnsupported = (limits: AxisLimit[]) => limits.some(({ max }) => max === 0);

export const usePanelFields = ({
  dashboardPanelData,
  store,
  pageKey = "dashboard",
}: {
  dashboardPanelData: any;
  store: any;
  pageKey?: string;
}) => {
  const promqlMode = computed(() => dashboardPanelData.data.queryType == "promql");

  const isPivotMode = computed(() => {
    if (dashboardPanelData.data.type !== "table") return false;
    const currentQuery =
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
    return (
      (currentQuery?.fields?.breakdown?.length ?? 0) > 0 &&
      (currentQuery?.fields?.y?.length ?? 0) > 0 &&
      (currentQuery?.fields?.x?.length ?? 0) > 0
    );
  });

  const currentFields = (): AxisFields =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields ?? {};
  const limitsOf = (axis: PanelAxis) =>
    axisLimits(dashboardPanelData.data.type, axis, currentFields());

  const isAddXAxisNotAllowed = computed(() => isAxisFull(limitsOf("x")));
  const isAddBreakdownNotAllowed = computed(() => isAxisFull(limitsOf("breakdown")));
  const isAddYAxisNotAllowed = computed(() => isAxisFull(limitsOf("y")));
  const isAddZAxisNotAllowed = computed(() => isAxisFull(limitsOf("z")));

  const unsupportedAxes = computed<Record<PanelAxis, boolean>>(() => ({
    x: isAxisUnsupported(limitsOf("x")),
    y: isAxisUnsupported(limitsOf("y")),
    z: isAxisUnsupported(limitsOf("z")),
    breakdown: isAxisUnsupported(limitsOf("breakdown")),
  }));

  const checkIsDerivedField = (fieldName: string) => {
    // if given fieldName is from vrlFunctionFields, then it is a derived field
    return !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
      (vrlField: any) => vrlField.name == fieldName,
    );
  };

  // get new color value based on existing color from the chart
  const getNewColorValue = () => {
    const YAxisColor = dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.y.map((it: any) => it?.color);
    let newColor = colors.filter((el: any) => !YAxisColor.includes(el));
    if (!newColor.length) {
      newColor = colors;
    }
    return newColor[0];
  };

  const addXAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x = [];
    }

    if (isAddXAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.push({
      label: "",
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "x_axis_" +
            (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x
              .length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived ? "histogram" : null,
      args:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
              {
                type: "histogramInterval",
                value: null,
              },
            ]
          : [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
            ],
      sortBy:
        row.name == store.state.zoConfig.timestamp_column
          ? dashboardPanelData.data.type == "table"
            ? "DESC"
            : "ASC"
          : null,
      isDerived,
      havingConditions: [],
      treatAsNonTimestamp: row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson:
        pageKey === "logs"
          ? (store?.state?.zoConfig?.dashboard_show_field_as_json_enabled ?? false)
          : false,
    });

    updateArrayAlias();
  };

  const addBreakDownAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.breakdown
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown = [];
    }

    if (isAddBreakdownNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.breakdown.push({
      label: "",
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "breakdown_" +
            (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              .breakdown.length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived ? "histogram" : null,
      args:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
              {
                type: "histogramInterval",
                value: null,
              },
            ]
          : [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
            ],
      sortBy:
        row.name == store.state.zoConfig.timestamp_column
          ? dashboardPanelData.data.type == "table"
            ? "DESC"
            : "ASC"
          : null,
      isDerived,
      havingConditions: [],
    });

    updateArrayAlias();
  };

  const isNumericStreamField = (row: { name: string; streamAlias?: string }) =>
    isNumericYField(
      { args: [{ type: "field", value: { field: row.name, streamAlias: row.streamAlias } }] },
      dashboardPanelData,
    );

  const addYAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y = [];
    }

    if (isAddYAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.push({
      label: "",
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "y_axis_" +
            (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y
              .length +
              1)
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName:
        dashboardPanelData.data.type == "heatmap" ||
        dashboardPanelData.data.type == "boxplot" ||
        isRawValueChart(dashboardPanelData.data.type) ||
        isDerived
          ? null
          : isRowTimeline(dashboardPanelData.data.type)
            ? STATE_TIMELINE_Y_FUNCTION
            : dashboardPanelData.data.type == "hostmap" && isNumericStreamField(row)
              ? HOSTMAP_NUMERIC_Y_FUNCTION
              : "count",
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
      treatAsNonTimestamp: row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson:
        pageKey === "logs"
          ? (store?.state?.zoConfig?.dashboard_show_field_as_json_enabled ?? false)
          : false,
    });
    updateArrayAlias();
  };

  const addZAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z = [];
    }

    if (isAddZAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z.push({
      label: "",
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "z_axis_" +
            ((dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.z
              ?.length ?? 0) +
              1)
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "count",
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    });
    updateArrayAlias();
  };

  const addLatitude = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.latitude = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "latitude"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addLongitude = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.longitude =
      {
        label: generateLabelFromName(row.name),
        alias:
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && !isDerived
            ? "longitude"
            : row.name,
        // column: row.name,
        color: getNewColorValue(),
        type: "build",
        functionName: null, // You can set the appropriate aggregation function here
        args: [
          {
            type: "field",
            value: {
              field: row.name,
              streamAlias: row.streamAlias,
            },
          },
        ],
        isDerived,
        havingConditions: [],
      };
  };

  const addWeight = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "weight"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "count", // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addMapName = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.name = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "name"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      havingConditions: [],
    };
  };

  const addMapValue = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value_for_maps = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "value_for_maps"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: "count", // You can set the appropriate aggregation function here
      havingConditions: [],
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
    };
  };

  const addSource = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.source = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "source"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addTarget = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.target = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "target"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addValue = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.value = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery &&
        !isDerived
          ? "value"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "sum", // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  // update X or Y axis aliases when new value pushes into the X and Y axes arrays
  const updateArrayAlias = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.x?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && !it.isDerived
            ? "x_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.y?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && !it.isDerived
            ? "y_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.z?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && !it.isDerived
            ? "z_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.breakdown?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && !it.isDerived
            ? "breakdown_" + (index + 1)
            : it?.alias),
    );
  };

  const removeXAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.splice(
        index,
        1,
      );
    }
  };

  const removeBreakdownItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown.splice(index, 1);
    }
  };

  const removeYAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.splice(
        index,
        1,
      );
    }
  };

  const removeZAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z.splice(
        index,
        1,
      );
    }
  };

  const removeFilterItem = (name: string) => {
    const index = dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.filter.conditions.findIndex((it: any) => it.column == name);
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.filter.conditions.splice(index, 1);
    }
  };

  const removeLatitude = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.latitude =
      null;
  };

  const removeLongitude = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.longitude =
      null;
  };

  const removeWeight = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight =
      null;
  };

  const removeMapName = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.name = null;
  };

  const removeMapValue = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value_for_maps = null;
  };

  const removeSource = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.source =
      null;
  };

  const removeTarget = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.target =
      null;
  };

  const removeValue = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.value =
      null;
  };

  const removeXYFilters = () => {
    if (
      promqlMode.value ||
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ==
        false
    ) {
      dashboardPanelData.meta.stream.customQueryFields = [];
      dashboardPanelData.meta.stream.vrlFunctionFieldList = [];
      // Also clear per-query field cache in meta
      const currentIdx = dashboardPanelData.layout.currentQueryIndex;
      if (dashboardPanelData.meta.queryFields[currentIdx]) {
        dashboardPanelData.meta.queryFields[currentIdx].customQueryFields = [];
        dashboardPanelData.meta.queryFields[currentIdx].vrlFunctionFieldList = [];
      }
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.splice(
        0,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x
          .length,
      );
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.splice(
        0,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y
          .length,
      );
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z.splice(
        0,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z
          .length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.breakdown?.splice(
        0,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
          ?.breakdown?.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.filter.conditions.splice(
        0,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter
          .conditions.length,
      );
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.latitude =
        null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.longitude = null;
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight =
        null;
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.name =
        null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.value_for_maps = null;
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.source =
        null;
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.target =
        null;
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.value =
        null;
    }
  };

  const resetFields = () => {
    // Preserve stream name and type across field resets — these identify
    // which stream the query targets and should not change when chart type
    // or field layout changes.
    const currentFields =
      dashboardPanelData?.data?.queries?.[dashboardPanelData?.layout?.currentQueryIndex]?.fields;
    const preservedStream = currentFields?.stream ?? "";
    const preservedStreamType = currentFields?.stream_type ?? "logs";

    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields = {
      stream: preservedStream,
      stream_type: preservedStreamType,
      x: [],
      y: [],
      z: [],
      breakdown: [],
      filter: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      },
      latitude: null,
      longitude: null,
      weight: null,
      name: null,
      value_for_maps: null,
      source: null,
      target: null,
      value: null,
    };
  };

  const setFieldsBasedOnChartTypeValidation = (fields: any, _chartType: string) => {
    // First reset all existing fields in dashboardPanelData
    resetFields();

    // Keep breakdown fields for table — they are used for pivot table mode
    const fieldsToProcess = { ...fields };

    // The add functions will automatically apply validation based on current chart type
    // Add X-axis fields
    fieldsToProcess.x?.forEach((field: any) => {
      const fieldName = typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addXAxisItem({ name: fieldName });
      }
    });

    // Add Y-axis fields
    fieldsToProcess.y?.forEach((field: any) => {
      const fieldName = typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addYAxisItem({ name: fieldName });
      }
    });

    // Add Z-axis fields
    fieldsToProcess.z?.forEach((field: any) => {
      const fieldName = typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addZAxisItem({ name: fieldName });
      }
    });

    // Add breakdown fields
    fieldsToProcess.breakdown?.forEach((field: any) => {
      const fieldName = typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addBreakDownAxisItem({ name: fieldName });
      }
    });
  };

  return {
    promqlMode,
    isAddXAxisNotAllowed,
    isAddBreakdownNotAllowed,
    isAddYAxisNotAllowed,
    isAddZAxisNotAllowed,
    unsupportedAxes,
    generateLabelFromName,
    checkIsDerivedField,
    getNewColorValue,
    updateArrayAlias,
    addXAxisItem,
    addYAxisItem,
    addZAxisItem,
    addBreakDownAxisItem,
    addLatitude,
    addLongitude,
    addWeight,
    addMapName,
    addMapValue,
    addSource,
    addTarget,
    addValue,
    removeXAxisItemByIndex,
    removeYAxisItemByIndex,
    removeZAxisItemByIndex,
    removeBreakdownItemByIndex,
    removeFilterItem,
    removeLatitude,
    removeLongitude,
    removeWeight,
    removeMapName,
    removeMapValue,
    removeSource,
    removeTarget,
    removeValue,
    resetFields,
    removeXYFilters,
    setFieldsBasedOnChartTypeValidation,
    isPivotMode,
  };
};
