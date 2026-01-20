/**
 * Returns the props object based on the given chart type.
 *
 * @param {string} type - The chart type.
 * @return {object} The props object for the given chart type.
 */
export const getPropsByChartTypeForSeries = (type: string) => {
    switch (type) {
        case "bar":
            return {
                type: "bar",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "line":
            return {
                type: "line",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "scatter":
            return {
                type: "scatter",
                emphasis: { focus: "series" },
                symbolSize: 5,
            };
        case "pie":
            return {
                type: "pie",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "donut":
            return {
                type: "pie",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "h-bar":
            return {
                type: "bar",
                orientation: "h",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "area":
            return {
                type: "line",
                emphasis: { focus: "series" },
                areaStyle: {},
                lineStyle: { width: 1.5 },
            };
        case "stacked":
            return {
                type: "bar",
                emphasis: { focus: "series" },
                lineStyle: { width: 1.5 },
            };
        case "area-stacked":
            return {
                type: "line",
                stack: "Total",
                areaStyle: {},
                emphasis: {
                    focus: "series",
                },
                lineStyle: { width: 1.5 },
            };
        case "gauge":
            return {
                type: "gauge",
                startAngle: 205,
                endAngle: -25,
                pointer: {
                    show: false,
                },
                axisTick: {
                    show: false,
                },
                splitLine: {
                    show: false,
                },
                axisLabel: {
                    show: false,
                },
            };
        case "metric":
            return {
                type: "custom",
                coordinateSystem: "polar",
            };
        case "h-stacked":
            return {
                type: "bar",
                emphasis: { focus: "series" },
                orientation: "h",
                lineStyle: { width: 1.5 },
            };
        default:
            return {
                type: "bar",
            };
    }
};
