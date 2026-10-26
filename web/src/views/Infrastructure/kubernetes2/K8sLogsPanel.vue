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

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { gt, raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { resolvePodLogs, type PodLogsLink } from "./podLogsLink";
import type { DetailsRef } from "./kubernetesUrlState";
import {
  LOG_LINE_LIMIT,
  containersOf,
  filterLines,
  lineLevel,
  logsSql,
  parseLogHits,
  type LogLine,
} from "./k8sPodLogs";

const props = defineProps<{
  target: DetailsRef;
  orgId: string;
  // µs; an absolute (relative === false) range is a closed window, so it never tails.
  range: { start: number; end: number; relative?: boolean };
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
// useStreams injects the store, which only works during setup, never inside a click handler.
const streamsApi = useStreams(gt);

const POLL_MS = 5000;
const DAY_US = 24 * 60 * 60 * 1_000_000;
const PIN_TOLERANCE = 4;
const LEVEL_CLASS = { error: "text-status-error-text", warning: "text-status-warning-text" };

const levelClass = (text: string) => {
  const level = lineLevel(text);
  return level ? LEVEL_CLASS[level] : "text-text-body";
};

const lines = ref<LogLine[]>([]);
const link = ref<PodLogsLink | null>(null);
const loading = ref(true);
const failed = ref(false);
const container = ref<string | null>(null);
const previous = ref(false);
const timestamps = ref(true);
const query = ref("");
const absolute = computed(() => props.range.relative === false);
const live = ref(!absolute.value);
const scroller = ref<HTMLElement | null>(null);
let pinned = true;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let unresolved = false;

const visible = computed(() =>
  filterLines(lines.value, {
    query: query.value,
    container: container.value,
    previous: previous.value,
  }),
);

const atLimit = computed(() => lines.value.length >= LOG_LINE_LIMIT);
const hasRestarts = computed(() => lines.value.some((line) => line.restart > 0));

const containerOptions = computed(() => [
  { label: t("infra.k8s2.logsAllContainers"), value: null },
  ...containersOf(lines.value).map((name) => ({ label: raw(name), value: name })),
]);

const formatStamp = (ts: number, format: string) =>
  timestampToTimezoneDate(ts / 1000, store.state.timezone, format);

const showDate = computed(() => {
  if (props.range.end - props.range.start > DAY_US) return true;
  const all = lines.value;
  if (!all.length) return false;
  const day = (ts: number) => formatStamp(ts, "yyyy-MM-dd");
  return day(all[0].ts) !== day(all[all.length - 1].ts);
});

const stampOf = (line: LogLine) =>
  formatStamp(line.ts, showDate.value ? "yyyy-MM-dd HH:mm:ss.SSS" : "HH:mm:ss.SSS");

const onScroll = () => {
  const el = scroller.value;
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_TOLERANCE;
};

const pinToEnd = () => {
  const el = scroller.value;
  if (pinned && el) el.scrollTop = el.scrollHeight;
};

async function resolve() {
  const { cluster, namespace, name } = props.target;
  link.value = await resolvePodLogs(
    { cluster, namespace, pod: name },
    { orgId: props.orgId, start: props.range.start, end: props.range.end, multiCluster: false },
    streamsApi,
  );
}

async function fetchLines() {
  if (!link.value) return;
  const params = link.value.route.query;
  const stream = String(params.stream);
  const filter = String(params.query);
  // Uncached on purpose: this is a live tail, so a cached page would show stale lines.
  const res: any = await searchService.search(
    {
      org_identifier: props.orgId,
      query: {
        query: {
          sql: logsSql(stream, b64DecodeUnicodeSafe(filter)),
          start_time: props.range.start,
          end_time: absolute.value ? props.range.end : Date.now() * 1000,
          from: 0,
          size: LOG_LINE_LIMIT,
        },
      },
      page_type: "logs",
    },
    "ui",
  );
  lines.value = parseLogHits(res?.data?.hits ?? []);
}

async function load() {
  failed.value = false;
  inFlight = true;
  try {
    if (!link.value && !unresolved) {
      await resolve();
      unresolved = !link.value;
    }
    await fetchLines();
  } catch {
    failed.value = true;
  } finally {
    inFlight = false;
    loading.value = false;
    nextTick(pinToEnd);
  }
}

// Overlapping searches can land out of order and flash stale lines; a failed stream resolution is not retried until the target or range changes.
const poll = () => {
  if (!inFlight && !unresolved) load();
};

const startPolling = () => {
  stopPolling();
  if (live.value && !absolute.value) timer = setInterval(poll, POLL_MS);
};
const stopPolling = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

const openInLogs = () => {
  if (!link.value) {
    toast({ variant: "warning", message: t("infra.k8s2.logsNoStream") });
    return;
  }
  // Logs restores its previous session from the store while initialized, ignoring these params.
  store.dispatch("logs/setIsInitialized", false);
  router.push(link.value.route);
};

watch(live, startPolling);
watch(hasRestarts, (has) => {
  if (!has) previous.value = false;
});
watch(absolute, (closed) => {
  live.value = !closed;
});
watch(visible, () => nextTick(pinToEnd));
watch(
  [() => props.target, () => props.range.start, () => props.range.end, () => props.range.relative],
  () => {
    link.value = null;
    unresolved = false;
    lines.value = [];
    pinned = true;
    loading.value = true;
    load();
  },
);

onMounted(() => {
  load();
  startPolling();
});
onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="k8s2-logs-panel">
    <div
      class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"
    >
      <OSelect
        v-model="container"
        class="w-44"
        size="sm"
        :options="containerOptions"
        :aria-label="t('infra.k8s2.logsContainer')"
        data-test="k8s2-logs-container"
      />
      <OSwitch
        v-model="previous"
        size="sm"
        :disabled="!hasRestarts"
        :label="t('infra.k8s2.logsPrevious')"
        data-test="k8s2-logs-previous"
      />
      <OSwitch v-model="timestamps" size="sm" :label="t('infra.k8s2.logsTimestamps')" />
      <OSearchInput
        v-model="query"
        class="min-w-40 flex-1"
        size="sm"
        :placeholder="t('infra.k8s2.logsFilter')"
        data-test="k8s2-logs-filter"
      />
      <OButton
        variant="ghost"
        size="sm"
        class="gap-1.5"
        :aria-pressed="live"
        :disabled="absolute"
        data-test="k8s2-logs-live"
        @click="live = !live"
      >
        <span
          class="size-2 rounded-full"
          :class="live ? 'bg-status-success-text' : 'bg-status-neutral-text'"
          aria-hidden="true"
        />
        {{ live ? t("infra.k8s2.logsLive") : t("infra.k8s2.logsPaused") }}
      </OButton>
      <OText
        v-if="failed && lines.length"
        class="text-status-error-text text-xs"
        role="alert"
        data-test="k8s2-logs-poll-error"
      >
        {{ t("infra.k8s2.logsError") }}
      </OText>
      <OText class="text-text-secondary text-xs tabular-nums" data-test="k8s2-logs-count">
        {{
          atLimit
            ? t("infra.k8s2.logsLatestLines", { count: visible.length }, visible.length)
            : t("infra.k8s2.logsLines", { count: visible.length }, visible.length)
        }}
      </OText>
      <OButton
        variant="ghost-primary"
        size="sm"
        icon-right="arrow-forward"
        data-test="k8s2-logs-open"
        @click="openInLogs"
      >
        {{ t("infra.k8s2.logsOpenIn") }}
      </OButton>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <OSpinner size="md" data-test="k8s2-logs-loading" />
    </div>
    <OEmptyState
      v-else-if="failed && !lines.length"
      size="inline"
      preset="load-error"
      :title="t('infra.k8s2.logsError')"
      data-test="k8s2-logs-error"
      @action="load"
    />
    <OEmptyState
      v-else-if="!link"
      size="inline"
      preset="no-data"
      :title="t('infra.k8s2.logsNoStream')"
      data-test="k8s2-logs-nostream"
    />
    <OEmptyState
      v-else-if="!visible.length"
      size="inline"
      preset="no-data"
      :title="t('infra.k8s2.logsEmpty')"
      data-test="k8s2-logs-empty"
    />
    <div
      v-else
      ref="scroller"
      class="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs"
      data-test="k8s2-logs-scroller"
      @scroll="onScroll"
    >
      <div
        v-for="line in visible"
        :key="line.id"
        class="flex min-w-max gap-3 px-3 leading-5"
        data-test="k8s2-logs-line"
      >
        <span v-if="timestamps" class="text-text-secondary shrink-0 tabular-nums">{{
          raw(stampOf(line))
        }}</span>
        <span class="whitespace-pre" :class="levelClass(line.text)">{{ raw(line.text) }}</span>
      </div>
    </div>
  </div>
</template>
