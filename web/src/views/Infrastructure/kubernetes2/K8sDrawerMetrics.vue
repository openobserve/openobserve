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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { escapeLabel, podMatchers, regexEscape } from "./kubernetesQueries";
import {
  promqlPanelSchema,
  type MarkLine,
  type PanelArgs,
  type PanelQuery,
} from "./kubernetesPanels";
import { encodeDetails, type DetailsRef } from "./kubernetesUrlState";
import {
  membersOf,
  type AnyRow,
  type Inventory,
  type PodRow,
  type SeriesMatcher,
} from "./kubernetesModel";

interface Tab {
  id: string;
  label: I18nText;
  // Every stream the tab reads; the tab is dropped when one is absent.
  streams: string[];
  unit: PanelArgs["unit"];
  queries: PanelQuery[];
  markLines?: MarkLine[];
}

interface PodMarks {
  cpu: MarkLine[];
  memory: MarkLine[];
}

interface PodMatchers {
  cpu: string;
  memory: string;
  other: string;
}

type ClusterLabel = "k8s_cluster" | "k8s_cluster_name";

const props = defineProps<{
  details: DetailsRef;
  row: AnyRow;
  inventory: Inventory;
  range: { start: number; end: number };
  refreshNonce: number;
  hasStream: (stream: string) => boolean;
}>();

const { t } = useI18nTyped();

const POD_STREAMS = {
  cpu: "k8s_pod_cpu_usage",
  memory: "k8s_pod_memory_working_set",
  network: "k8s_pod_network_io",
  filesystem: "k8s_pod_filesystem_usage",
};

const ALLOCATABLE = "kube_node_status_allocatable";

const q = (value: string) => `"${escapeLabel(value)}"`;

const NO_MARKS: PodMarks = { cpu: [], memory: [] };

const podTabs = (m: PodMatchers, marks: PodMarks = NO_MARKS): Tab[] => [
  {
    id: "cpu",
    label: t("infra.k8s2.columnCpu"),
    streams: [POD_STREAMS.cpu],
    unit: null,
    queries: [{ query: `sum(${POD_STREAMS.cpu}{${m.cpu}})`, stream: POD_STREAMS.cpu }],
    markLines: marks.cpu,
  },
  {
    id: "memory",
    label: t("infra.k8s2.columnMemory"),
    streams: [POD_STREAMS.memory],
    unit: "bytes",
    queries: [{ query: `sum(${POD_STREAMS.memory}{${m.memory}})`, stream: POD_STREAMS.memory }],
    markLines: marks.memory,
  },
  {
    id: "network",
    label: t("infra.k8s2.drawerNetwork"),
    streams: [POD_STREAMS.network],
    unit: "bps",
    queries: [
      {
        query: `sum by (direction) (rate(${POD_STREAMS.network}{${m.other}}[5m]))`,
        stream: POD_STREAMS.network,
        legend: "{direction}",
      },
    ],
  },
  {
    id: "filesystem",
    label: t("infra.k8s2.drawerFilesystem"),
    streams: [POD_STREAMS.filesystem],
    unit: "bytes",
    queries: [
      { query: `sum(${POD_STREAMS.filesystem}{${m.other}})`, stream: POD_STREAMS.filesystem },
    ],
  },
];

// A total is honest only when every pod reports it, so one gap drops the line.
const summed = (pods: PodRow[], pick: (pod: PodRow) => PodRow["cpuRequest"]) => {
  if (!pods.length) return null;
  let sum = 0;
  for (const pod of pods) {
    const value = pick(pod);
    if (typeof value !== "number") return null;
    sum += value;
  }
  return sum > 0 ? sum : null;
};

const marksOf = (pods: PodRow[]): PodMarks => {
  const lines = (
    request: (pod: PodRow) => PodRow["cpuRequest"],
    limit: (pod: PodRow) => PodRow["cpuRequest"],
  ): MarkLine[] => {
    const out: MarkLine[] = [];
    const req = summed(pods, request);
    const lim = summed(pods, limit);
    if (req != null) out.push({ name: String(t("infra.k8s2.drawerRequest")), value: req });
    if (lim != null) out.push({ name: String(t("infra.k8s2.drawerLimit")), value: lim });
    return out;
  };
  return {
    cpu: lines(
      (p) => p.cpuRequest,
      (p) => p.cpuLimit,
    ),
    memory: lines(
      (p) => p.memoryRequest,
      (p) => p.memoryLimit,
    ),
  };
};

const podTarget = (pod: PodRow, matcher: SeriesMatcher | null) =>
  podMatchers({
    clusterLabel: matcher?.clusterLabel ?? "k8s_cluster",
    cluster: pod.cluster,
    namespace: pod.namespace,
    pod: pod.name,
    uid: matcher?.uid ?? null,
  });

// The kubeletstats cluster label as these pods' usage series spelled it.
const labelOf = (pods: PodRow[]): ClusterLabel =>
  pods.map((p) => p.series.cpu?.clusterLabel ?? p.series.memory?.clusterLabel).find(Boolean) ??
  "k8s_cluster";

const sameFor = (matcher: string): PodMatchers => ({
  cpu: matcher,
  memory: matcher,
  other: matcher,
});

const nodeTabs = (row: Extract<AnyRow, { kind: "node" }>): Tab[] => {
  const n = `${row.clusterLabel ?? "k8s_cluster"}=${q(row.cluster)},k8s_node_name=${q(row.name)}`;
  const k = `k8s_cluster=${q(row.cluster)},node=${q(row.name)}`;
  const usage = t("infra.k8s2.resourceUsage");
  const allocatable = (resource: string): PanelQuery => ({
    query: `sum(${ALLOCATABLE}{${k},resource="${resource}"})`,
    stream: ALLOCATABLE,
    legend: t("infra.k8s2.drawerAllocatable"),
  });
  const node = (metric: string) => ({
    query: `sum(${metric}{${n}})`,
    stream: metric,
    legend: usage,
  });
  return [
    {
      id: "cpu",
      label: t("infra.k8s2.columnCpu"),
      streams: ["k8s_node_cpu_usage"],
      unit: null,
      queries: [node("k8s_node_cpu_usage"), allocatable("cpu")],
    },
    {
      id: "memory",
      label: t("infra.k8s2.columnMemory"),
      streams: ["k8s_node_memory_working_set"],
      unit: "bytes",
      queries: [node("k8s_node_memory_working_set"), allocatable("memory")],
    },
    {
      id: "disk",
      label: t("infra.k8s2.drawerDisk"),
      streams: ["k8s_node_filesystem_usage"],
      unit: "bytes",
      queries: [
        node("k8s_node_filesystem_usage"),
        {
          query: `sum(k8s_node_filesystem_capacity{${n}})`,
          stream: "k8s_node_filesystem_capacity",
          legend: t("infra.k8s2.drawerCapacity"),
        },
      ],
    },
    {
      id: "pods",
      label: t("infra.k8s2.columnPods"),
      streams: ["kube_pod_info"],
      unit: null,
      queries: [
        {
          query: `count(kube_pod_info{${k}})`,
          stream: "kube_pod_info",
          legend: t("infra.k8s2.columnPods"),
        },
        allocatable("pods"),
      ],
    },
  ];
};

const pvcTabs = (row: Extract<AnyRow, { kind: "pvc" }>): Tab[] => {
  const pods = props.inventory.pods.filter(
    (p) => p.cluster === row.cluster && p.namespace === row.namespace && row.pods?.includes(p.name),
  );
  const m = `${labelOf(pods)}=${q(row.cluster)},k8s_persistentvolumeclaim_name=${q(row.name)},k8s_namespace_name=${q(row.namespace)}`;
  return [
    {
      id: "disk",
      label: t("infra.k8s2.drawerDisk"),
      streams: ["k8s_volume_capacity", "k8s_volume_available"],
      unit: "bytes",
      queries: [
        {
          query: `sum(k8s_volume_capacity{${m}}) - sum(k8s_volume_available{${m}})`,
          stream: "k8s_volume_capacity",
          legend: t("infra.k8s2.drawerUsed"),
        },
        {
          query: `sum(k8s_volume_capacity{${m}})`,
          stream: "k8s_volume_capacity",
          legend: t("infra.k8s2.drawerCapacity"),
        },
      ],
    },
  ];
};

const allTabs = computed<Tab[]>(() => {
  const row = props.row;
  switch (row.kind) {
    case "pod":
      return podTabs(
        {
          cpu: podTarget(row, row.series.cpu ?? row.series.memory),
          memory: podTarget(row, row.series.memory ?? row.series.cpu),
          other: podTarget(row, row.series.cpu ?? row.series.memory),
        },
        marksOf([row]),
      );
    case "node":
      return nodeTabs(row);
    case "namespace": {
      const pods = membersOf(props.inventory.pods, row);
      return podTabs(
        sameFor(`${labelOf(pods)}=${q(row.cluster)},k8s_namespace_name=${q(row.name)}`),
        marksOf(pods),
      );
    }
    case "pvc":
      return pvcTabs(row);
    case "cronjob":
    case "hpa":
      return [];
    default: {
      const pods = membersOf(props.inventory.pods, row);
      if (!pods.length) return [];
      const names = escapeLabel(pods.map((p) => regexEscape(p.name)).join("|"));
      return podTabs(
        sameFor(
          `${labelOf(pods)}=${q(row.cluster)},k8s_namespace_name=${q(row.namespace)},k8s_pod_name=~"${names}"`,
        ),
        marksOf(pods),
      );
    }
  }
});

const tabs = computed(() => allTabs.value.filter((tab) => tab.streams.every(props.hasStream)));

const missing = computed(() => allTabs.value.filter((tab) => !tabs.value.includes(tab)));

const unavailable = computed(() => {
  if (!missing.value.length) return null;
  const streams = [
    ...new Set(missing.value.flatMap((tab) => tab.streams.filter((s) => !props.hasStream(s)))),
  ];
  return t(
    "infra.k8s2.drawerMetricsUnavailable",
    {
      metrics: raw(missing.value.map((tab) => String(tab.label)).join(", ")),
      streams: raw(streams.join(", ")),
    },
    streams.length,
  );
});

const schemas = computed(() =>
  tabs.value.map((tab) => ({
    tab,
    schema: promqlPanelSchema({
      id: `k8s2-drawer-${tab.id}`,
      type: "area",
      unit: tab.unit,
      queries: tab.queries,
      markLines: tab.markLines,
    }),
  })),
);

const PRIMARY = ["cpu", "memory"];

const split = computed(() => {
  const primary = schemas.value.filter(({ tab }) => PRIMARY.includes(tab.id));
  if (!primary.length) return { primary: schemas.value, more: [] };
  return { primary, more: schemas.value.filter(({ tab }) => !PRIMARY.includes(tab.id)) };
});

const moreOpen = ref(false);
watch(
  () => encodeDetails(props.details),
  () => {
    moreOpen.value = false;
  },
);

// The dashboard engine reads these Dates as microsecond epochs, as DbmMetricPanel passes them.
const timeObj = computed(() => ({
  start_time: new Date(props.range.start),
  end_time: new Date(props.range.end),
}));

// A new object or Refresh remounts the renderers, so a late response never paints here.
const chartKey = (id: string) => `${encodeDetails(props.details)}|${id}|${props.refreshNonce}`;
</script>

<template>
  <div v-if="allTabs.length" class="flex flex-col gap-2" data-test="k8s2-drawer-section-metrics">
    <OText variant="card-title" as="h3" class="border-border-default border-b pb-1">{{
      t("infra.k8s2.drawerMetricsTitle")
    }}</OText>
    <div
      v-for="{ tab, schema } in split.primary"
      :key="tab.id"
      class="flex min-w-0 flex-col gap-1"
      :data-test="`k8s2-drawer-metric-${tab.id}`"
    >
      <OText variant="label" as="h4" :data-test="`k8s2-drawer-tab-${tab.id}`">{{
        tab.label
      }}</OText>
      <div class="h-36 min-w-0" :data-test="`k8s2-drawer-chart-${tab.id}`">
        <PanelSchemaRenderer
          :key="chartKey(tab.id)"
          :panel-schema="schema"
          :selected-time-obj="timeObj"
          :variables-data="{}"
          :force-load="true"
          search-type="ui"
        />
      </div>
    </div>
    <OCollapsible
      v-if="split.more.length"
      v-model="moreOpen"
      :label="t('infra.k8s2.drawerMoreMetrics')"
      data-test="k8s2-drawer-more-metrics"
    >
      <div v-if="moreOpen" class="flex flex-col gap-2">
        <div
          v-for="{ tab, schema } in split.more"
          :key="tab.id"
          class="flex min-w-0 flex-col gap-1"
          :data-test="`k8s2-drawer-metric-${tab.id}`"
        >
          <OText variant="label" as="h4" :data-test="`k8s2-drawer-tab-${tab.id}`">{{
            tab.label
          }}</OText>
          <div class="h-36 min-w-0" :data-test="`k8s2-drawer-chart-${tab.id}`">
            <PanelSchemaRenderer
              :key="chartKey(tab.id)"
              :panel-schema="schema"
              :selected-time-obj="timeObj"
              :variables-data="{}"
              :force-load="true"
              search-type="ui"
            />
          </div>
        </div>
      </div>
    </OCollapsible>
    <p
      v-if="unavailable"
      class="text-text-secondary flex items-start gap-1 text-xs"
      data-test="k8s2-drawer-metrics-unavailable"
    >
      <OIcon name="info" size="sm" class="mt-0.5 shrink-0" />
      <span>{{ unavailable }}</span>
    </p>
  </div>
</template>
