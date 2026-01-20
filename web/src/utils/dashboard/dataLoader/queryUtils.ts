
import {
    formatInterval,
    formatRateInterval,
    getTimeInSecondsBasedOnUnit,
} from "@/utils/dashboard/variables/variablesUtils";
import { escapeSingleQuotes, b64EncodeUnicode } from "@/utils/zincutils";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { addLabelToPromQlQuery } from "@/utils/query/promQLUtils";
import { addLabelsToSQlQuery, getStreamFromQuery } from "@/utils/query/sqlUtils";

/**
 * Replaces the query with the corresponding variable values.
 */
export const replaceQueryValue = (
    query: any,
    startISOTimestamp: any,
    endISOTimestamp: any,
    queryType: any,
    scrapeInterval: number,
    panelWidth: number,
    currentDependentVariablesData: any[]
) => {
    const metadata: any[] = [];

    // timestamp in seconds / chart panel width
    const __interval =
        (endISOTimestamp - startISOTimestamp) /
        (panelWidth ?? 1000) /
        1000;

    // round interval
    const formattedInterval = formatInterval(__interval);

    // calculate rate interval in seconds
    // we need formatted interval value in seconds
    const __rate_interval: any = Math.max(
        getTimeInSecondsBasedOnUnit(
            formattedInterval.value,
            formattedInterval.unit
        ) + scrapeInterval,
        4 * scrapeInterval
    );

    //get interval in ms
    const __interval_ms =
        getTimeInSecondsBasedOnUnit(
            formattedInterval.value,
            formattedInterval.unit
        ) * 1000;

    // calculate range in seconds (total time range of the dashboard)
    // Note: startISOTimestamp and endISOTimestamp are in microseconds (from API)
    const __range_micros = endISOTimestamp - startISOTimestamp;
    const __range_seconds = __range_micros / 1000000; // Convert microseconds to seconds

    // format range, ensuring it's never empty (minimum 1s for PromQL compatibility)
    const formattedRange = formatRateInterval(__range_seconds) || "1s";

    const fixedVariables = [
        {
            name: "__interval_ms",
            value: `${__interval_ms}ms`,
        },
        {
            name: "__interval",
            value: `${formattedInterval.value}${formattedInterval.unit}`,
        },
        {
            name: "__rate_interval",
            value: `${formatRateInterval(__rate_interval)}`,
        },
        {
            name: "__range",
            value: formattedRange,
        },
        {
            name: "__range_s",
            value: `${Math.floor(__range_seconds)}`,
        },
        {
            name: "__range_ms",
            value: `${Math.floor(__range_seconds * 1000)}`,
        },
    ];

    // replace fixed variables with its values
    fixedVariables?.forEach((variable: any) => {
        // replace $VARIABLE_NAME or ${VARIABLE_NAME} with its value
        const variableName = `$${variable.name}`;
        const variableNameWithBrackets = `\${${variable.name}}`;
        const variableValue = variable.value;
        if (
            query.includes(variableName) ||
            query.includes(variableNameWithBrackets)
        ) {
            metadata.push({
                type: "fixed",
                name: variable.name,
                value: variable.value,
            });
        }
        query = query.replaceAll(variableNameWithBrackets, variableValue);
        query = query.replaceAll(variableName, variableValue);
    });

    if (currentDependentVariablesData?.length) {
        currentDependentVariablesData?.forEach((variable: any) => {
            // replace $VARIABLE_NAME or ${VARIABLE_NAME} with its value
            const variableName = `$${variable.name}`;
            const variableNameWithBrackets = `\${${variable.name}}`;

            let variableValue = "";
            if (Array.isArray(variable.value)) {
                // If no data found (empty array), use SELECT_ALL_VALUE
                const valueToUse =
                    variable.value.length === 0 ? [SELECT_ALL_VALUE] : variable.value;
                const value =
                    valueToUse
                        .map(
                            (value: any) =>
                                `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`
                        )
                        .join(",") || "''";
                const possibleVariablesPlaceHolderTypes = [
                    {
                        placeHolder: `\${${variable.name}:csv}`,
                        value: valueToUse.join(","),
                    },
                    {
                        placeHolder: `\${${variable.name}:pipe}`,
                        value: valueToUse.join("|"),
                    },
                    {
                        placeHolder: `\${${variable.name}:doublequote}`,
                        value:
                            valueToUse.map((value: any) => `"${value}"`).join(",") || '""',
                    },
                    {
                        placeHolder: `\${${variable.name}:singlequote}`,
                        value: value,
                    },
                    {
                        placeHolder: `\${${variable.name}}`,
                        value: queryType === "sql" ? value : valueToUse.join("|"),
                    },
                    {
                        placeHolder: `\$${variable.name}`,
                        value: queryType === "sql" ? value : valueToUse.join("|"),
                    },
                ];

                possibleVariablesPlaceHolderTypes.forEach((placeHolderObj) => {
                    if (query.includes(placeHolderObj.placeHolder)) {
                        metadata.push({
                            type: "variable",
                            name: variable.name,
                            value: placeHolderObj.value,
                        });
                    }
                    query = query.replaceAll(
                        placeHolderObj.placeHolder,
                        placeHolderObj.value
                    );
                });
            } else {
                // If no data found (null value), use SELECT_ALL_VALUE
                const valueToUse =
                    variable.value === null ? SELECT_ALL_VALUE : variable.value;
                variableValue = `${variable.escapeSingleQuotes ? escapeSingleQuotes(valueToUse) : valueToUse}`;
                if (
                    query.includes(variableName) ||
                    query.includes(variableNameWithBrackets)
                ) {
                    metadata.push({
                        type: "variable",
                        name: variable.name,
                        value: valueToUse,
                    });
                }
                query = query.replaceAll(variableNameWithBrackets, variableValue);
                query = query.replaceAll(variableName, variableValue);
            }
        });

        return { query, metadata };
    } else {
        return { query, metadata };
    }
};

export const applyDynamicVariables = async (
    query: any,
    queryType: any,
    variablesData: any
) => {
    const metadata: any[] = [];
    const adHocVariables = variablesData.value?.values
        ?.filter((it: any) => it.type === "dynamic_filters")
        ?.map((it: any) => it?.value)
        .flat()
        ?.filter((it: any) => it?.operator && it?.name && it?.value);

    if (!adHocVariables?.length) {
        return { query, metadata };
    }

    // continue if there are any adhoc queries
    if (queryType === "promql") {
        adHocVariables.forEach((variable: any) => {
            metadata.push({
                type: "dynamicVariable",
                name: variable.name,
                value: variable.value,
                operator: variable.operator,
            });

            query = addLabelToPromQlQuery(
                query,
                variable.name,
                variable.value,
                variable.operator
            );
        });
    }

    if (queryType === "sql") {
        // const queryStream = await getStreamFromQuery(query);

        const applicableAdHocVariables = adHocVariables;
        // .filter((it: any) => {
        //   return it?.streams?.find((it: any) => it.name == queryStream);
        // });

        applicableAdHocVariables.forEach((variable: any) => {
            metadata.push({
                type: "dynamicVariable",
                name: variable.name,
                value: variable.value,
                operator: variable.operator,
            });
        });
        query = await addLabelsToSQlQuery(query, applicableAdHocVariables);
    }

    return { query, metadata };
};

export const adjustTimestampByTimeRangeGap = (
    timestamp: number,
    timeRangeGapSeconds: number
) => {
    return timestamp - timeRangeGapSeconds * 1000;
};

/**
 * Processes an API error based on the given error and type.
 */
export const processApiError = (error: any, type: any) => {
    switch (type) {
        case "promql": {
            const errorDetailValue = error?.response?.data?.error || error?.message;
            const trimmedErrorMessage =
                errorDetailValue?.length > 300
                    ? errorDetailValue.slice(0, 300) + " ..."
                    : errorDetailValue;

            const errorCode =
                error?.response?.status ||
                error?.status ||
                error?.response?.data?.code ||
                "";

            return {
                message: trimmedErrorMessage,
                code: errorCode,
            };
        }
        case "sql": {
            const errorDetailValue =
                error?.response?.data.error_detail ||
                error?.response?.data.message ||
                error?.error_detail ||
                error?.message ||
                error?.error;

            const trimmedErrorMessage =
                errorDetailValue?.length > 300
                    ? errorDetailValue.slice(0, 300) + " ..."
                    : errorDetailValue;

            const errorCode =
                error?.response?.status ||
                error?.status ||
                error?.response?.data?.code ||
                error?.code ||
                "";

            return {
                message: trimmedErrorMessage,
                code: errorCode,
            };
        }
        default:
            return {
                message: "Unknown error",
                code: "",
            };
    }
};
export const getFallbackOrderByCol = (panelSchema: any) => {
    // from panelSchema, get first x axis field alias
    if (panelSchema?.value?.queries?.[0]?.fields?.x) {
        return panelSchema.value?.queries[0]?.fields?.x?.[0]?.alias ?? null;
    }
    return null;
};
