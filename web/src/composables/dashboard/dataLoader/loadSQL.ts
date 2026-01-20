import {
    replaceQueryValue,
    applyDynamicVariables,
    adjustTimestampByTimeRangeGap,
    processApiError,
    getFallbackOrderByCol,
} from "@/utils/dashboard/dataLoader/queryUtils";
import { generateTraceContext, b64EncodeUnicode } from "@/utils/zincutils";

export const loadSQL = async (
    options: {
        panelSchema: any;
        store: any;
        dashboardId: any;
        dashboardName: any;
        folderId: any;
        folderName: any;
        runId: any;
        tabId: any;
        tabName: any;
        startISOTimestamp: any;
        endISOTimestamp: any;
        variablesData: any;
        chartPanelRef: any;
        currentDependentVariablesData: any;
        state: any;
        abortControllerRef: any;
        fetchQueryDataWithHttpStream: any;
        saveCurrentStateToCache: any;
        addTraceId: any;
        removeTraceId: any;
        refreshAnnotations: any;
        shouldFetchAnnotations: any;
        checkTimestampAlias: any;
        convertOffsetToSeconds: any;
        is_ui_histogram: any;
        searchType: any;
        shouldRefreshWithoutCache: any;
        searchResponse: any;
    }
) => {
    const {
        panelSchema,
        store,
        dashboardId,
        dashboardName,
        folderId,
        folderName,
        runId,
        tabId,
        tabName,
        startISOTimestamp,
        endISOTimestamp,
        variablesData,
        chartPanelRef,
        currentDependentVariablesData,
        state,
        abortControllerRef,
        fetchQueryDataWithHttpStream,
        saveCurrentStateToCache,
        addTraceId,
        removeTraceId,
        refreshAnnotations,
        shouldFetchAnnotations,
        checkTimestampAlias,
        convertOffsetToSeconds,
        is_ui_histogram,
        searchType,
        shouldRefreshWithoutCache,
        searchResponse,
    } = options;

    let currentQueryIndexInStream: number | null = null;

    const handleSearchResponse = (payload: any, response: any) => {
        // Handle streaming response for multi-query
        if (response.type === "search_response_metadata") {
            const results = response?.content?.results;
            const queryIndex = results?.query_index ?? payload.meta?.currentQueryIndex ?? 0;

            // Store the current query index for the next hits event
            currentQueryIndexInStream = queryIndex;

            // Initialize metadata array if not exists
            if (!state.resultMetaData[queryIndex]) {
                state.resultMetaData[queryIndex] = [];
            }

            // Push metadata for each partition
            state.resultMetaData[queryIndex].push({
                ...(response?.content ?? {}),
                ...(response?.content?.results ?? {}),
            });
        }

        if (response.type === "search_response_hits") {
            // The hits come directly in response.content.hits or response.content.results.hits
            const hits =
                response?.content?.results?.hits ??
                response?.content?.hits;
            // Get query_index from results metadata
            const results = response?.content?.results;

            // Use query_index from the event, or from the last metadata event, or find next empty
            let queryIndex =
                results?.query_index ?? currentQueryIndexInStream ?? payload.meta?.currentQueryIndex;

            // If query_index is still not available, find the first query that doesn't have hits yet
            if (queryIndex === undefined || queryIndex === null) {
                queryIndex = state.resultMetaData.findIndex(
                    (meta: any, idx: number) =>
                        !state.data[idx] || state.data[idx].length === 0,
                );
            }

            if (
                queryIndex >= 0 &&
                queryIndex < state.data.length &&
                Array.isArray(hits) &&
                hits.length > 0
            ) {
                // Check if streaming_aggs is enabled
                const streaming_aggs =
                    state.resultMetaData[queryIndex]?.[0]
                        ?.streaming_aggs ?? false;

                // If streaming_aggs, replace the data (aggregation query)
                if (streaming_aggs) {
                    state.data[queryIndex] = [...hits];
                }
                // Otherwise, append/prepend based on order_by (multiple partitions)
                else {
                    const orderBy =
                        state.resultMetaData[
                            queryIndex
                        ]?.order_by?.toLowerCase();

                    if (orderBy === "asc") {
                        // For ascending order, prepend new data at start
                        state.data[queryIndex] = [
                            ...hits,
                            ...(state.data[queryIndex] ?? []),
                        ];
                    } else {
                        // For descending order, append new data at end
                        state.data[queryIndex] = [
                            ...(state.data[queryIndex] ?? []),
                            ...hits,
                        ];
                    }
                }

                if (state.resultMetaData[queryIndex]) {
                    state.resultMetaData[queryIndex].hits =
                        state.data[queryIndex];
                }
            }
            state.errorDetail = { message: "", code: "" };
            saveCurrentStateToCache();
        }

        if (response.type === "search_response") {
            // Legacy format: single response with all data
            const results = response?.content?.results;
            const queryIndex = results?.query_index ?? payload.meta?.currentQueryIndex ?? 0;

            if (results?.hits && Array.isArray(results.hits)) {
                state.data[queryIndex] = [...results.hits];
                state.resultMetaData[queryIndex] = {
                    ...(state.resultMetaData[queryIndex] ?? {}),
                    ...results,
                };
            }
            state.errorDetail = { message: "", code: "" };
            saveCurrentStateToCache();
        }

        if (response.type === "error") {
            state.errorDetail = processApiError(response?.content, "sql");
        }

        if (response.type === "end") {
            state.loading = false;
            state.isPartialData = false;
            saveCurrentStateToCache();
        }
    };

    const handleSearchError = (payload: any, err: any) => {
        state.loading = false;
        state.errorDetail = processApiError(err, "sql");
        removeTraceId(payload.traceId);
    };

    const handleSearchClose = (payload: any) => {
        state.loading = false;
        saveCurrentStateToCache();
        removeTraceId(payload.traceId);
    };

    const handleSearchReset = (payload: any, res: any) => {
        if (payload.traceId) {
            removeTraceId(payload.traceId);
        }
    };

    try {
        // Call search API
        state.data = [];
        state.metadata = {
            queries: [],
        };
        state.resultMetaData = [];
        state.annotations = [];
        state.isOperationCancelled = false;

        // Get the page type from the first query in the panel schema
        const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

        // Handle each query sequentially
        for (const [
            panelQueryIndex,
            it,
        ] of panelSchema.value.queries.entries()) {
            state.loading = true;

            if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
                // convert time shift to milliseconds
                const timeShiftInMilliSecondsArray = it.config?.time_shift?.map(
                    (it: any) => convertOffsetToSeconds(it.offSet, endISOTimestamp),
                );

                // append 0 seconds to the timeShiftInMilliSecondsArray at 0th index
                timeShiftInMilliSecondsArray.unshift({
                    seconds: 0,
                    periodAsStr: "",
                });

                const timeShiftQueries: any[] = [];

                // loop on all timeShiftInMilliSecondsArray
                for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
                    const timeRangeGap = timeShiftInMilliSecondsArray[i];
                    const { query: query1, metadata: metadata1 } =
                        replaceQueryValue(
                            it.query,
                            adjustTimestampByTimeRangeGap(
                                startISOTimestamp,
                                timeRangeGap.seconds,
                            ),
                            adjustTimestampByTimeRangeGap(
                                endISOTimestamp,
                                timeRangeGap.seconds,
                            ),
                            panelSchema.value.queryType,
                            store.state.organizationData.organizationSettings.scrape_interval ?? 15,
                            chartPanelRef.value?.offsetWidth ?? 1000,
                            currentDependentVariablesData
                        );

                    const { query: query2, metadata: metadata2 } =
                        await applyDynamicVariables(
                            query1,
                            panelSchema.value.queryType,
                            variablesData
                        );
                    const query = query2;

                    // Validate that timestamp column is not used as an alias for other fields
                    if (!checkTimestampAlias(query)) {
                        state.errorDetail = {
                            message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
                            code: "400",
                        };
                        addTraceId("tempTraceId");
                        removeTraceId("tempTraceId");
                        state.loading = false;
                        // Skip this iteration and continue with next query/time shift
                        continue;
                    }
                    const metadata: any = {
                        originalQuery: it.query,
                        query: query,
                        startTime: adjustTimestampByTimeRangeGap(
                            startISOTimestamp,
                            timeRangeGap.seconds,
                        ),
                        endTime: adjustTimestampByTimeRangeGap(
                            endISOTimestamp,
                            timeRangeGap.seconds,
                        ),
                        queryType: panelSchema.value.queryType,
                        variables: [...(metadata1 || []), ...(metadata2 || [])],
                        timeRangeGap: timeRangeGap,
                    };

                    // push metadata and searchRequestObj[which will be passed to search API]
                    timeShiftQueries.push({
                        metadata,
                        searchRequestObj: {
                            sql: query,
                            start_time: adjustTimestampByTimeRangeGap(
                                startISOTimestamp,
                                timeRangeGap.seconds,
                            ),
                            end_time: adjustTimestampByTimeRangeGap(
                                endISOTimestamp,
                                timeRangeGap.seconds,
                            ),
                            query_fn: null,
                        },
                    });
                }

                try {
                    // Start fetching annotations in parallel with search
                    const annotationsPromise = (async () => {
                        try {
                            if (!shouldFetchAnnotations()) {
                                return [];
                            }
                            const annotationList = await refreshAnnotations(
                                startISOTimestamp,
                                endISOTimestamp,
                            );
                            return annotationList || [];
                        } catch (annotationError) {
                            console.error(
                                "Failed to fetch annotations:",
                                annotationError,
                            );
                            return [];
                        }
                    })();

                    // get search queries
                    const searchQueries = timeShiftQueries.map(
                        (it: any) => it.searchRequestObj,
                    );

                    const { traceId } = generateTraceContext();
                    addTraceId(traceId);
                    // if aborted, return
                    if (abortControllerRef?.signal?.aborted) {
                        return;
                    }

                    state.loading = true;

                    // Initialize state arrays for each time shift query
                    for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
                        state.data.push([]);
                        state.metadata.queries.push(
                            timeShiftQueries[i]?.metadata ?? {},
                        );
                        state.resultMetaData.push([]);
                    }

                    // Use HTTP2/streaming for multi-query (time-shift) queries
                    // Track the current query index being processed
                    currentQueryIndexInStream = null;

                    const payload: any = {
                        queryReq: {
                            query: {
                                sql: searchQueries,
                                query_fn: it.vrlFunctionQuery
                                    ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
                                    : null,
                                start_time: startISOTimestamp,
                                end_time: endISOTimestamp,
                                per_query_response: true,
                                size: -1,
                            },
                        },
                        type: "histogram" as const,
                        isPagination: false,
                        traceId,
                        org_id: store?.state?.selectedOrganization?.identifier,
                        pageType,
                        searchType: searchType.value ?? "dashboards",
                        meta: {
                            dashboard_id: dashboardId?.value,
                            dashboard_name: dashboardName?.value,
                            folder_id: folderId?.value,
                            folder_name: folderName?.value,
                            panel_id: panelSchema.value.id,
                            panel_name: panelSchema.value.title,
                            run_id: runId?.value,
                            tab_id: tabId?.value,
                            tab_name: tabName?.value,
                            fallback_order_by_col: getFallbackOrderByCol(panelSchema),
                            is_ui_histogram: is_ui_histogram.value,
                            is_refresh_cache: shouldRefreshWithoutCache?.value || false,
                            timeShiftQueries,
                        },
                    };

                    fetchQueryDataWithHttpStream(payload, {
                        data: handleSearchResponse,
                        error: handleSearchError,
                        complete: handleSearchClose,
                        reset: handleSearchReset,
                    });

                    // Wait for annotations to complete (started in parallel earlier)
                    state.annotations = await annotationsPromise;
                } catch (error) {
                    // Process API error for "sql"
                    state.errorDetail = processApiError(error, "sql");
                    return { result: null, metadata: null };
                } finally {
                    // set loading to false
                    // state.loading = false;
                }
            } else {
                const { query: query1, metadata: metadata1 } = replaceQueryValue(
                    it.query,
                    startISOTimestamp,
                    endISOTimestamp,
                    panelSchema.value.queryType,
                    store.state.organizationData.organizationSettings.scrape_interval ?? 15,
                    chartPanelRef.value?.offsetWidth ?? 1000,
                    currentDependentVariablesData
                );

                const { query: query2, metadata: metadata2 } =
                    await applyDynamicVariables(
                        query1,
                        panelSchema.value.queryType,
                        variablesData
                    );

                const query = query2;

                // Validate that timestamp column is not used as an alias for other fields
                if (!checkTimestampAlias(query)) {
                    state.errorDetail = {
                        message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
                        code: "400",
                    };
                    state.loading = false;
                    addTraceId("tempTraceId");
                    removeTraceId("tempTraceId");
                    // Skip executing this query and move to next
                    continue;
                }

                const metadata: any = {
                    originalQuery: it.query,
                    query: query,
                    startTime: startISOTimestamp,
                    endTime: endISOTimestamp,
                    queryType: panelSchema.value.queryType,
                    variables: [...(metadata1 || []), ...(metadata2 || [])],
                    timeRangeGap: {
                        seconds: 0,
                        periodAsStr: "",
                    },
                };

                state.metadata.queries[panelQueryIndex] = metadata;

                let annotationsPromise: Promise<any> | null = null;

                if (searchResponse?.value?.hits?.length > 0) {
                    // Start fetching annotations in parallel
                    annotationsPromise = (async () => {
                        try {
                            if (!shouldFetchAnnotations()) {
                                return [];
                            }
                            const annotationList = await refreshAnnotations(
                                Number(startISOTimestamp),
                                Number(endISOTimestamp),
                            );
                            return annotationList || [];
                        } catch (annotationError) {
                            return [];
                        }
                    })();

                    // Add empty objects to state.resultMetaData for the results of this query
                    state.data.push([]);
                    state?.resultMetaData?.push([{}]); // Initialize as array with one element

                    const currentQueryIndex = state.data.length - 1;

                    state.data[currentQueryIndex] = searchResponse.value.hits;
                    state.resultMetaData[currentQueryIndex] = [
                        searchResponse.value,
                    ]; // Wrap in array

                    // Wait for annotations to complete
                    if (annotationsPromise) {
                        state.annotations = await annotationsPromise;
                    }

                    // set loading to false
                    state.loading = false;
                    return;
                }
                // Start fetching annotations in parallel for ALL query types
                annotationsPromise = (async () => {
                    try {
                        if (!shouldFetchAnnotations()) {
                            return [];
                        }
                        const annotationList = await refreshAnnotations(
                            Number(startISOTimestamp),
                            Number(endISOTimestamp),
                        );
                        return annotationList || [];
                    } catch (annotationError) {
                        console.error(
                            "Failed to fetch annotations:",
                            annotationError,
                        );
                        return [];
                    }
                })();

                // Initialize data and resultMetaData arrays for this query index
                // This is necessary before the streaming response handlers try to access them
                state.data[panelQueryIndex] = [];
                state.resultMetaData[panelQueryIndex] = [];

                // Use HTTP2/streaming for all dashboard queries
                await getDataThroughStreaming(
                    query,
                    it,
                    startISOTimestamp,
                    endISOTimestamp,
                    pageType,
                    panelQueryIndex,
                    abortControllerRef,
                );

                // Wait for annotations to complete if they were started
                if (annotationsPromise) {
                    state.annotations = await annotationsPromise;
                }

                // this is async task, which will be executed in background(await is not required)
                saveCurrentStateToCache();
            }
        }
    } catch (error: any) {
        state.errorDetail = processApiError(error, "sql");
        state.loading = false;
        state.isOperationCancelled = false;
        state.isPartialData = false;
    }

    async function getDataThroughStreaming(
        query: string,
        it: any,
        startISOTimestamp: string,
        endISOTimestamp: string,
        pageType: string,
        currentQueryIndex: number,
        abortControllerRef: any,
    ) {
        try {
            const { traceId } = generateTraceContext();

            const payload: {
                queryReq: any;
                type: "search" | "histogram" | "pageCount";
                isPagination: boolean;
                traceId: string;
                org_id: string;
                pageType: string;
                searchType: string;
                meta: any;
                clear_cache: boolean;
            } = {
                queryReq: {
                    query: {
                        ...(await getHistogramSearchRequest(
                            query,
                            it,
                            startISOTimestamp,
                            endISOTimestamp,
                            null,
                        )),
                    },
                },
                type: "histogram",
                isPagination: false,
                traceId,
                org_id: store?.state?.selectedOrganization?.identifier,
                pageType,
                searchType: searchType.value ?? "dashboards",
                meta: {
                    currentQueryIndex,
                    dashboard_id: dashboardId?.value,
                    dashboard_name: dashboardName?.value,
                    folder_id: folderId?.value,
                    folder_name: folderName?.value,
                    panel_id: panelSchema.value.id,
                    panel_name: panelSchema.value.title,
                    run_id: runId?.value,
                    tab_id: tabId?.value,
                    tab_name: tabName?.value,
                    fallback_order_by_col: getFallbackOrderByCol(panelSchema),
                    is_ui_histogram: is_ui_histogram.value,
                },
                clear_cache: shouldRefreshWithoutCache?.value || false,
            };

            // if aborted, return
            if (abortControllerRef?.signal?.aborted) {
                // Set partial data flag on abort
                state.isPartialData = true;
                // Save current state to cache
                saveCurrentStateToCache();
                return;
            }

            fetchQueryDataWithHttpStream(payload, {
                data: handleSearchResponse,
                error: handleSearchError,
                complete: handleSearchClose,
                reset: handleSearchReset,
            });

            addTraceId(traceId);
        } catch (e: any) {
            state.errorDetail = processApiError(e, "sql");
            state.loading = false;
            state.isOperationCancelled = false;
            state.isPartialData = false;
        }
    }

    async function getHistogramSearchRequest(
        query: string,
        it: any,
        startISOTimestamp: string,
        endISOTimestamp: string,
        histogramInterval: number | null | undefined,
    ) {
        return {
            sql: query,
            query_fn: it.vrlFunctionQuery
                ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
                : null,
            // if i == 0 ? then do gap of 7 days
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            size: -1,
            histogram_interval: histogramInterval ?? undefined,
        };
    }
};
