// Copyright 2023 OpenObserve Inc.
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

import { reactive, computed } from "vue";
import {
  b64EncodeStandard,
  b64EncodeUnicode,
  useLocalTraceFilterField,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard, useQuasar } from "quasar";
import { getSpanColorHex } from "@/utils/traces/traceColors";

const defaultObject = {
  organizationIdentifier: "",
  runQuery: false,
  loading: false,
  loadingStream: false,

  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
    refreshTimes: [
      [
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ],
      [
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ],
      [
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ],
      [
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ],
    ],
  },
  meta: {
    refreshInterval: 0,
    refreshIntervalLabel: "Off",
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    showTraceDetails: false,
    sqlMode: false,
    resultGrid: {
      wrapCells: false,
      manualRemoveFields: false,
      rowsPerPage: 25,
      showPagination: false,
      sortBy: "start_time" as string,
      sortOrder: "desc" as "asc" | "desc",
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
    },
    scrollInfo: {},
    serviceColors: {} as any,
    redirectedFromLogs: false,
    searchApplied: false,
    metricsRangeFilters: new Map<
      string,
      { panelTitle: string; start: number; end: number }
    >(),
    showErrorOnly: false,
    queryEditorPlaceholderFlag: true,
    searchMode: "traces" as "traces" | "spans",
  },
  data: {
    query: "",
    advanceFiltersQuery: "",
    parsedQuery: {},
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [],
      selectedFields: <string[]>[],
      filterField: "",
      addToFilter: "",
      functions: [],
      filters: [] as any[],
      fieldValues: {} as {
        [key: string | number]: {
          isLoading: boolean;
          values: { key: string; count: string }[];
          selectedValues: string[];
          size: number;
          isOpen: boolean;
          searchKeyword: string;
        };
      },
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 0,
      columns: <any>[],
    },
    queryPayload: <any>{},
    transforms: <any>[],
    queryResults: <any>[],
    sortedQueryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{},
    editorValue: "",
    datetime: {
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    searchAround: {
      indexTimestamp: 0,
      size: <number>10,
      histogramHide: false,
    },
    traceDetails: {
      selectedTrace: null as {
        trace_id: string;
        trace_start_time: number;
        trace_end_time: number;
      } | null,
      traceId: "",
      spanList: [],
      isLoadingTraceMeta: false,
      isLoadingTraceDetails: false,
      selectedSpanId: "" as String | null,
      expandedSpans: [] as String[],
      showSpanDetails: false,
      selectedLogStreams: [] as String[],
    },
  },
};

const searchObj = reactive(Object.assign({}, defaultObject));

/** Default ordered column ID lists used when no localStorage entry exists. */
export const DEFAULT_TRACE_COLUMNS: Record<"traces" | "spans", string[]> = {
  spans: [
    "service_name",
    "operation_name",
    "duration",
    "status",
    "status_code",
    "method",
  ],
  traces: [
    "service_name",
    "operation_name",
    "duration",
    "spans",
    "status",
    "service_latency",
  ],
};

const useTraces = () => {
  const store = useStore();
  const router = useRouter();
  const $q = useQuasar();

  const resetSearchObj = () => {
    // delete searchObj.data;
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = { label: "", value: "" };
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];
    searchObj.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {
        title: "",
        unparsed_x_data: [],
        timezone: "",
      },
    };
    searchObj.data.query = "";
    searchObj.data.editorValue = "";
    searchObj.meta.sqlMode = false;
    searchObj.runQuery = false;
    searchObj.data.traceDetails.isLoadingTraceDetails = false;
    searchObj.data.traceDetails.isLoadingTraceMeta = false;
  };

  /**
   * Persist the current selectedFields for the given mode.
   * Stored as traceFilterField[orgId_stream][mode] = string[].
   */
  const updatedLocalLogFilterField = (
    searchMode: "traces" | "spans" = "traces",
  ): void => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    const key = `${identifier}_${searchObj.data.stream.selectedStream.value}`;
    const all: any = useLocalTraceFilterField()?.value ?? {};
    all[key] = {
      ...(all[key] ?? {}),
      [searchMode]: searchObj.data.stream.selectedFields,
    };
    useLocalTraceFilterField(all);
  };

  /**
   * Restore selectedFields for the given mode from localStorage.
   * Falls back to the default ordered column list when no saved value exists.
   */
  const loadLocalLogFilterField = (
    searchMode: "traces" | "spans" = "traces",
  ): void => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    const key = `${identifier}_${searchObj.data.stream.selectedStream.value}`;
    const saved = useLocalTraceFilterField()?.value?.[key];

    searchObj.data.stream.selectedFields = saved?.[searchMode]?.length
      ? saved?.[searchMode]
      : [...DEFAULT_TRACE_COLUMNS[searchMode]];
  };

  function getUrlQueryParams(getShareLink: boolean = false) {
    const date = searchObj.data.datetime;
    const query: any = {};

    query["stream"] = searchObj.data.stream.selectedStream.value;

    if (date.type === "relative" && !getShareLink) {
      query["period"] = date.relativeTimePeriod;
    } else {
      query["from"] = date.startTime;
      query["to"] = date.endTime;
    }

    query["query"] = b64EncodeUnicode(searchObj.data.editorValue);

    query["org_identifier"] = store.state.selectedOrganization.identifier;

    query["trace_id"] = router.currentRoute.value.query.trace_id;

    if (searchObj.meta.searchMode === "spans") {
      query["search_mode"] = "spans";
    }

    if (router.currentRoute.value.query.span_id)
      query["span_id"] = router.currentRoute.value.query.span_id;

    return query;
  }

  const copyTracesUrl = (
    customTimeRange: { from: string; to: string } | null = null,
  ) => {
    const queryParams = getUrlQueryParams(true);

    if (customTimeRange) {
      queryParams.from = customTimeRange.from;
      queryParams.to = customTimeRange.to;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      searchParams.append(key, value);
    }
    const queryString = searchParams.toString();

    let shareURL = window.location.origin + window.location.pathname;

    if (queryString != "") {
      shareURL += "?" + queryString;
    }

    copyToClipboard(shareURL)
      .then(() => {
        $q.notify({
          type: "positive",
          message: "Link Copied Successfully!",
          timeout: 5000,
        });
      })
      .catch(() => {
        $q.notify({
          type: "negative",
          message: "Error while copy link.",
          timeout: 5000,
        });
      });
  };

  // Function to build query details for navigation
  const buildQueryDetails = (span: any, isSpan: boolean = true) => {
    const spanIdField =
      store.state.organizationData?.organizationSettings?.span_id_field_name;
    const traceIdField =
      store.state.organizationData?.organizationSettings?.trace_id_field_name;
    const traceId = searchObj.data.traceDetails.selectedTrace?.trace_id;

    let query: string = isSpan
      ? `${spanIdField}='${span.spanId || span.span_id}' ${
          traceId ? `AND ${traceIdField}='${traceId}'` : ""
        }`
      : `${traceIdField}='${traceId}'`;

    if (query) query = b64EncodeStandard(query) as string;

    return {
      stream: searchObj.data.traceDetails.selectedLogStreams.join(","),
      from: span.startTimeMs * 1000 - 60000000,
      to: span.endTimeMs * 1000 + 60000000,
      refresh: 0,
      query,
      orgIdentifier: store.state.selectedOrganization.identifier,
    };
  };

  // Function to navigate to logs with the provided query details
  const navigateToLogs = (queryDetails: any) => {
    router.push({
      path: "/logs",
      query: {
        stream_type: "logs",
        stream: queryDetails.stream,
        from: queryDetails.from,
        to: queryDetails.to,
        refresh: queryDetails.refresh,
        sql_mode: "false",
        query: queryDetails.query,
        org_identifier: queryDetails.orgIdentifier,
        show_histogram: "true",
        type: "trace_explorer",
        quick_mode: "false",
      },
    });
  };

  /**
   * Computed property for traces share URL
   * Generates the full shareable URL with all query parameters
   */
  const tracesShareURL = computed(() => {
    const queryParams = getUrlQueryParams(true);

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      searchParams.append(key, String(value));
    }
    const queryString = searchParams.toString();

    let shareURL = window.location.origin + window.location.pathname;

    if (queryString != "") {
      shareURL += "?" + queryString;
    }

    return shareURL;
  });

  /**
   * Format raw trace hits from API into structured trace metadata
   * Assigns service colors using hash-based consistent coloring from traceColors utility
   * @param traces - Raw trace hits from the API
   * @returns Formatted trace metadata array
   */
  const formatTracesMetaData = (traces: any[]): any[] => {
    if (!traces.length) return [];
    let colorIndex = 0;

    return traces.map((trace) => {
      const _trace = {
        trace_id: trace.trace_id,
        trace_start_time: Math.round(trace.start_time / 1000),
        trace_end_time: Math.round(trace.end_time / 1000),
        service_name: trace.first_event?.service_name || "",
        operation_name: trace.first_event?.operation_name || "",
        spans: trace.spans?.[0] || 0,
        errors: trace.spans?.[1] || 0,
        duration: trace.duration || 0,
        services: {} as Record<string, { count: number; duration: number }>,
        zo_sql_timestamp: new Date(trace.start_time / 1000).getTime(),
        llm_usage_details_input: trace.llm_usage_tokens_input,
        llm_usage_details_output: trace.llm_usage_tokens_output,
        llm_usage_details_total: trace.llm_usage_tokens_total,
        llm_cost_details_total: trace.llm_usage_cost_total,
        llm_input: trace.llm_input || {},
      };

      // Assign colors to services
      if (trace.service_name && Array.isArray(trace.service_name)) {
        trace.service_name.forEach((service: any, index: number) => {
          const serviceName =
            typeof service === "string" ? service : service.service_name;

          if (!searchObj.meta.serviceColors[serviceName]) {
            // Use hash-based color assignment for consistency
            searchObj.meta.serviceColors[serviceName] =
              getSpanColorHex(colorIndex);

            colorIndex += 1;
          }

          // Track service span count and duration
          const serviceCount =
            typeof service === "string" ? 1 : service.count || 1;
          const serviceDuration =
            typeof service === "string" ? 0 : service.duration || 0;
          _trace.services[serviceName] = {
            count: serviceCount,
            duration: serviceDuration,
          };
        });
      }

      return _trace;
    });
  };

  return {
    searchObj,
    resetSearchObj,
    updatedLocalLogFilterField,
    loadLocalLogFilterField,
    getUrlQueryParams,
    copyTracesUrl,
    buildQueryDetails,
    navigateToLogs,
    tracesShareURL,
    formatTracesMetaData,
  };
};

export default useTraces;
