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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { gt, raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { podTrendQuery } from "./kubernetesQueries";
import {
  formatBytes,
  formatCores,
  formatPct,
  type Amount,
  type ContainerRow,
  type PodRow,
} from "./kubernetesModel";
import { resolvePodLogs } from "./podLogsLink";

interface ResourceRow {
  id: "cpu" | "memory";
  label: I18nText;
  usage: string;
  request: I18nText;
  limit: I18nText;
  pctRequest: string;
  pctLimit: string;
}

interface Trend {
  id: "cpu" | "memory";
  label: I18nText;
  points: (number | null)[];
  summary: I18nText;
}

const props = defineProps<{
  target: [string, string, string];
  pod: PodRow | null;
  range: { start: number; end: number };
  orgId: string;
  multiCluster: boolean;
  usageStreams: { cpu: boolean; memory: boolean };
  // A deep link opens before the inventory loads; "not found" must wait for it.
  pending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "filter-node": [row: PodRow];
  "filter-owner": [row: PodRow];
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
// useStreams injects the store, which only works during setup, never inside a click handler.
const streamsApi = useStreams(gt);

const dash = raw("—");
const text = (value: string | null | undefined) => (value ? raw(value) : dash);

const subTitle = computed(() => raw(`${props.target[1]} · ${props.target[0] || "—"}`));

const rangeText = computed(() => {
  const format = (us: number) =>
    timestampToTimezoneDate(
      Math.floor(us / 1000),
      store.state.timezone ?? "UTC",
      "yyyy-MM-dd HH:mm",
    );
  return raw(`${format(props.range.start)} – ${format(props.range.end)}`);
});

const amount = (value: Amount, format: (v: number | null) => string, missing: I18nText) => {
  if (value === "missing") return missing;
  return raw(format(value));
};

const resources = computed<ResourceRow[]>(() => {
  const pod = props.pod;
  return [
    {
      id: "cpu",
      label: t("infra.k8s2.columnCpu"),
      usage: formatCores(pod?.cpuCores ?? null),
      request: amount(pod?.cpuRequest ?? null, formatCores, t("infra.k8s2.noRequest")),
      limit: amount(pod?.cpuLimit ?? null, formatCores, t("infra.k8s2.noLimit")),
      pctRequest: formatPct(pod?.cpuPctOfRequest ?? null),
      pctLimit: formatPct(pod?.cpuPctOfLimit ?? null),
    },
    {
      id: "memory",
      label: t("infra.k8s2.trendMemory"),
      usage: formatBytes(pod?.memoryBytes ?? null),
      request: amount(pod?.memoryRequest ?? null, formatBytes, t("infra.k8s2.noRequest")),
      limit: amount(pod?.memoryLimit ?? null, formatBytes, t("infra.k8s2.noLimit")),
      pctRequest: formatPct(pod?.memoryPctOfRequest ?? null),
      pctLimit: formatPct(pod?.memoryPctOfLimit ?? null),
    },
  ];
});

const resourceColumns = computed<OTableColumnDef<ResourceRow>[]>(() => [
  { id: "label", header: raw(""), accessorKey: "label" },
  { id: "usage", header: t("infra.k8s2.resourceUsage"), accessorKey: "usage" },
  { id: "request", header: t("infra.k8s2.resourceRequest"), accessorKey: "request" },
  { id: "limit", header: t("infra.k8s2.resourceLimit"), accessorKey: "limit" },
  { id: "pctRequest", header: t("infra.k8s2.resourcePctRequest"), accessorKey: "pctRequest" },
  { id: "pctLimit", header: t("infra.k8s2.resourcePctLimit"), accessorKey: "pctLimit" },
]);

const optionalCores = (v: number | null) => (v == null ? dash : raw(formatCores(v)));
const optionalBytes = (v: number | null) => (v == null ? dash : raw(formatBytes(v)));

const containerColumns = computed<OTableColumnDef<ContainerRow>[]>(() => [
  { id: "name", header: t("infra.k8s2.containerName"), accessorKey: "name" },
  {
    id: "waiting",
    header: t("infra.k8s2.factWaiting"),
    accessorFn: (row) => text(row.waitingReason),
  },
  {
    id: "lastTerminated",
    header: t("infra.k8s2.factLastTermination"),
    accessorFn: (row) => text(row.lastTerminatedReason),
  },
  {
    id: "restarts",
    header: t("infra.k8s2.columnRestarts"),
    accessorFn: (row) => (row.restarts == null ? dash : raw(String(row.restarts))),
  },
  {
    id: "cpu",
    header: t("infra.k8s2.columnCpu"),
    accessorFn: (row) => raw(`${optionalCores(row.cpuRequest)} / ${optionalCores(row.cpuLimit)}`),
  },
  {
    id: "memory",
    header: t("infra.k8s2.columnMemory"),
    accessorFn: (row) =>
      raw(`${optionalBytes(row.memoryRequest)} / ${optionalBytes(row.memoryLimit)}`),
  },
]);

const trends = ref<Trend[]>([]);

// Bumped on every pod or range change so a slow response never paints the previous pod.
let trendGeneration = 0;

const loadTrends = async () => {
  const gen = ++trendGeneration;
  trends.value = [];
  const pod = props.pod;
  if (!pod?.usage) return;
  const target = {
    clusterLabel: pod.usage.clusterLabel,
    cluster: pod.cluster,
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.usage.uid,
  };
  const wanted = [
    { id: "cpu" as const, metric: "k8s_pod_cpu_usage", on: props.usageStreams.cpu },
    { id: "memory" as const, metric: "k8s_pod_memory_working_set", on: props.usageStreams.memory },
  ].filter((w) => w.on);
  const settled = await Promise.allSettled(
    wanted.map((w) =>
      searchService.metrics_query_range({
        org_identifier: props.orgId,
        query: podTrendQuery(w.metric, target),
        start_time: props.range.start,
        end_time: props.range.end,
        step: "0",
      }),
    ),
  );
  if (gen !== trendGeneration) return;
  trends.value = wanted.map((w, i) => {
    const outcome = settled[i];
    const values: any[] =
      outcome.status === "fulfilled" ? (outcome.value?.data?.data?.result?.[0]?.values ?? []) : [];
    const points = values.map((v) => {
      const n = Number(v?.[1]);
      return Number.isFinite(n) ? n : null;
    });
    const numbers = points.filter((p): p is number => p != null);
    const format = w.id === "cpu" ? formatCores : formatBytes;
    return {
      id: w.id,
      label: w.id === "cpu" ? t("infra.k8s2.trendCpu") : t("infra.k8s2.trendMemory"),
      points,
      summary: t("infra.k8s2.trendSummary", {
        current: format(numbers.at(-1) ?? null),
        peak: format(numbers.length ? Math.max(...numbers) : null),
      }),
    };
  });
};

watch(
  () => [
    props.pod?.key,
    props.pod?.usage?.uid,
    props.pod?.usage == null,
    props.range.start,
    props.range.end,
  ],
  () => void loadTrends(),
  { immediate: true },
);

const logsBusy = ref(false);

const viewLogs = async () => {
  if (logsBusy.value) return;
  const [cluster, namespace, pod] = props.target;
  logsBusy.value = true;
  const link = await resolvePodLogs(
    { cluster, namespace, pod },
    {
      orgId: props.orgId,
      start: props.range.start,
      end: props.range.end,
      multiCluster: props.multiCluster,
    },
    streamsApi,
  ).finally(() => (logsBusy.value = false));
  if (!link) {
    toast({ variant: "warning", message: t("infra.k8s2.logsNoStream") });
    return;
  }
  if (link.warnNoClusterField) {
    toast({ variant: "warning", message: t("infra.k8s2.logsNoClusterField") });
  }
  // Logs restores its previous session from the store while initialized, ignoring these params.
  store.dispatch("logs/setIsInitialized", false);
  router.push(link.route);
};
</script>

<template>
  <ODrawer
    :open="true"
    side="right"
    size="xl"
    :title="raw(target[2])"
    :sub-title="subTitle"
    data-test="k8s2-pod-drawer"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <div v-if="!pod" class="flex justify-center py-6">
      <OSpinner v-if="pending" size="md" data-test="k8s2-drawer-pending" />
      <OText v-else variant="meta" data-test="k8s2-drawer-not-found">{{
        t("infra.k8s2.podNotFound")
      }}</OText>
    </div>
    <div v-else class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-2">
        <OTag v-if="pod?.status" :variant="pod.status.variant" size="sm">{{
          raw(pod.status.text)
        }}</OTag>
        <span v-else>{{ dash }}</span>
        <OText variant="meta" data-test="k8s2-drawer-range">{{ rangeText }}</OText>
      </div>

      <ODescriptionList dense>
        <ODescriptionItem :label="t('infra.k8s2.factPhase')">{{
          text(pod?.phase)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factReady')">{{
          text(pod?.ready)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factWaiting')">{{
          text(pod?.waitingReason)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factLastTermination')">{{
          text(pod?.lastTerminatedReason)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factRestarts')">{{
          pod?.restarts == null ? dash : raw(String(pod.restarts))
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factNode')">
          <OButton
            v-if="pod?.node"
            variant="ghost-primary"
            size="xs"
            data-test="k8s2-drawer-node-link"
            @click="emit('filter-node', pod)"
            >{{ raw(pod.node) }}</OButton
          >
          <template v-else>{{ dash }}</template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.factOwner')">
          <OButton
            v-if="pod?.owner"
            variant="ghost-primary"
            size="xs"
            data-test="k8s2-drawer-owner-link"
            @click="emit('filter-owner', pod)"
            >{{ raw(`${pod.owner.kind}/${pod.owner.name}`) }}</OButton
          >
          <template v-else>{{ dash }}</template>
        </ODescriptionItem>
      </ODescriptionList>

      <section class="flex flex-col gap-2">
        <OText tag="h3" class="text-sm font-semibold">{{ t("infra.k8s2.sectionResources") }}</OText>
        <OTable
          :data="resources"
          :columns="resourceColumns"
          row-key="id"
          pagination="none"
          dense
          :show-global-filter="false"
          data-test="k8s2-drawer-resources"
        />
      </section>

      <section class="flex flex-col gap-2">
        <OText tag="h3" class="text-sm font-semibold">{{
          t("infra.k8s2.sectionContainers")
        }}</OText>
        <OTable
          :data="pod?.containers ?? []"
          :columns="containerColumns"
          row-key="name"
          pagination="none"
          dense
          :show-global-filter="false"
          data-test="k8s2-drawer-containers"
        />
      </section>

      <section class="flex flex-col gap-2">
        <OText tag="h3" class="text-sm font-semibold">{{ t("infra.k8s2.sectionTrends") }}</OText>
        <OText v-if="!pod?.usage" variant="meta" data-test="k8s2-drawer-no-usage">{{
          t("infra.k8s2.noUsageData")
        }}</OText>
        <div
          v-for="trend in trends"
          :key="trend.id"
          class="flex flex-col gap-1"
          :data-test="`k8s2-drawer-trend-${trend.id}`"
        >
          <div class="flex items-baseline justify-between gap-2">
            <OText variant="label">{{ trend.label }}</OText>
            <OText variant="meta" class="tabular-nums">{{ trend.summary }}</OText>
          </div>
          <OSparkline size="sm" :points="trend.points" :aria-label="trend.label" />
        </div>
      </section>

      <div>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="article"
          data-test="k8s2-drawer-view-logs"
          :loading="logsBusy"
          :disabled="logsBusy"
          @click="viewLogs"
          >{{ t("infra.k8s2.viewLogs") }}</OButton
        >
      </div>
    </div>
  </ODrawer>
</template>
