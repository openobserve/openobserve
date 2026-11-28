<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- Top traces: the traces that hold the most of the run's profile samples (profile -> trace). Shown only when the stream has a trace_id column; the list is queried when it is opened. -->
<template>
  <section
    v-if="hasTraceColumn"
    class="bg-surface-panel border-border-default rounded-default shrink-0 border"
    data-test="profiles-top-traces"
  >
    <header class="flex items-center gap-2 px-3 py-1.5 text-sm">
      <OButton
        variant="ghost"
        size="xs"
        :icon-left="expanded ? 'keyboard-arrow-down' : 'chevron-right'"
        :aria-expanded="expanded"
        :aria-controls="expanded ? panelId : undefined"
        data-test="profiles-top-traces-toggle"
        @click="expanded = !expanded"
      >
        <span class="font-semibold">{{ t("profiles.topTraces") }}</span>
      </OButton>
      <span class="text-text-secondary min-w-0 truncate text-xs">{{
        t("profiles.topTracesHint")
      }}</span>
    </header>
    <div v-if="expanded" :id="panelId" class="border-border-default border-t">
      <div
        v-if="loading"
        class="flex flex-col gap-1.5 p-3"
        role="status"
        :aria-label="t('common.loading')"
        data-test="profiles-top-traces-loading"
      >
        <OSkeleton v-for="n in 3" :key="n" type="rect" class="rounded-default h-5 w-full" />
      </div>
      <div
        v-else-if="errorMessage"
        class="flex items-center gap-2 px-3 py-2 text-xs"
        role="alert"
        data-test="profiles-top-traces-error"
      >
        <span class="text-status-error-text min-w-0 break-words">{{ errorMessage }}</span>
        <OButton
          variant="outline"
          size="sm"
          data-test="profiles-top-traces-retry"
          @click="loadTraces"
          >{{ t("emptyState.loadError.action") }}</OButton
        >
      </div>
      <div
        v-else-if="!rows.length"
        class="text-text-secondary px-3 py-2 text-xs"
        role="status"
        data-test="profiles-top-traces-empty"
      >
        {{ t("profiles.topTracesEmpty") }}
      </div>
      <ul
        v-else
        class="max-h-44 overflow-y-auto py-1"
        tabindex="0"
        :aria-label="t('profiles.topTraces')"
        data-test="profiles-top-traces-list"
      >
        <li
          v-for="(row, index) in rows"
          :key="row.traceId"
          class="flex items-center gap-2 px-3 py-0.5 text-xs"
          :data-test="`profiles-top-trace-${index}`"
        >
          <span
            class="text-text-body min-w-0 font-mono"
            :title="row.traceId"
            aria-hidden="true"
            :data-test="`profiles-top-trace-${index}-id`"
            >{{ shortTraceId(row.traceId) }}</span
          >
          <!-- The full id for assistive technology, which does not read a title. -->
          <span class="sr-only" :data-test="`profiles-top-trace-${index}-id-full`">{{
            row.traceId
          }}</span>
          <OButton
            variant="ghost"
            size="icon-chip"
            icon-left="content-copy"
            :aria-label="t('profiles.copyTraceId', { id: shortTraceId(row.traceId) })"
            :data-test="`profiles-top-trace-${index}-copy`"
            @click="copyTraceId(row.traceId)"
          />
          <span
            class="text-text-secondary ms-auto font-mono tabular-nums"
            :data-test="`profiles-top-trace-${index}-total`"
            >{{ shareText(row.total) }}{{ valueFormatter(row.total) }}</span
          >
          <OButton
            v-if="canOpenTrace"
            variant="ghost"
            size="xs"
            icon-left="open-in-new"
            :aria-label="t('profiles.openTraceFor', { id: shortTraceId(row.traceId) })"
            :data-test="`profiles-top-trace-${index}-open`"
            @click="openTrace(row)"
            >{{ t("profiles.openTrace") }}</OButton
          >
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import searchService from "@/services/search";
import { streamNameListQuery, streamSchemaQuery } from "@/services/stream.queries";
import { queryClient } from "@/composables/query/queryClient";
import { useLicenseLock } from "@/composables/useFeatureLock";
import type { ProfileFilter } from "@/services/profiles";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";
import { formatPercent } from "./format";
import {
  TOP_TRACES_LIMIT,
  buildTopTracesSql,
  isIncompleteSearchResponse,
  openTraceLocation,
  parseTopTraceRows,
  requestRange,
  shortTraceId,
  type TimeRange,
  type TopTraceRow,
} from "./traceLink";

const props = withDefaults(
  defineProps<{
    orgIdentifier: string;
    stream: string;
    profileType: string;
    profileUnit?: string;
    service?: string | null;
    filters: ProfileFilter[];
    /** The window the user chose; the trace-filter padding is added here, the same as for the page's other queries. */
    range: TimeRange;
    /** All samples of the run on screen, for each trace's share; 0 hides the share. Changes together with `revision`. */
    grandTotal: number;
    /** Counts the completed runs. A run with the same inputs still has new data, so it asks for a new list. */
    revision: number;
    /** False while the run on screen has no trace links (inuse_*): the list is not queried. */
    active?: boolean;
    valueFormatter: (value: number) => string;
  }>(),
  { active: true },
);
// Kept by the page, so the list stays open across runs and across the remounts a run can cause.
const expanded = defineModel<boolean>("expanded", { default: false });

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const panelId = `profiles-top-traces-${useId()}`;

const hasTraceColumn = ref(false);
const loading = ref(false);
const errorMessage = ref("");
const rows = ref<TopTraceRow[]>([]);
// The run's total at the time the rows were read, so a share never mixes two runs.
const rowsGrandTotal = ref(0);
// Set only when the org has exactly one user traces stream; the Open trace action needs a single target.
const tracesStream = ref<string | null>(null);
let schemaSeq = 0;
// The run revision the last schema check was made for, so a negative answer is re-checked once per run.
let schemaRevision = -1;
// The schema read in flight, with the revision it was started for. `fetchQuery` joins a read already running,
// so a check for a newer revision can receive the answer of an older read.
let schemaRead: { org: string; stream: string; revision: number } | null = null;
// Set by a real collapsed -> expanded change, consumed by the next visible run of the list watcher.
let freshOpen = expanded.value;
let loadSeq = 0;
let streamSeq = 0;
// The org whose lookup found its one traces stream, and the org whose lookup found none or several.
let tracesStreamOrg = "";
let tracesStreamNegativeOrg = "";
let cached: { key: string; rows: TopTraceRow[]; grandTotal: number } | null = null;
// The search of the load on screen. Aborted when it is superseded, hidden or unmounted: an abandoned
// search keeps its work-group slot on the server until it finishes.
let controller: AbortController | null = null;

// The same license and menu gates as the Logs "View Trace" action (useViewTraceAction), but not its
// `service_streams_enabled` gate. Logs hides View Trace when service streams are on (the default)
// because its log-row detail offers "View Related" instead, which reaches the trace through
// correlation. This list has no such replacement, and each row links straight to the trace_id route,
// which works whether or not service streams are enabled; hiding it would remove the only profile ->
// trace link.
const { locked: tracesLocked } = useLicenseLock("traces");
const tracesMenuHidden = computed(() => {
  // `hiddenMenus` is an array until MainLayout has read `custom_hide_menus`, then a Set.
  const hidden: Set<string> | string[] | undefined = store.state.hiddenMenus;
  return Array.isArray(hidden) ? hidden.includes("traces") : Boolean(hidden?.has("traces"));
});
const canOpenTrace = computed(
  () => !!tracesStream.value && !tracesMenuHidden.value && !tracesLocked.value,
);

const buildErrorMessage = (error: unknown): string => {
  const err = error as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.message ||
    t("profiles.errors.loadFailed")
  );
};

const shareText = (total: number) =>
  rowsGrandTotal.value > 0 ? `${formatPercent(total, rowsGrandTotal.value)} · ` : "";

// Drops the load in flight (its answer is stale from now on) and frees its server slot.
const cancelLoad = () => {
  loadSeq += 1;
  controller?.abort();
  controller = null;
  loading.value = false;
};

const resetList = () => {
  cancelLoad();
  errorMessage.value = "";
  rows.value = [];
  rowsGrandTotal.value = 0;
  cached = null;
};

const fieldsOf = (schema: any): { name: string }[] => schema?.schema ?? schema?.fields ?? [];
const hasTraceId = (schema: any) => fieldsOf(schema).some((field) => field.name === "trace_id");

// A cached schema without trace_id is not trusted: trace-linked profiles may have been ingested since,
// so it is read again (staleTime 0). A cached schema with the column is served from the cache.
const fetchHasTraceColumn = async (org: string, stream: string): Promise<boolean> => {
  const options = streamSchemaQuery(org, stream, "profiles");
  const known = queryClient.getQueryData(options.queryKey);
  const schema = await queryClient.fetchQuery(
    known !== undefined && !hasTraceId(known) ? { ...options, staleTime: 0 } : options,
  );
  return hasTraceId(schema);
};

// A new stream starts from "unknown" (`reset`); a re-check of a negative answer keeps the state as it is.
const detectTraceColumn = async (reset = true) => {
  const seq = ++schemaSeq;
  const org = props.orgIdentifier;
  const stream = props.stream;
  schemaRevision = props.revision;
  if (reset) {
    hasTraceColumn.value = false;
    resetList();
  }
  const revision = props.revision;
  const joined =
    schemaRead && schemaRead.org === org && schemaRead.stream === stream ? schemaRead : null;
  const own = joined ? null : { org, stream, revision };
  if (own) schemaRead = own;
  try {
    let found = await fetchHasTraceColumn(org, stream);
    // A negative answer of a read started for an older revision may predate this run's data: read once more.
    if (!found && joined && joined.revision < revision && seq === schemaSeq) {
      found = await fetchHasTraceColumn(org, stream);
    }
    if (seq !== schemaSeq || org !== props.orgIdentifier || stream !== props.stream) return;
    hasTraceColumn.value = found;
  } catch {
    if (seq === schemaSeq) hasTraceColumn.value = false;
  } finally {
    if (own && schemaRead === own) schemaRead = null;
  }
};

// Runs beside the list query and never blocks it: the list shows without the Open trace action until this answers.
// A found stream is kept for the org. An answer of none or several is asked again on the next open (`fresh`,
// skipping the cached list too), so a traces stream created meanwhile is found.
const resolveTracesStream = async (fresh = false) => {
  const org = props.orgIdentifier;
  if (tracesMenuHidden.value || tracesLocked.value) return;
  if (tracesStreamOrg === org || (!fresh && tracesStreamNegativeOrg === org)) return;
  const seq = ++streamSeq;
  try {
    const options = streamNameListQuery(org, "traces");
    const list: Record<string, unknown>[] = await queryClient.fetchQuery(
      fresh ? { ...options, staleTime: 0 } : options,
    );
    if (seq !== streamSeq || org !== props.orgIdentifier) return;
    // Internal streams (`_`-prefixed) are not trace targets, as in the Logs action's picker.
    const names = (Array.isArray(list) ? list : [])
      .map((item) => String(item.name ?? item.stream_name ?? ""))
      .filter((name) => name && !name.startsWith("_"));
    // With several streams the trace could be in any of them; the action stays hidden rather than guess.
    tracesStream.value = names.length === 1 ? names[0] : null;
    if (tracesStream.value) tracesStreamOrg = org;
    else tracesStreamNegativeOrg = org;
  } catch {
    // Without a known traces stream the action stays hidden. Marked like an answer of none, so the list does
    // not retry on every run while open; the fresh lookup on the next open bypasses the mark.
    if (seq === streamSeq) {
      tracesStream.value = null;
      tracesStreamNegativeOrg = org;
    }
  }
};

const loadTraces = async () => {
  if (!hasTraceColumn.value) return;
  // The previous search, if still running, is superseded.
  controller?.abort();
  const searchController = new AbortController();
  controller = searchController;
  const seq = ++loadSeq;
  const key = loadKey.value;
  // The total and the rows both belong to the run on screen now, whatever arrives later.
  const grandTotal = props.grandTotal;
  loading.value = true;
  errorMessage.value = "";
  const span = requestRange(props.range, props.filters);
  try {
    // use_cache=false (the fourth argument). In the OSS build the result cache already skips this query:
    // its `MIN(_timestamp) AS first_ts` is not an alias of `_timestamp`, so no timestamp column is found
    // (cacher.rs get_ts_col_order_by:638-664) and check_cache returns early for a GROUP BY query
    // (cacher.rs:136). The cache otherwise keys on the SQL text and serves any overlapping earlier window
    // (cacher.rs:421-439), and the Enterprise build picks its timestamp column elsewhere (cache_ts_util), so a
    // same-window rerun must not depend on that: it has to read the data as it is now.
    const response = await searchService.search(
      {
        org_identifier: props.orgIdentifier,
        query: {
          query: {
            sql: buildTopTracesSql({
              stream: props.stream,
              profileType: props.profileType,
              profileUnit: props.profileUnit,
              service: props.service,
              filters: props.filters,
            }),
            start_time: span.startTime,
            end_time: span.endTime,
            from: 0,
            size: TOP_TRACES_LIMIT,
          },
        },
        page_type: "profiles",
        signal: searchController.signal,
      },
      "ui",
      false,
      false,
    );
    if (seq !== loadSeq) return;
    if (isIncompleteSearchResponse(response?.data)) {
      throw new Error(t("profiles.topTracesIncomplete"));
    }
    rows.value = parseTopTraceRows(response?.data?.hits ?? []);
    rowsGrandTotal.value = grandTotal;
    cached = { key, rows: rows.value, grandTotal };
  } catch (error) {
    // Superseded, hidden or unmounted: our own abort is not a failure.
    if (seq !== loadSeq || searchController.signal.aborted) return;
    rows.value = [];
    cached = null;
    errorMessage.value = buildErrorMessage(error);
  } finally {
    if (seq === loadSeq) loading.value = false;
    if (controller === searchController) controller = null;
  }
};

const copyTraceId = (traceId: string) =>
  copyToClipboard(traceId, t, { successMessage: t("common.copiedToClipboard") });

const openTrace = (row: TopTraceRow) => {
  if (!canOpenTrace.value || !tracesStream.value) return;
  router.push(openTraceLocation(props.orgIdentifier, tracesStream.value, row));
};

// A new stream may or may not have a trace_id column; a new org has its own traces streams.
watch(
  () => [props.orgIdentifier, props.stream],
  () => detectTraceColumn(),
  { immediate: true },
);
watch(
  () => props.orgIdentifier,
  () => {
    streamSeq += 1;
    tracesStream.value = null;
    tracesStreamOrg = "";
    tracesStreamNegativeOrg = "";
  },
);
// The component stays mounted across runs, so a "no trace_id column" answer (or a failed schema call) must
// not stick: when it is eligible again, or a new run of an eligible type completes, read the schema again,
// at most once per run revision (while a run without trace links is on screen the re-read is skipped).
watch([() => props.active, () => props.revision], () => {
  if (props.active && !hasTraceColumn.value && schemaRevision !== props.revision) {
    void detectTraceColumn(false);
  }
});

// What the list answers: the run's inputs and which run it is. The revision matters because two runs of
// identical inputs can read different data; an unchanged key is served from the last result.
const loadKey = computed(() =>
  JSON.stringify([
    props.orgIdentifier,
    props.stream,
    props.profileType,
    props.profileUnit,
    props.service,
    props.filters,
    props.range,
    props.revision,
  ]),
);
// Only a real collapsed -> expanded change asks for a fresh traces-stream lookup, not `active` or the
// column answer arriving while the list is already open.
watch(expanded, (open) => {
  freshOpen = open;
});
// The list follows the run on screen, but is only queried while it is open.
watch(
  [() => expanded.value && hasTraceColumn.value && props.active, loadKey],
  ([visible, key]) => {
    if (!visible) {
      cancelLoad();
      return;
    }
    // Opening the list asks for the traces stream again if the last answer was none or several.
    const fresh = freshOpen;
    freshOpen = false;
    void resolveTracesStream(fresh);
    if (cached?.key === key) {
      // A search for another key may still be running; its answer is stale now.
      cancelLoad();
      rows.value = cached.rows;
      rowsGrandTotal.value = cached.grandTotal;
      errorMessage.value = "";
      loading.value = false;
      return;
    }
    loadTraces();
  },
  { immediate: true },
);

onBeforeUnmount(cancelLoad);
</script>
