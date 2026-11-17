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

<!-- Uses the sidebar's correlation service, so it is locked without that license. -->
<template>
  <div
    v-if="!access.allowed"
    class="border-border-default flex h-7 shrink-0 items-center border-t text-xs"
    data-test="trace-lanes-locked"
  >
    <div
      class="text-text-secondary flex shrink-0 items-center gap-1 px-2"
      :style="{ width: labelWidth + 'px' }"
    >
      <OIcon name="lock" size="xs" class="text-warning-600" />
      {{ t("requestTimeline.logsAndMetrics") }}
    </div>
    <button
      type="button"
      class="text-text-link min-w-0 flex-1 truncate px-2 text-start hover:underline"
      @click="openUpgradeDialog"
    >
      {{ t("requestTimeline.locked") }}
    </button>
  </div>
  <div v-else-if="lanes.length" class="shrink-0" data-test="trace-lanes">
    <div
      v-for="lane in lanes"
      :key="lane.key"
      class="border-border-default text-2xs flex h-6 items-center border-t"
      :data-test="`trace-lane-${lane.kind}`"
    >
      <OTruncatedText
        class="text-text-secondary shrink-0 px-2"
        :style="{ width: labelWidth + 'px' }"
      >
        {{ lane.label }}
      </OTruncatedText>
      <div class="relative h-full" :style="{ width: `calc(100% - ${labelWidth}px)` }">
        <template v-if="lane.kind === 'logs'">
          <button
            v-for="(tick, i) in lane.ticks.filter((tick) => inAxis(tick.atUs))"
            :key="i"
            type="button"
            class="absolute top-1 bottom-1 w-0.5 -translate-x-1/2 p-0"
            :class="tick.color ? '' : 'bg-text-secondary'"
            :style="{ left: pct(tick.atUs) + '%', backgroundColor: tick.color || undefined }"
            :title="tick.text"
            :aria-label="tick.text"
            data-test="trace-lane-log-tick"
            @click="emit('open-logs', { spanId: tick.spanId, timestampUs: tick.atUs })"
          />
        </template>
        <template v-else-if="lane.kind === 'pod'">
          <div
            class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full opacity-60"
            :class="POD_BAR[lane.state]"
          />
          <!-- The restart estimate can sit in the pad after the spans: pin it to the axis edge. -->
          <div
            v-if="lane.atUs !== null && props.axisDurationUs > 0"
            class="bg-text-heading ring-surface-base absolute top-0 bottom-0 w-0.5 -translate-x-1/2 ring-1"
            :style="{ left: clampedPct(lane.atUs) + '%' }"
            data-test="trace-lane-pod-restart"
          />
          <span
            class="bg-surface-base text-text-body absolute end-1 top-1/2 -translate-y-1/2 px-1"
            :data-test="`trace-lane-pod-${lane.state}`"
            >{{ t(POD_LABEL[lane.state]) }}</span
          >
        </template>
        <template v-else>
          <svg
            class="text-theme-accent absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              :points="polyline(lane)"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <span
            class="bg-surface-base text-text-body absolute end-1 top-1/2 -translate-y-1/2 px-1"
            >{{ t("requestTimeline.metricMax", { value: formatLargeNumber(lane.max) }) }}</span
          >
        </template>
      </div>
    </div>
  </div>
  <div
    v-else-if="status !== 'idle' && status !== 'loading'"
    class="border-border-default text-2xs text-text-secondary flex h-6 shrink-0 items-center border-t"
    :data-test="`trace-lanes-${status}`"
  >
    <div class="shrink-0 px-2" :style="{ width: labelWidth + 'px' }">
      {{ t("requestTimeline.logsAndMetrics") }}
    </div>
    <span class="min-w-0 flex-1 truncate px-2">
      {{ t(status === "failed" ? "requestTimeline.lanesFailed" : "requestTimeline.lanesEmpty") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import searchService from "@/services/search";
import type { StreamInfo } from "@/services/service_streams";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { buildSqlCondition, quoteSqlIdentifier } from "@/utils/telemetryCorrelation";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  resolveLogSeverity,
  severityIndicatorColor,
  SEVERITY_MESSAGE_FIELDS,
} from "@/utils/logs/statusParser";
import { escapeLabel, queryText } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";
import { parseVector } from "@/views/Infrastructure/kubernetes2/kubernetesModel";
import { formatLargeNumber } from "@/utils/zincutils";
import { spanTimeBounds } from "./threadView.utils";
import {
  criticalPathServices,
  firstRestartUs,
  spanPod,
  type CriticalService,
  type PodState,
} from "./timeAttribution";

interface LogTick {
  atUs: number;
  color: string;
  text: string;
  spanId: string;
}

type Lane =
  | { kind: "logs"; key: string; label: I18nText; ticks: LogTick[] }
  | { kind: "pod"; key: string; label: I18nText; pod: string; state: PodState; atUs: number | null }
  | { kind: "metric"; key: string; label: I18nText; points: [number, number][]; max: number };

const props = defineProps<{
  /** Spans whose services and pods the lanes cover; their bounds are the data window. */
  spans: any[];
  streamName: string;
  axisStartUs: number;
  axisDurationUs: number;
  labelWidth: number;
}>();
const emit = defineEmits<{
  (e: "open-logs", payload: { spanId: string; timestampUs: number }): void;
  (e: "pod-state", payload: { pod: string; state: PodState }): void;
}>();

const MAX_SERVICES = 3;
const MAX_PODS = 2;
// Split between oldest and newest lines so a busy trace shows ticks at both ends.
const LOG_LINES = 200;
// Restart counters are scraped every 15–60 s, so look a minute past the spans.
const POD_PAD_US = 60_000_000;
// A fixed metric per span type so a lane reads the same on every trace.
const LANE_METRICS = {
  db: ["postgresql_database_locks", "postgresql_backends"],
  service: ["k8s_pod_memory_working_set", "k8s_pod_cpu_usage"],
} as const;

const POD_BAR: Record<PodState, string> = {
  healthy: "bg-success-600",
  restarted: "bg-warning-600",
  oomKilled: "bg-error-600",
};
const POD_LABEL: Record<PodState, I18nKey> = {
  healthy: "requestTimeline.podHealthy",
  restarted: "requestTimeline.podRestarted",
  oomKilled: "requestTimeline.podOomKilled",
};

const { t } = useI18nTyped();
const store = useStore();
const access = useLockedAffordance("correlation");
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
const { findRelatedTelemetry } = useServiceCorrelation();

const lanes = ref<Lane[]>([]);
/** idle: nothing to load; empty / failed: loaded with no lane (failed: a query errored). */
const status = ref<"idle" | "loading" | "ready" | "empty" | "failed">("idle");
const org = () => store.state.selectedOrganization.identifier;

const pct = (us: number) => ((us - props.axisStartUs) / props.axisDurationUs) * 100;
const inAxis = (us: number) => props.axisDurationUs > 0 && pct(us) >= 0 && pct(us) <= 100;
const clampedPct = (us: number) => Math.min(100, Math.max(0, pct(us)));

function polyline(lane: Extract<Lane, { kind: "metric" }>) {
  return lane.points
    .map(([atUs, value]) => `${pct(atUs)},${95 - (lane.max ? value / lane.max : 0) * 90}`)
    .join(" ");
}

/** A stream's filters as `field = value` pairs, wildcards and internal fields dropped. */
const filterPairs = (stream: StreamInfo) =>
  Object.entries(stream.filters ?? {}).filter(
    ([field, value]) => value && value !== SELECT_ALL_VALUE && !field.startsWith("_"),
  );

const correlate = (span: any, onFail: () => void) =>
  findRelatedTelemetry(
    { timestamp: Number(span.start_time), fields: { ...span }, streamName: props.streamName },
    "traces",
    5,
    props.streamName,
  )
    .then((result) => result?.correlationData ?? null)
    .catch(() => {
      onFail();
      return null;
    });

type Correlated = { service: CriticalService; data: Awaited<ReturnType<typeof correlate>> };

async function loadLogs(correlated: Correlated[], from: number, to: number, onFail: () => void) {
  const ts = store.state.zoConfig.timestamp_column || "_timestamp";
  const seen = new Set<string>();
  const queries = correlated.flatMap(({ service, data }) =>
    (data?.related_streams.logs ?? [])
      .filter((stream) => {
        const key = stream.stream_name + JSON.stringify(stream.filters ?? {});
        // A stream with no filters would bring every log line of the window.
        if (seen.has(key) || !filterPairs(stream).length) return false;
        seen.add(key);
        return true;
      })
      .map((stream) => ({ service, stream })),
  );
  if (!queries.length) return null;

  const pages = await Promise.all(
    queries.flatMap(({ service, stream }) => {
      const where = filterPairs(stream).map(([field, value]) => buildSqlCondition(field, value));
      return (["ASC", "DESC"] as const).map((order) => {
        const sql = `SELECT * FROM ${quoteSqlIdentifier(stream.stream_name)} WHERE ${where.join(" AND ")} ORDER BY ${quoteSqlIdentifier(ts)} ${order}`;
        return searchService
          .search({
            org_identifier: org(),
            query: {
              query: { sql, start_time: from, end_time: to, from: 0, size: LOG_LINES / 2 },
            },
            page_type: "logs",
          })
          .then((res) =>
            (res?.data?.hits ?? []).map((hit: any): LogTick => {
              const severity = resolveLogSeverity(hit);
              const line = SEVERITY_MESSAGE_FIELDS.map((f) => hit[f]).find(Boolean) ?? "";
              return {
                atUs: Number(hit[ts]),
                color: severity.level === "unknown" ? "" : severityIndicatorColor(severity),
                text: `${service.service} ${line}`,
                spanId: String(service.span.span_id),
              };
            }),
          )
          .catch(() => {
            onFail();
            return [] as LogTick[];
          });
      });
    }),
  );
  // A short window returns the same lines from both ends.
  const byLine = new Map<string, LogTick>();
  for (const tick of pages.flat()) byLine.set(`${tick.atUs}\u0000${tick.text}`, tick);
  const ticks = [...byLine.values()];
  if (!ticks.length) return null;
  const services = [...new Set(queries.map(({ service }) => service.service))].join(", ");
  return {
    kind: "logs",
    key: "logs",
    label: t("requestTimeline.logsLane", { services }),
    ticks,
  } satisfies Lane;
}

async function loadMetric(
  { service, data }: Correlated,
  from: number,
  to: number,
  onFail: () => void,
) {
  const metrics = data?.related_streams.metrics ?? [];
  const type = service.span.db_system || service.span.db_system_name ? "db" : "service";
  const stream = LANE_METRICS[type]
    .map((name) => metrics.find((m) => m.stream_name === name))
    .find(Boolean);
  if (!stream) return null;
  const labels = filterPairs(stream)
    .map(([label, value]) => `${label}="${escapeLabel(value)}"`)
    .join(",");
  try {
    const res = await searchService.metrics_query_range({
      org_identifier: org(),
      query: `max(${stream.stream_name}{${labels}})`,
      start_time: from,
      end_time: to,
      step: `${Math.max(1, Math.ceil((to - from) / 30_000_000))}s`,
    });
    const points = (res?.data?.data?.result?.[0]?.values ?? [])
      .map(([sec, value]: [number, string]) => [Number(sec) * 1_000_000, Number(value)])
      .filter(([, value]: number[]) => Number.isFinite(value)) as [number, number][];
    if (!points.length) return null;
    return {
      kind: "metric",
      key: `metric-${service.service}`,
      label: raw(`${service.service} ${stream.stream_name}`),
      points,
      max: Math.max(...points.map(([, value]) => value)),
    } satisfies Lane;
  } catch {
    onFail();
    return null;
  }
}

/** Healthy, restarted or OOMKilled from kube-state-metrics, the data the Kubernetes pages read. */
async function loadPod(pod: string, from: number, to: number, onFail: () => void) {
  const matchers = {
    ksm: `pod="${escapeLabel(pod)}"`,
    kubelet: `k8s_pod_name="${escapeLabel(pod)}"`,
  };
  try {
    const [restarts, reasons] = await Promise.all([
      searchService.metrics_query_range({
        org_identifier: org(),
        query: queryText("P7", matchers),
        start_time: from - POD_PAD_US,
        end_time: to + POD_PAD_US,
        step: "15s",
      }),
      searchService.metrics_query({
        org_identifier: org(),
        query: encodeURIComponent(queryText("P3", matchers)),
        end_time: to + POD_PAD_US,
      }),
    ]);
    const series = restarts?.data?.data?.result ?? [];
    if (!series.length) return null;
    const atUs = firstRestartUs(series, from, to + POD_PAD_US);
    const oom = parseVector(reasons).some((s) => s.metric.reason === "OOMKilled");
    const state: PodState = atUs === null ? "healthy" : oom ? "oomKilled" : "restarted";
    return {
      kind: "pod",
      key: `pod-${pod}`,
      label: t("requestTimeline.podLane", { pod }),
      pod,
      state,
      atUs,
    } satisfies Lane;
  } catch {
    onFail();
    return null;
  }
}

let generation = 0;

async function load() {
  const current = ++generation;
  lanes.value = [];
  status.value = "idle";
  const bounds = spanTimeBounds(props.spans);
  if (!access.value.allowed || !bounds || !props.streamName) return;
  status.value = "loading";
  let failed = false;
  const onFail = () => {
    failed = true;
  };
  const from = Math.floor(bounds.startNs / 1000);
  const to = Math.ceil(bounds.endNs / 1000);
  const services = criticalPathServices(props.spans).slice(0, MAX_SERVICES);
  // Pods of the busiest services first, so a step's lane shows the pod that held its time.
  const pods = [...new Set([...services.map((s) => spanPod(s.span)), ...props.spans.map(spanPod)])]
    .filter(Boolean)
    .slice(0, MAX_PODS);

  const [correlated, podLanes] = await Promise.all([
    Promise.all(
      services.map((service) =>
        correlate(service.span, onFail).then((data) => ({ service, data })),
      ),
    ),
    Promise.all(pods.map((pod) => loadPod(pod, from, to, onFail))),
  ]);
  const [logLane, metricLanes] = await Promise.all([
    loadLogs(correlated, from, to + 1, onFail),
    Promise.all(correlated.map((c) => loadMetric(c, from, to, onFail))),
  ]);
  if (current !== generation) return;
  lanes.value = [logLane, ...podLanes, ...metricLanes].filter((lane): lane is Lane => !!lane);
  status.value = lanes.value.length ? "ready" : failed ? "failed" : "empty";
  for (const lane of podLanes) if (lane) emit("pod-state", { pod: lane.pod, state: lane.state });
}

// Load More appends spans; the first span id and count say the set changed.
const loadKey = computed(
  () =>
    `${props.streamName}|${access.value.allowed}|${props.spans.length}|${props.spans[0]?.span_id ?? ""}`,
);
watch(loadKey, load, { immediate: true });
</script>
