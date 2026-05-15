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

export const usePanelFields = ({
  dashboardPanelData,
  store,
  pageKey = "dashboard",
}: {
  dashboardPanelData: any;
  store: any;
  pageKey?: string;
}) => {
  const promqlMode = computed(
    () => dashboardPanelData.data.queryType == "promql",
  );

  const generateLabelFromName = (name: string) => {
    return name
      .replace(/[\_\-\s\.]/g, " ")
      .split(" ")
      .map((string) => string.charAt(0).toUpperCase() + string.slice(1))
      .filter((it) => it)
      .join(" ");
  };

  const isPivotMode = computed(() => {
    if (dashboardPanelData.data.type !== "table") return false;
    const currentQuery =
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ];
    return (
      (currentQuery?.fields?.breakdown?.length ?? 0) > 0 &&
      (currentQuery?.fields?.y?.length ?? 0) > 0 &&
      (currentQuery?.fields?.x?.length ?? 0) > 0
    );
  });

  const isAddXAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "pie":
      case "donut":
      case "heatmap":
      case "gauge":
      case "area":
      case "bar":
      case "h-bar":
      case "line":
      case "scatter":
      case "area-stacked":
      case "stacked":
      case "h-stacked":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 1
        );
      case "metric":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 0
        );
      case "table":
        return false;
      default:
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 2
        );
    }
  });

  const isAddBreakdownNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "area":
      case "bar":
      case "h-bar":
      case "line":
      case "scatter":
      case "area-stacked":
      case "stacked":
      case "h-stacked":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.breakdown?.length >= 1
        );
      case "table":
        // Allow up to 3 breakdown fields for table charts
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.breakdown?.length >= 3
        );
    }
  });

  const isAddYAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "pie":
      case "donut":
      case "gauge":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "metric":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "area-stacked":
      case "heatmap":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      default:
        return false;
    }
  });

  const isAddZAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "heatmap":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.z.length >= 1
        );
      default:
        return false;
    }
  });

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
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x = [];
    }

    if (isAddXAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.x.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "x_axis_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.x.length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? "histogram"
          : null,
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
      treatAsNonTimestamp:
        row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson:
        pageKey === "logs"
          ? (store?.state?.zoConfig?.dashboard_show_field_as_json_enabled ?? false)
          : false,
    });

    updateArrayAlias();
  };

  const addBreakDownAxisItem = (row: {
    name: string;
    streamAlias?: string;
  }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown
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
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "breakdown_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.breakdown.length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? "histogram"
          : null,
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

  const addYAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y = [];
    }

    if (isAddYAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.y.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "y_axis_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.y.length +
              1)
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName:
        dashboardPanelData.data.type == "heatmap" || isDerived ? null : "count",
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
      treatAsNonTimestamp:
        row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson:
        pageKey === "logs"
          ? (store?.state?.zoConfig?.dashboard_show_field_as_json_enabled ?? false)
          : false,
    });
    updateArrayAlias();
  };

  const addZAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z = [];
    }

    if (isAddZAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.z.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "z_axis_" +
            ((dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.z?.length ?? 0) +
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.latitude = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.longitude = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.weight = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.name = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.source = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.target = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.x?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "x_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.y?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "y_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.z?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "z_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.breakdown?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "breakdown_" + (index + 1)
            : it?.alias),
    );
  };

  const removeXAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x.splice(index, 1);
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
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y.splice(index, 1);
    }
  };

  const removeZAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.splice(index, 1);
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
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.latitude = null;
  };

  const removeLongitude = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.longitude = null;
  };

  const removeWeight = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.weight = null;
  };

  const removeMapName = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.name = null;
  };

  const removeMapValue = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value_for_maps = null;
  };

  const removeSource = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.source = null;
  };

  const removeTarget = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.target = null;
  };

  const removeValue = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value = null;
  };

  const removeXYFilters = () => {
    if (
      promqlMode.value ||
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery == false
    ) {
      dashboardPanelData.meta.stream.customQueryFields = [];
      dashboardPanelData.meta.stream.vrlFunctionFieldList = [];
      // Also clear per-query field cache in meta
      const currentIdx = dashboardPanelData.layout.currentQueryIndex;
      if (dashboardPanelData.meta.queryFields[currentIdx]) {
        dashboardPanelData.meta.queryFields[currentIdx].customQueryFields = [];
        dashboardPanelData.meta.queryFields[currentIdx].vrlFunctionFieldList =
          [];
      }
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.breakdown?.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.breakdown?.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.filter.conditions.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter.conditions.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.latitude = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.longitude = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.weight = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.name = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.value_for_maps = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.source = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.target = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.value = null;
    }
  };

  const resetFields = () => {
    // Preserve stream name and type across field resets — these identify
    // which stream the query targets and should not change when chart type
    // or field layout changes.
    const currentFields =
      dashboardPanelData?.data?.queries?.[
        dashboardPanelData?.layout?.currentQueryIndex
      ]?.fields;
    const preservedStream = currentFields?.stream ?? "";
    const preservedStreamType = currentFields?.stream_type ?? "logs";

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields = {
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

  const setFieldsBasedOnChartTypeValidation = (
    fields: any,
    chartType: string,
  ) => {
    // First reset all existing fields in dashboardPanelData
    resetFields();

    // Keep breakdown fields for table — they are used for pivot table mode
    const fieldsToProcess = { ...fields };

    // The add functions will automatically apply validation based on current chart type
    // Add X-axis fields
    fieldsToProcess.x?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addXAxisItem({ name: fieldName });
      }
    });

    // Add Y-axis fields
    fieldsToProcess.y?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addYAxisItem({ name: fieldName });
      }
    });

    // Add Z-axis fields
    fieldsToProcess.z?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addZAxisItem({ name: fieldName });
      }
    });

    // Add breakdown fields
    fieldsToProcess.breakdown?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
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
