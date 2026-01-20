import { computed } from "vue";
import { generateLabelFromName } from "@/utils/dashboard/textUtils";

export const usePanelAxes = (store: any, dashboardPanelData: any) => {
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

    const checkIsDerivedField = (fieldName: string) => {
        // if given fieldName is from vrlFunctionFields, then it is a derived field
        return !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
            (vrlField: any) => vrlField.name == fieldName,
        );
    };

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
            showFieldAsJson: false,
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
            showFieldAsJson: false,
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

    return {
        isAddXAxisNotAllowed,
        isAddBreakdownNotAllowed,
        isAddYAxisNotAllowed,
        isAddZAxisNotAllowed,
        addXAxisItem,
        addBreakDownAxisItem,
        addYAxisItem,
        addZAxisItem,
        addLatitude,
        addLongitude,
        addWeight,
        addMapName,
        addMapValue,
        addSource,
        addTarget,
        addValue,
        removeXAxisItemByIndex,
        removeBreakdownItemByIndex,
        removeYAxisItemByIndex,
        removeZAxisItemByIndex,
        removeLatitude,
        removeLongitude,
        removeWeight,
        removeMapName,
        removeMapValue,
        removeSource,
        removeTarget,
        removeValue,
        removeFilterItem,
    };
};
