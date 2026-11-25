// Copyright 2026 OpenObserve Inc.

import { computed, onMounted, ref, watch, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import useStreams from "@/composables/useStreams";
import useNotifications from "@/composables/useNotifications";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import { applyPromqlSeed, metricsStreamsOf } from "@/utils/dashboard/promqlSeed";
import { pickDashboardPanelStream } from "@/utils/streamPersist";
import { isAutoSeededQuery } from "@/utils/metrics/metricPanelSeed";
import { buildTypeFilterBuckets } from "@/utils/metrics/metricFamily";
import { BADGE_LABEL_KEYS, getBadgeStyle } from "@/utils/metrics/metricPalette";
import type { StreamOption } from "../fieldPanel.types";
import type { DashboardPanelState, DashboardStreamResult } from "./dashboardPanelState";

// Pages whose stream select is the user's own choice, so the list loads with no stream picked yet.
const STREAM_LIST_WITHOUT_STREAM = new Set(["metrics", "build"]);

export interface DashboardStreamPickerOptions {
  panel: DashboardPanelState;
  pageKey: string;
  editMode: boolean;
  promqlMode: ComputedRef<boolean>;
  fetchPromQLLabels: (stream: string) => unknown;
}

interface StreamTracking {
  stream: string | null | undefined;
  streamType: string | null | undefined;
}

export function useDashboardStreamPicker(options: DashboardStreamPickerOptions) {
  const { panel, pageKey } = options;
  const store = useStore();
  const { t } = useI18nTyped();
  const { getStreams } = useStreams(t);
  const { showErrorNotification } = useNotifications();
  const { parsePromQlQuery } = usePromqlSuggestions();
  const { isDark } = useTheme();

  const currentQuery = () => panel.data.queries?.[panel.layout.currentQueryIndex];
  const currentFields = () => currentQuery()?.fields;

  const streamType = computed<string>(() => currentFields()?.stream_type ?? "");
  const currentStream = computed<string>(() => currentFields()?.stream ?? "");
  const selectedStreams = computed(() => (currentStream.value ? [currentStream.value] : []));

  // Only a dashboard panel searches an enrichment table over its whole lifetime, so only it offers one.
  const streamTypes = computed(() => [
    "logs",
    "metrics",
    "traces",
    ...(pageKey === "dashboard" ? ["enrichment_tables"] : []),
  ]);

  // Keyed by the type-filter bucket id, which drives both the badge letter and its colour.
  const metricTypeBuckets = computed<Record<string, string>>(() =>
    streamType.value === "metrics"
      ? buildTypeFilterBuckets(panel.meta.stream.streamResults ?? [])
      : {},
  );

  const streams = computed<StreamOption[]>(() =>
    (panel.meta.stream.streamResults ?? []).map((stream) => {
      const bucket = metricTypeBuckets.value[stream.name];
      const type = bucket ? t(BADGE_LABEL_KEYS[bucket] ?? "metrics.badge.other") : undefined;
      return {
        label: raw(stream.name),
        value: stream.name,
        badge: type ? type.charAt(0).toUpperCase() : undefined,
        badgeTitle: type,
        badgeStyle: bucket ? getBadgeStyle(bucket, isDark.value) : undefined,
      };
    }),
  );

  const streamsLoading = ref(false);

  let initialStreamsLoaded = false;
  // Loads overlap when the type changes mid-fetch, so only the latest one may touch the list or the spinner.
  let streamsRequest = 0;

  const loadStreamsListBasedOnType = async () => {
    initialStreamsLoaded = true;
    const request = ++streamsRequest;
    const type = currentFields()?.stream_type ?? "";
    streamsLoading.value = true;
    try {
      const res = (await getStreams(type, false)) as { list: DashboardStreamResult[] };
      // A list that lands after the type moved on belongs to the old type.
      if (request !== streamsRequest || type !== currentFields()?.stream_type) return;
      panel.meta.stream.streamResults = res.list;
      panel.meta.stream.streamResultsType = type;
    } catch {
      if (request === streamsRequest) {
        showErrorNotification(t("logStream.errorWhileFetchingStreams"));
      }
    } finally {
      if (request === streamsRequest) streamsLoading.value = false;
    }
  };

  watch(
    () => currentFields()?.stream_type,
    () => {
      if (!initialStreamsLoaded) return;
      loadStreamsListBasedOnType();
    },
  );

  // Armed on mount with `immediate`: a parent that seeds the stream in its own onMounted runs before this setup.
  const loadOnceStreamKnown = () => {
    let loaded = false;
    let stop: (() => void) | undefined;
    const onStream = (streamName: string | undefined) => {
      if (loaded) return;
      // In edit mode the panel data lands late, so the list waits for a stream unless the select is the user's own.
      if (!streamName && !STREAM_LIST_WITHOUT_STREAM.has(pageKey)) return;
      loaded = true;
      stop?.();
      loadStreamsListBasedOnType();
    };
    stop = watch(() => currentFields()?.stream, onStream, { immediate: true });
    // The immediate pass ran before the stop handle existed.
    if (loaded) stop();
  };

  onMounted(() => {
    if (options.editMode) loadOnceStreamKnown();
    else loadStreamsListBasedOnType();
  });

  const defaultStreamFor = (type: string) => {
    const results = panel.meta.stream.streamResults ?? [];
    if (pageKey !== "dashboard" || options.editMode) return results[0]?.name;
    return pickDashboardPanelStream(store.state.selectedOrganization?.identifier, type, results);
  };

  // A remembered or freshest stream replaces one the loaded list does not hold.
  watch(
    () => [
      currentFields()?.stream_type,
      panel.meta.stream.streamResults,
      panel.meta.stream.streamResultsType,
    ],
    () => {
      const fields = currentFields();
      if (!fields) return;
      const results = panel.meta.stream.streamResults ?? [];
      if (!results.length || panel.meta.stream.streamResultsType !== fields.stream_type) return;
      if (results.some((stream) => stream.name === fields.stream)) return;
      fields.stream = defaultStreamFor(fields.stream_type) ?? "";
    },
  );

  const reseedPromql = () => {
    const query = currentQuery();
    if (!query) return;
    let metricName: string | undefined;
    try {
      metricName = parsePromQlQuery(query.query ?? "")?.metricName ?? undefined;
    } catch (error) {
      console.error("Failed to parse PromQL query:", error);
    }
    const streamName = query.fields.stream;
    if (!streamName) {
      console.warn("Cannot update query: stream name is undefined");
      return;
    }
    // Only a query this editor generated is replaced; a hand-written one stays as the user left it.
    if (!metricName || metricName !== streamName) {
      const seedOpts = { chartType: panel.data.type, requireBuilder: !query.customQuery };
      if (isAutoSeededQuery(query.query, metricName, metricsStreamsOf(panel), seedOpts)) {
        applyPromqlSeed(panel, streamName, { previousStream: metricName });
      }
    }
    options.fetchPromQLLabels(String(streamName));
  };

  const tracking: Record<number, StreamTracking> = {};
  panel.data.queries.forEach((query, index) => {
    tracking[index] = {
      stream: query?.fields?.stream || null,
      streamType: query?.fields?.stream_type || null,
    };
  });

  // A dashboard's builder PromQL query is regenerated by the query builder, so only custom and metrics-page queries are reseeded here.
  const onStreamChange = () => {
    const index = panel.layout.currentQueryIndex;
    const fields = currentFields();
    const previous = tracking[index];
    tracking[index] = { stream: fields?.stream, streamType: fields?.stream_type };
    if (!previous) return;
    if (previous.stream === fields?.stream && previous.streamType === fields?.stream_type) return;
    if (!fields) return;
    const known = panel.meta.stream.streamResults.some(
      (stream) => stream.name === fields.stream && stream.stream_type === fields.stream_type,
    );
    if (!known || fields.stream_type !== panel.meta.stream.streamResultsType) return;
    const reseed =
      options.promqlMode.value &&
      (pageKey === "metrics" || (pageKey === "dashboard" && currentQuery()?.customQuery === true));
    if (!reseed) return;
    try {
      reseedPromql();
    } catch (error) {
      const message = (error as Error)?.message;
      showErrorNotification(
        message ? raw(message) : t("dashboard.addSettingVariable.failedToGetStreamFields"),
      );
    }
  };

  watch(
    () => [
      panel.meta.stream.streamResults,
      panel.meta.stream.streamResultsType,
      currentFields()?.stream,
      currentFields()?.stream_type,
      panel.layout.currentQueryIndex,
    ],
    onStreamChange,
  );

  const selectStreams = (names: string[]) => {
    const fields = currentFields();
    if (fields) fields.stream = names[0] ?? "";
  };

  // The old stream belongs to the old type, so it is cleared before its schema is fetched under the new one.
  const changeStreamType = (type: string) => {
    const fields = currentFields();
    if (!fields) return;
    fields.stream = "";
    fields.stream_type = type;
  };

  return {
    streams,
    streamsLoading,
    selectedStreams,
    streamType,
    streamTypes,
    selectStreams,
    changeStreamType,
  };
}
