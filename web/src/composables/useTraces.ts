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

import { reactive, computed, nextTick, shallowRef, watch } from "vue";
import { debounce } from "lodash-es";
import { b64EncodeStandard, b64EncodeUnicode, useLocalTraceFilterField } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter, type LocationQueryRaw } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import type { TranslateFn } from "@/types/i18n";
import { getOrSetServiceColor as registryGetOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import { buildFieldToGroupIdMap, quoteSqlLiteral } from "@/utils/telemetryCorrelation";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { isLeavingRoute } from "@/utils/pendingNavigation";
import {
  DEFAULT_TRACE_SEARCH_MODE,
  type MetricsRangeFilter,
} from "@/ts/interfaces/traces/trace.types";
import searchService from "@/services/search";
import type { PageLoad, PageRequest, PendingPageSelection } from "@/utils/pageCrossing";
import {
  decodeTracesListState,
  encodeTracesListState,
  TRACES_LIST_URL_KEYS,
} from "@/plugins/traces/tracesUrlState";

// Mirrors the backend's is_internal_stream(); other `_`-prefixed streams are user data.
const INTERNAL_LOG_STREAMS = new Set([
  "_agent_signals",
  "_redaction_evidence",
  "_llm_scores",
  "_evaluator",
  "_llm_experiment",
  "_anomalies",
]);
const VIEW_LOGS_COUNT_TIMEOUT_MS = 5000;
// Count queries share the search work-group queue; too many at once come back as 429s.
const VIEW_LOGS_COUNT_CONCURRENCY = 4;

/** What View logs did: opened Logs, found no stream holding the trace, could not check every stream, or the user moved to another span. */
export type CorrelatedLogsOutcome = "opened" | "none" | "moved" | CorrelatedLogsFailure;

/** No stream was found to hold the trace and at least one probe failed for a server reason; `error` is the first, for `valueErrorCause`. */
export interface CorrelatedLogsFailure {
  failed: true;
  error: unknown;
}

const settleLimited = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
const isInternalLogStream = (name: string) =>
  name.startsWith("_o2_") || INTERNAL_LOG_STREAMS.has(name);
// A partial count still proves the stream holds the trace when it is above zero.
const holdsLogs = (count: PromiseSettledResult<any> | undefined): boolean => {
  if (count?.status !== "fulfilled") return false;
  const data = count.value?.data;
  if (!data || data.function_error) return false;
  const n = Number(data.hits?.[0]?.zo_count);
  return Number.isFinite(n) && n > 0;
};
// A 4xx means the stream cannot hold the trace (no trace_id field); a denial, 5xx, throttle, timeout, lost connection, partial scan or function error means it was never fully checked.
const probeServerError = (
  count: PromiseSettledResult<any> | undefined,
  timedOut: boolean,
): unknown => {
  if (count?.status === "fulfilled") {
    const data = count.value?.data;
    return data?.is_partial || data?.function_error ? data : null;
  }
  if (count?.status !== "rejected") return null;
  const reason = count.reason as { status?: number; response?: { status?: number } } | null;
  const status = reason?.response?.status ?? reason?.status;
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500)
  )
    return reason;
  if (typeof status === "number") return null;
  return timedOut ? { code: "ETIMEDOUT" } : (reason ?? {});
};
const defaultObject = {
  organizationIdentifier: "",
  runQuery: false,
  loading: false,
  loadingStream: false,
  searchApplied: false,

  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
  },
  meta: {
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
        currentRowIndex: 0 as number | null,
        selectionActive: false,
        pendingPageSelection: null as PendingPageSelection | null,
        lastOpenedId: null as string | null,
      },
    },
    scrollInfo: {},
    serviceColors: {} as any,
    redirectedFromLogs: false,
    searchApplied: false,
    lastRunAt: undefined as number | undefined,
    lastRunSignature: null as string | null,
    /** Epoch ms of a re-run that failed while the previous results stay on screen. */
    refreshFailedAt: null as number | null,
    /** A chart of the latest chart load failed its refresh and kept its older result. */
    chartRefreshFailed: false,
    /** The data age of the charts on screen while a chart load runs. */
    chartsDataFrom: undefined as number | undefined,
    /** The selected stream's fields are loading; the rail shows its skeleton only while it has none to keep. */
    loadingFields: false,
    metricsRangeFilters: new Map<string, MetricsRangeFilter>(),
    queryEditorPlaceholderFlag: true,
    liveMode: localStorage.getItem("oo_toggle_auto_run") === "true",
    searchMode: DEFAULT_TRACE_SEARCH_MODE,
    serviceGraphVisualizationType:
      (localStorage.getItem("serviceGraph_visualizationType") as "tree" | "graph") || "tree",
    serviceGraphLayoutType: localStorage.getItem("serviceGraph_layoutType") || "horizontal",
  },
  data: {
    query: "",
    advanceFiltersQuery: "",
    parsedQuery: {},
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    // Server-error highlight ranges forwarded to the query editor (mirrors Logs).
    sqlSyntaxErrorRanges: [] as Array<{
      startLine: number;
      endLine: number;
      column?: number;
      endColumn?: number;
      error: string;
    }>,
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [],
      selectedFields: <string[]>[],
      filterField: "",
      addToFilter: "",
      removeFilterField: "",
      functions: [],
      filters: [] as any[],
      userDefinedSchema: [] as string[],
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
      pageRequest: null as PageRequest | null,
      pageLoad: null as PageLoad | null,
    },
    queryPayload: <any>{},
    transforms: <any>[],
    queryResults: <any>[],
    sortedQueryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{},
    editorValue: "",
    appliedEditorValue: null as string | null,
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
        // Stamped on at runtime by TraceDetails' updateServiceColors: the
        // per-service span counts derived from the span list.
        service_name?: { service_name: string; count: number }[];
        services?: Record<string, number>;
      } | null,
      traceId: "",
      spanList: [],
      isLoadingTraceMeta: false,
      isLoadingTraceDetails: false,
      selectedSpanId: "" as string | null,
      expandedSpans: [] as String[],
      showSpanDetails: false,
      selectedLogStreams: [] as string[],
      correlationProps: null as any,
    },
  },
};

const searchObj = reactive(Object.assign({}, defaultObject));

// A link's columns win over the local ones until the user changes columns or stream; never persisted for them.
let urlColumns: { mode: string; stream: string; fields: string[] } | null = null;

/** Default ordered column ID lists used when no localStorage entry exists. */
export const DEFAULT_TRACE_COLUMNS: Record<"traces" | "spans", string[]> = {
  spans: ["service_name", "operation_name", "duration", "span_status"],
  traces: ["service_name", "operation_name", "duration", "spans", "status", "service_latency"],
};

// Shared SQL parser singleton — loaded once by Index.vue in onBeforeMount,
// then reused across all child components (SearchBar, IndexList, TracesMetricsDashboard).
// This avoids redundant WASM loads and prevents timing issues where a component's
// onMounted calls loadDashboard before its own parser finishes loading.
const tracesParser = shallowRef<any>(null);
let _loadTracesParserPromise: Promise<void> | null = null;

const loadTracesParser = async (): Promise<void> => {
  if (tracesParser.value) return;
  if (_loadTracesParserPromise) {
    await _loadTracesParserPromise;
    return;
  }
  _loadTracesParserPromise = (async () => {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    tracesParser.value = await sqlParser();
  })();
  await _loadTracesParserPromise;
};

const useTraces = () => {
  const store = useStore();
  const router = useRouter();

  const { loadSemanticGroups } = useServiceCorrelation();

  const resetSearchObj = () => {
    // delete searchObj.data;
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.sqlSyntaxErrorRanges = [];
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
    searchObj.meta.lastRunSignature = null;
    searchObj.meta.refreshFailedAt = null;
    searchObj.meta.chartRefreshFailed = false;
    urlColumns = null;
    searchObj.runQuery = false;
    // Only a run sets it again; left true, a new org mounts the Rate/Duration panels and they query without a run.
    searchObj.searchApplied = false;
    searchObj.data.traceDetails.isLoadingTraceDetails = false;
    searchObj.data.traceDetails.isLoadingTraceMeta = false;
  };

  /**
   * Persist the current selectedFields for the given mode.
   * Stored as traceFilterField[orgId_stream][mode] = string[].
   */
  const updatedLocalLogFilterField = (searchMode: "traces" | "spans" = "traces"): void => {
    urlColumns = null;
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
  const loadLocalLogFilterField = (searchMode: "traces" | "spans" = "traces"): void => {
    if (urlColumns && urlColumns.stream !== searchObj.data.stream.selectedStream.value) {
      urlColumns = null;
    }
    if (urlColumns?.mode === searchMode) {
      searchObj.data.stream.selectedFields = [...urlColumns.fields];
      return;
    }
    const identifier: string = searchObj.organizationIdentifier || "default";
    const key = `${identifier}_${searchObj.data.stream.selectedStream.value}`;
    // storage ref .value is typed {} at this boundary; narrow to the stored map shape
    const stored = useLocalTraceFilterField()?.value as
      Record<string, Record<string, string[]>> | undefined;
    const saved: Record<string, string[]> | undefined = stored?.[key];

    const fields: string[] = saved?.[searchMode]?.length
      ? saved?.[searchMode]
      : [...DEFAULT_TRACE_COLUMNS[searchMode]];

    searchObj.data.stream.selectedFields = fields;
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

    query["tab"] = searchObj.meta.searchMode;

    if (router.currentRoute.value.query.span_id)
      query["span_id"] = router.currentRoute.value.query.span_id;

    Object.assign(query, listUrlState());

    return query;
  }

  function listUrlState() {
    const mode = searchObj.meta.searchMode;
    const isList = mode === "traces" || mode === "spans";
    return encodeTracesListState({
      columns: isList ? searchObj.data.stream.selectedFields : [],
      defaultColumns: isList ? DEFAULT_TRACE_COLUMNS[mode] : [],
      rowsPerPage: Number(searchObj.meta.resultGrid.rowsPerPage),
      currentPage: searchObj.data.resultGrid.currentPage,
      showHistogram: searchObj.meta.showHistogram,
    });
  }

  /** Applies a link's list-view keys; the page is returned for the first search to use. */
  const applyUrlListState = (query: Record<string, unknown>) => {
    const decoded = decodeTracesListState(query);
    if (decoded.rowsPerPage !== null) searchObj.meta.resultGrid.rowsPerPage = decoded.rowsPerPage;
    if (decoded.showHistogram !== null) searchObj.meta.showHistogram = decoded.showHistogram;
    urlColumns = decoded.columns
      ? {
          mode: searchObj.meta.searchMode,
          stream: searchObj.data.stream.selectedStream.value,
          fields: decoded.columns,
        }
      : null;
    if (decoded.columns) searchObj.data.stream.selectedFields = [...decoded.columns];
    return { currentPage: decoded.currentPage };
  };

  /** Keeps the list view and the staged editor text in the URL without adding a history entry. */
  const patchUrlViewState = () => {
    const route = router.currentRoute.value;
    if (route.name !== "traces" || isLeavingRoute("traces")) return;
    const query: Record<string, unknown> = { ...route.query };
    // run-query is one-shot; kept in the entry, Back to it would run whatever edit was staged there.
    delete query["run-query"];
    for (const key of TRACES_LIST_URL_KEYS) delete query[key];
    Object.assign(query, listUrlState(), { query: b64EncodeUnicode(searchObj.data.editorValue) });
    // Columns belong to the URL's stream, which only a run moves to the selected one.
    if (route.query.stream !== searchObj.data.stream.selectedStream.value) {
      if (route.query.columns === undefined) delete query.columns;
      else query.columns = route.query.columns;
    }
    const current = route.query as Record<string, unknown>;
    const keys = new Set([...Object.keys(current), ...Object.keys(query)]);
    if ([...keys].every((key) => String(current[key] ?? "") === String(query[key] ?? ""))) return;
    return router.replace({ query: query as LocationQueryRaw });
  };

  /** Starts mirroring list-view changes into the URL; call the returned function to stop. */
  const syncUrlViewState = () => {
    // Debounced so typing does not hit the browser's history-update rate limit.
    const write = debounce(() => void patchUrlViewState(), 300);
    const stop = watch(
      () => [
        searchObj.data.editorValue,
        searchObj.meta.resultGrid.rowsPerPage,
        searchObj.data.resultGrid.currentPage,
        searchObj.meta.showHistogram,
        searchObj.meta.searchMode,
        searchObj.data.stream.selectedFields.join("\u0000"),
      ],
      write,
    );
    return () => {
      stop();
      write.flush();
    };
  };

  const copyTracesUrl = (
    t: TranslateFn,
    customTimeRange: { from: string; to: string } | null = null,
  ) => {
    const queryParams = getUrlQueryParams(true);

    if (customTimeRange) {
      queryParams.from = customTimeRange.from;
      queryParams.to = customTimeRange.to;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      searchParams.append(key, value as string);
    }
    const queryString = searchParams.toString();

    let shareURL = window.location.origin + window.location.pathname;

    if (queryString != "") {
      shareURL += "?" + queryString;
    }

    copyToClipboard(shareURL, t, {
      successMessage: t("search.linkCopiedSuccessfully"),
      errorMessage: t("toastMessages.views.errorWhileCopyLink"),
      timeout: 5000,
    });
  };

  // The columns carrying span/trace ids are org-configurable. Both log
  // navigations — the plain one and the correlated one — resolve them here so
  // they cannot drift apart. Defaults mirror stores/index.ts.
  const getSpanIdField = () =>
    store.state.organizationData?.organizationSettings?.span_id_field_name || "span_id";
  const getTraceIdField = () =>
    store.state.organizationData?.organizationSettings?.trace_id_field_name || "trace_id";

  // Function to build query details for navigation
  const buildQueryDetails = (span: any, isSpan: boolean = true) => {
    const spanIdField = getSpanIdField();
    const traceIdField = getTraceIdField();
    const traceId = searchObj.data.traceDetails.selectedTrace?.trace_id;

    const spanId = escapeSingleQuotes(String(span.spanId || span.span_id));
    const escapedTraceId = escapeSingleQuotes(String(traceId));

    let query: string = isSpan
      ? `${quoteSqlIdentifierIfNeeded(spanIdField)}='${spanId}' ${
          traceId ? `AND ${quoteSqlIdentifierIfNeeded(traceIdField)}='${escapedTraceId}'` : ""
        }`
      : `${quoteSqlIdentifierIfNeeded(traceIdField)}='${escapedTraceId}'`;

    if (query) query = b64EncodeStandard(query) as string;

    return {
      stream: searchObj.data.traceDetails.selectedLogStreams.join(","),
      from: Math.floor(span.start_time / 1000) - 60000000,
      to: Math.ceil(span.end_time / 1000) + 60000000,
      refresh: 0,
      query,
      orgIdentifier: store.state.selectedOrganization.identifier,
    };
  };

  // Function to navigate to logs with the provided query details
  const navigateToLogs = async (queryDetails: any) => {
    store.dispatch("logs/setIsInitialized", false);
    await nextTick();
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
   * Assign service colors for raw hits from either traces or spans mode.
   * - Traces mode: service_name is an array of strings or objects with a service_name property.
   * - Spans mode: service_name is a plain string.
   */
  const setServiceColors = (hits: any[]): void => {
    hits.forEach((hit: any) => {
      const serviceNames = Array.isArray(hit.service_name)
        ? hit.service_name
        : hit.service_name
          ? [hit.service_name]
          : [];
      serviceNames.forEach((service: any) => {
        const serviceName = typeof service === "string" ? service : service.service_name;
        if (serviceName && !searchObj.meta.serviceColors[serviceName]) {
          searchObj.meta.serviceColors[serviceName] = registryGetOrSetServiceColor(serviceName);
        }
      });
    });
  };

  const getOrSetServiceColor = (serviceName: string): string => {
    const color = registryGetOrSetServiceColor(serviceName);
    if (serviceName && !searchObj.meta.serviceColors[serviceName]) {
      searchObj.meta.serviceColors[serviceName] = color;
    }
    return searchObj.meta.serviceColors[serviceName] ?? color;
  };

  const formatTracesMetaData = (traces: any[]): any[] => {
    if (!traces.length) return [];

    setServiceColors(traces);

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
        gen_ai_usage_input_tokens: trace.gen_ai_usage_input_tokens,
        gen_ai_usage_output_tokens: trace.gen_ai_usage_output_tokens,
        gen_ai_usage_total_tokens: trace.gen_ai_usage_total_tokens,
        gen_ai_usage_cost: trace.gen_ai_usage_cost,
        gen_ai_input_messages: trace.gen_ai_input_messages,
        // Unpriced tokens/models (AIO-16) — drive the partial-cost badge.
        gen_ai_unpriced_tokens: trace.gen_ai_unpriced_tokens,
        gen_ai_unpriced_models: trace.gen_ai_unpriced_models,
      };

      // Build per-trace service span count and duration map
      if (trace.service_name && Array.isArray(trace.service_name)) {
        trace.service_name.forEach((service: any) => {
          const serviceName = typeof service === "string" ? service : service.service_name;
          const serviceCount = typeof service === "string" ? 1 : service.count || 1;
          const serviceDuration = typeof service === "string" ? 0 : service.duration || 0;
          _trace.services[serviceName] = {
            count: serviceCount,
            duration: serviceDuration,
          };
        });
      }

      return _trace;
    });
  };

  /** Opens Logs on the correlated streams that hold this trace; "none" when no stream does, so the caller stays put. */
  const navigateToCorrelatedLogs = async (
    correlationProps: any,
  ): Promise<CorrelatedLogsOutcome> => {
    const spanId = searchObj.data.traceDetails.selectedSpanId;
    const traceId = searchObj.data.traceDetails.selectedTrace?.trace_id;

    const streamList: string[] = correlationProps.logStreams
      .map((s: any) => s.stream_name)
      .filter((name: string) => !isInternalLogStream(name));
    if (!streamList.length) return "none";

    // Conditions are keyed by semantic group, not by field name, so that two
    // streams aliasing one dimension (k8s_namespace_name vs
    // service_k8s_namespace_name) collapse into a single condition.
    const conditions = new Map<string, string>();

    const semanticGroups = await loadSemanticGroups();
    const fieldToGroupId = buildFieldToGroupIdMap(semanticGroups);

    const groupIdFor = (field: string) => fieldToGroupId.get(field.toLowerCase()) ?? field;
    const setCondition = (field: string, value: string) =>
      conditions.set(
        groupIdFor(field),
        `${quoteSqlIdentifierIfNeeded(field)} = ${quoteSqlLiteral(value)}`,
      );

    // A trace id alone pins the logs; dimension or span filters would drop rows lacking them.
    if (traceId) {
      setCondition(getTraceIdField(), traceId);
    } else {
      for (const streamInfo of correlationProps.logStreams) {
        const filters = streamInfo.filters ?? {};
        for (const [field, value] of Object.entries(filters)) {
          if (!value || value === SELECT_ALL_VALUE || field.startsWith("_")) continue;
          // First stream to claim a group wins.
          if (conditions.has(groupIdFor(field))) continue;
          setCondition(field, String(value));
        }
      }
      if (spanId) setCondition(getSpanIdField(), spanId);
    }

    const queryString = Array.from(conditions.values()).join(" and ");
    // A trace-wide lookup counts and opens on the trace's window, so Logs shows the logs the count found.
    const timeRange = traceId
      ? (correlationProps.traceTimeRange ?? correlationProps.timeRange)
      : correlationProps.timeRange;

    let navStreams = streamList;
    let probeFailure: CorrelatedLogsFailure | null = null;
    if (traceId) {
      // A stream that has not answered in time counts as having none, so a hung one cannot stall the click.
      const countTimeout = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        countTimeout.abort();
      }, VIEW_LOGS_COUNT_TIMEOUT_MS);
      const counts = await settleLimited(streamList, VIEW_LOGS_COUNT_CONCURRENCY, (name) =>
        searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql: `SELECT count(*) AS zo_count FROM ${quoteSqlIdentifierIfNeeded(name)} WHERE ${queryString}`,
              start_time: timeRange.startTime,
              end_time: timeRange.endTime,
              from: 0,
              size: 1,
            },
          },
          page_type: "logs",
          signal: countTimeout.signal,
        }),
      );
      clearTimeout(timer);
      // Only a positive count proves a stream holds the trace; a stream lacking trace_id answers 4xx.
      navStreams = streamList.filter((_, i) => holdsLogs(counts[i]));
      // A stream never checked may hold the trace, so with none found its failure is the answer, not "none".
      const serverError = counts
        .map((count) => probeServerError(count, timedOut))
        .find((error) => error !== null);
      if (serverError !== undefined) probeFailure = { failed: true, error: serverError };
    }

    // The user selected another span while this ran: do not navigate.
    if (searchObj.data.traceDetails.selectedSpanId !== spanId) return "moved";
    if (!navStreams.length) return probeFailure ?? "none";

    const encodedQuery = b64EncodeUnicode(queryString);
    const streamNames = navStreams.join(",");

    store.dispatch("logs/setIsInitialized", false);
    await nextTick();

    router.push({
      path: "/logs",
      query: {
        stream: streamNames,
        sql_mode: "false",
        query: encodedQuery,
        from: String(timeRange.startTime),
        to: String(timeRange.endTime),
        stream_type: "logs",
        org_identifier: store.state.selectedOrganization.identifier,
        type: "trace_explorer",
        quick_mode: "false",
        show_histogram: "true",
      },
    });
    return "opened";
  };

  return {
    searchObj,
    resetSearchObj,
    updatedLocalLogFilterField,
    loadLocalLogFilterField,
    getUrlQueryParams,
    applyUrlListState,
    patchUrlViewState,
    syncUrlViewState,
    copyTracesUrl,
    buildQueryDetails,
    navigateToLogs,
    navigateToCorrelatedLogs,
    tracesShareURL,
    formatTracesMetaData,
    setServiceColors,
    getOrSetServiceColor,
    tracesParser,
    loadTracesParser,
  };
};

export default useTraces;
