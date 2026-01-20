import { getDataValue } from "../aliasUtils";

export const processData = (
    data: any[],
    panelSchema: any,
    maxDashboardSeries: number = 100,
    yAxisKeys: string[],
    breakDownKeys: string[],
    xAxisKeys: string[]
): any[] => {
    if (!data.length || !Array.isArray(data[0])) {
        return [];
    }

    const extras: any = {};
    const { top_results, top_results_others } = panelSchema.config;

    // get the limit series from the config
    // if top_results is enabled then use the top_results value
    // otherwise use the max_dashboard_series value
    let limitSeries = top_results
        ? (Math.min(
            top_results,
            maxDashboardSeries,
        ) ?? 100)
        : (maxDashboardSeries ?? 100);

    // For multi y-axis charts, divide the limit by number of y-axes
    // to keep total series count at or below max_dashboard_series
    // This applies when there are multiple y-axes AND breakdown fields
    if (yAxisKeys.length > 1 && breakDownKeys.length > 0) {
        limitSeries = Math.floor(limitSeries / yAxisKeys.length);
    }

    const innerDataArray = data[0];

    if (!breakDownKeys.length) {
        return innerDataArray;
    }

    const breakdownKey = breakDownKeys[0];
    const yAxisKey = yAxisKeys[0];
    const xAxisKey = xAxisKeys[0];

    // Step 1: Aggregate y_axis values by breakdown, ensuring missing values are set to empty string
    const breakdown = innerDataArray.reduce((acc: any, item: any) => {
        let breakdownValue = getDataValue(item, breakdownKey);

        // Convert null, undefined, and empty string to a default empty string
        if (
            breakdownValue == null ||
            breakdownValue === "" ||
            breakdownValue === undefined
        ) {
            breakdownValue = "";
        }

        const yAxisValue = getDataValue(item, yAxisKey);

        acc[breakdownValue] = (acc[breakdownValue] || 0) + (+yAxisValue || 0);
        return acc;
    }, {});

    // Step 2: Sort and extract the top keys based on the configured number of top results
    const allKeys = Object.entries(breakdown).sort(
        ([, a]: any, [, b]: any) => b - a,
    );

    // if top_results is enabled and the number of unique breakdown values is greater than the limit, add a warning message
    // if top_results is not enabled and the number of unique breakdown values is greater than the max_dashboard_series, add a warning message
    if (
        (top_results &&
            top_results > (maxDashboardSeries ?? 100) &&
            allKeys.length > top_results) ||
        (!top_results &&
            allKeys.length > (maxDashboardSeries ?? 100))
    ) {
        extras.limitNumberOfSeriesWarningMessage =
            "Limiting the displayed series to ensure optimal performance";
    }

    const topKeys = allKeys.slice(0, limitSeries).map(([key]) => key);

    // Step 3: Initialize result array and others object for aggregation
    const resultArray: any[] = [];
    const othersObj: any = {};

    innerDataArray.forEach((item: any) => {
        let breakdownValue = getDataValue(item, breakdownKey);

        // Ensure missing breakdown values are treated as empty strings
        if (
            breakdownValue == null ||
            breakdownValue === "" ||
            breakdownValue === undefined
        ) {
            breakdownValue = "";
        }

        if (topKeys.includes(breakdownValue.toString())) {
            resultArray.push({ ...item, [breakdownKey]: breakdownValue });
        } else if (top_results_others) {
            const xAxisValue = String(getDataValue(item, xAxisKey));
            othersObj[xAxisValue] =
                (othersObj[xAxisValue] || 0) + (+getDataValue(item, yAxisKey) || 0);
        }
    });

    // Step 4: Add 'others' aggregation to the result array if enabled
    if (top_results_others) {
        Object.entries(othersObj).forEach(([xAxisValue, yAxisValue]) => {
            resultArray.push({
                [breakdownKey]: "others",
                [xAxisKey]: xAxisValue,
                [yAxisKey]: yAxisValue,
            });
        });
    }

    return resultArray;
};
