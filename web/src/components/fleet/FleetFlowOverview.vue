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

<template>
  <div
    class="rounded-surface border-border-default bg-surface-base grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_16rem] overflow-hidden border max-lg:auto-rows-max max-lg:grid-cols-1 max-lg:overflow-y-auto"
    data-test="fleet-flow-overview"
  >
    <div
      class="border-border-default min-h-0 border-e max-lg:h-64 max-lg:border-e-0 max-lg:border-b"
    >
      <FleetFlowList
        v-model="checkedFleets"
        list-id="fleets"
        :title="t('fleet.pipelines.fleets')"
        :filter-placeholder="t('fleet.pipelines.filterFleets')"
        :items="fleetItems"
      />
    </div>

    <div
      class="flex min-h-0 flex-col"
      :class="expanded ? 'max-lg:h-dvh' : ''"
      data-test="fleet-flow-overview-map"
    >
      <div v-if="!forbidden" class="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3">
        <OToggleGroup
          :model-value="telemetry"
          mobile-dropdown
          data-test="fleet-flow-overview-telemetry"
          @update:model-value="(v) => (telemetry = v as FlowSignal)"
        >
          <OToggleGroupItem
            v-for="opt in telemetryOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
          >
            {{ opt.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="flex items-center gap-2">
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="flowQuery.lastUpdatedAt.value || null"
            :loading="flowQuery.fetching.value"
            data-test="fleet-flow-overview-refresh"
            @click="refresh"
          />
          <OToggleGroup
            :model-value="timeWindow"
            mobile-dropdown
            data-test="fleet-flow-overview-window"
            @update:model-value="(v) => (timeWindow = v as FlowWindow)"
          >
            <OToggleGroupItem v-for="w in windows" :key="w" :value="w" size="sm">
              {{ raw(w) }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OButton
            variant="outline"
            size="icon-sm"
            :icon-left="expanded ? 'close-fullscreen' : 'open-in-full'"
            :aria-label="expandLabel"
            data-test="fleet-flow-overview-expand"
            @click="expanded = !expanded"
          >
            <OTooltip side="bottom" :content="expandLabel" />
          </OButton>
        </div>
      </div>

      <OBanner
        v-if="loadError"
        class="mx-3 mb-3"
        variant="error"
        dense
        :content="t('fleet.pipelines.loadFailed')"
        data-test="fleet-flow-overview-error"
      >
        <template #actions>
          <OButton variant="outline" size="sm" data-test="fleet-flow-overview-retry" @click="retry">
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>

      <div ref="canvasEl" class="relative min-h-0 flex-1 max-lg:min-h-112">
        <div
          v-if="forbidden"
          class="absolute inset-0 grid place-items-center"
          data-test="fleet-flow-overview-forbidden"
        >
          <OEmptyState size="block" preset="no-access" />
        </div>

        <VueFlow
          v-if="canvasWidth && !forbidden"
          :id="flowId"
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="false"
          :nodes-focusable="false"
          :edges-focusable="false"
          :zoom-on-scroll="false"
          :min-zoom="0.5"
          :max-zoom="2"
          class="h-full w-full"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="selection = null"
          @nodes-initialized="resetViewport"
        >
          <Background
            :variant="BackgroundVariant.Dots"
            :gap="18"
            :size="1.2"
            :pattern-color="dotColor"
          />
          <template #node-fleet="nodeProps">
            <FleetFlowNode :id="nodeProps.id" :data="nodeProps.data" />
          </template>
          <template #node-sink>
            <div class="relative size-1">
              <Handle
                type="target"
                :position="Position.Left"
                :connectable="false"
                class="opacity-0"
              />
            </div>
          </template>
          <template #edge-fleet="edgeProps">
            <FleetFlowEdge v-bind="edgeProps" />
          </template>
        </VueFlow>

        <FleetFlowLegend
          v-if="canvasWidth && !forbidden"
          v-model="hiddenSeverities"
          class="absolute bottom-3 left-3 z-10"
          :counts="legendCounts"
        />

        <div
          v-if="canvasWidth && !forbidden"
          class="rounded-default border-border-default bg-surface-panel absolute right-3 bottom-3 z-10 flex flex-col overflow-hidden border"
          data-test="fleet-flow-overview-zoom"
        >
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="add"
            class="rounded-none"
            :aria-label="t('fleet.flow.zoomIn')"
            data-test="fleet-flow-overview-zoom-in"
            @click="zoomIn({ duration: 150 })"
          >
            <OTooltip side="left" :content="t('fleet.flow.zoomIn')" />
          </OButton>
          <OSeparator />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="remove"
            class="rounded-none"
            :aria-label="t('fleet.flow.zoomOut')"
            data-test="fleet-flow-overview-zoom-out"
            @click="zoomOut({ duration: 150 })"
          >
            <OTooltip side="left" :content="t('fleet.flow.zoomOut')" />
          </OButton>
          <OSeparator />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="fullscreen"
            class="rounded-none"
            :aria-label="t('fleet.flow.fitView')"
            data-test="fleet-flow-overview-fit"
            @click="fitView({ duration: 150, padding: 0.1 })"
          >
            <OTooltip side="left" :content="t('fleet.flow.fitView')" />
          </OButton>
        </div>

        <div
          v-if="details"
          ref="popoverEl"
          class="absolute top-0 left-0 z-20 [transform:var(--fleet-popover-at)] max-md:max-w-[calc(100%-1rem)]"
          :style="{ '--fleet-popover-at': `translate(${popover.x}px, ${popover.y}px)` }"
          data-test="fleet-flow-overview-popover"
        >
          <FleetFlowDetails
            :title="details.title"
            :throughput="details.throughput"
            :restricted="metricsRestricted"
            :issues="details.issues"
            :hide-config="!details.configId"
            :fleet-id="details.fleetId"
            class="max-h-112"
            @close="selection = null"
            @action="runAction"
            @open-config="details.configId && openConfig(details.configId)"
            @open-fleet="details.fleetId && emit('navigate', 'fleets', { fleet: details.fleetId })"
          />
        </div>

        <div
          v-if="noFleets"
          class="absolute inset-0 grid place-items-center"
          data-test="fleet-flow-overview-no-fleets"
        >
          <OEmptyState
            size="block"
            preset="no-data"
            :description="t('fleet.pipelines.noFleets')"
            hide-action
          />
        </div>
        <div
          v-else-if="!nodes.length && !loading && !loadError && !forbidden"
          class="absolute inset-0 grid place-items-center"
          data-test="fleet-flow-overview-empty"
        >
          <OEmptyState
            size="block"
            preset="no-data"
            :description="
              hiddenByLegend ? t('fleet.pipelines.hiddenByLegend') : t('fleet.pipelines.emptyHint')
            "
            hide-action
          />
        </div>

        <OInnerLoading :showing="loading" data-test="fleet-flow-overview-loading" />
      </div>
      <p
        v-if="!forbidden"
        class="text-text-secondary border-border-default shrink-0 border-t px-3 py-2 text-xs"
        data-test="fleet-flow-overview-note"
      >
        {{ t("fleet.pipelines.fanOutNote") }}
      </p>
    </div>

    <div
      class="border-border-default min-h-0 border-s max-lg:h-64 max-lg:border-s-0 max-lg:border-t"
    >
      <FleetFlowList
        v-model="checkedDestinations"
        list-id="destinations"
        :title="t('fleet.flow.destinations')"
        :filter-placeholder="t('fleet.flow.filterDestinations')"
        :items="destinationItems"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Handle,
  Position,
  VueFlow,
  useVueFlow,
  type Edge,
  type EdgeMouseEvent,
  type Node,
  type NodeMouseEvent,
} from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import { useRoute, useRouter } from "vue-router";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { FleetPipeline, FleetPipelineFleet } from "@/services/fleet";
import FleetFlowList, { type FlowListItem } from "./FleetFlowList.vue";
import FleetFlowNode from "./FleetFlowNode.vue";
import FleetFlowEdge from "./FleetFlowEdge.vue";
import FleetFlowLegend from "./FleetFlowLegend.vue";
import FleetFlowDetails from "./FleetFlowDetails.vue";
import type { FleetTab } from "./fleetRoute";
import {
  useFlowIssues,
  worstSeverity,
  percent,
  ratio,
  SEVERITY_ORDER,
  type IssueAction,
  type PathIssue,
  type PathSeverity,
} from "./flowIssues";
import type { FleetFlowEdgeData, FleetFlowNodeData, FlowSignal, FlowWindow } from "./flowTypes";
import { buildPipelineMap, strokeWidth, type MapEdge, type MapNode } from "./pipelineGraph";
import { formatCount } from "./fleetFormat";
import { useFleetFlow } from "./useFleetApi";

const emit = defineEmits<{
  navigate: [tab: FleetTab, query: Record<string, string>];
  outdated: [];
  refresh: [];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const PER_SECOND: Record<FlowSignal, I18nKey> = {
  all: "fleet.flow.perSecond.all",
  logs: "fleet.flow.perSecond.logs",
  metrics: "fleet.flow.perSecond.metrics",
  traces: "fleet.flow.perSecond.traces",
};

const DESTINATION_ICON: Record<string, IconName> = {
  otlphttp: "cloud-upload",
  otlp: "lan",
  kafka: "hub",
  awss3: "inventory-2",
};

const COLUMN_ICON: Record<string, IconName> = { f: "dns", r: "input", e: "send" };

// An exporter failing at least this share of its items, or a receiver refusing it, is rung like its issue.
const ISSUE_RATIO = 0.01;
const QUEUE_WARNING = 0.8;

const { t } = useI18nTyped();
const expandLabel = computed(() =>
  t(expanded.value ? "fleet.flow.collapseMap" : "fleet.flow.expandMap"),
);
const router = useRouter();
const route = useRoute();
const { fleetIssues, pipelineIssues, error: issuesError, refetch: refetchIssues } = useFlowIssues();

const worstOf = (list: PathSeverity[]): PathSeverity =>
  SEVERITY_ORDER.find((s) => list.includes(s)) ??
  (list.includes("restricted") ? "restricted" : "healthy");

const flowId = "fleet-flow-overview";
const { setViewport, zoomIn, zoomOut, fitView } = useVueFlow(flowId);
// SVG fill on the background dots, the one place a token is read by var().
const dotColor = "var(--color-border-strong)";
// Layout is in screen pixels at zoom 1: readable text beats fitting everything on screen.
const ROW = 104;
const TOP = 24;
const NODE_WIDTH = 144;
const POPOVER_GAP = 12;
const POPOVER_MARGIN = 8;
const canvasEl = ref<HTMLElement | null>(null);
const canvasWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

const telemetry = ref<FlowSignal>("all");
const timeWindow = ref<FlowWindow>("1h");
const windows: FlowWindow[] = ["5m", "1h", "24h"];
const telemetryOptions = computed(() => [
  { value: "all", label: t("fleet.flow.all") },
  { value: "logs", label: t("fleet.flow.logs") },
  { value: "metrics", label: t("fleet.flow.metrics") },
  { value: "traces", label: t("fleet.flow.traces") },
]);

const flowQuery = useFleetFlow(() => timeWindow.value);

const fleets = computed(() => flowQuery.flow.value?.fleets ?? []);
const fleetById = computed(() => new Map(fleets.value.map((f) => [f.id, f])));
const pipelines = computed(() => {
  const order = new Map(fleets.value.map((f, i) => [f.id, i]));
  return (flowQuery.flow.value?.pipelines ?? [])
    .filter((p) => order.has(p.fleet))
    .sort((a, b) => order.get(a.fleet)! - order.get(b.fleet)! || a.name.localeCompare(b.name));
});
const destinations = computed(() => {
  const used = new Set(pipelines.value.flatMap((p) => p.exporters.map((e) => e.destination)));
  return (flowQuery.flow.value?.destinations ?? []).filter((d) => used.has(d.id));
});

const forbidden = computed(() => flowQuery.forbidden.value);
const loadError = computed(
  () => !forbidden.value && !!(flowQuery.error.value || issuesError.value),
);
const loading = computed(() => !forbidden.value && flowQuery.loading.value);
const noFleets = computed(
  () => !forbidden.value && !loading.value && !loadError.value && fleets.value.length === 0,
);

function retry() {
  flowQuery.refetch();
  refetchIssues();
}

// The one refresh control on the page also reloads whatever the parent shows above the map.
function refresh() {
  retry();
  emit("refresh");
}

defineExpose({ refresh: retry });

// An empty selection is no filter: everything shows until something is ticked.
const checkedFleets = ref<string[]>([]);
const checkedDestinations = ref<string[]>([]);
const fleetShown = (id: string) => !checkedFleets.value.length || checkedFleets.value.includes(id);
const destinationShown = (id: string) =>
  !checkedDestinations.value.length || checkedDestinations.value.includes(id);
const hiddenSeverities = ref<PathSeverity[]>([]);
type Selection = { kind: "pipeline" | "fleet" | "node"; id: string };
const selection = ref<Selection | null>(null);
const popover = ref({ x: 0, y: 0 });
const popoverEl = ref<HTMLElement | null>(null);

// A null rate under restricted metrics means the user may not read it, not that nothing flowed.
const metricsRestricted = computed(() => !!flowQuery.flow.value?.metrics_restricted);

const perSecond = (rate: number | null, signal: FlowSignal = "all"): I18nText | null =>
  rate === null ? null : t(PER_SECOND[signal], { value: raw(formatCount(rate)) });

const rateText = (rate: number | null, signal: FlowSignal = "all"): I18nText =>
  perSecond(rate, signal) ??
  (metricsRestricted.value ? t("fleet.flow.metricsRestricted") : t("fleet.flow.noThroughputData"));

// Null only when every rate is null, so a measured zero still reads as zero.
function sumRates(rates: (number | null)[]): number | null {
  const known = rates.filter((r): r is number => r !== null);
  return known.length ? known.reduce((sum, r) => sum + r, 0) : null;
}

const destinationById = computed(
  () => new Map((flowQuery.flow.value?.destinations ?? []).map((d) => [d.id, d])),
);

// A destination without a target is fleet-scoped, so its fleet tells same-named exporters apart.
function destinationLabel(id: string): I18nText {
  const d = destinationById.value.get(id);
  if (d?.target) return raw(d.target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""));
  const fleet = pipelines.value.find((p) => p.exporters.some((e) => e.destination === id))?.fleet;
  return raw([d?.exporter, fleet && fleetName(fleet)].filter(Boolean).join(" · "));
}

const fleetName = (id: string) => fleetById.value.get(id)?.name ?? id;

function fleetMeta(f: FleetPipelineFleet | undefined): I18nText {
  const count = f?.collectors ?? 0;
  return f?.version != null
    ? t("fleet.pipelines.fleetMeta", { version: f.version, count }, count)
    : t("fleet.pipelines.fleetMetaNoVersion", { count }, count);
}

const fleetIssueMap = computed(() =>
  Object.fromEntries(fleets.value.map((f) => [f.id, fleetIssues(f.id)])),
);
const issuesOf = (p: FleetPipeline): PathIssue[] => [
  ...(fleetIssueMap.value[p.fleet] ?? []),
  ...pipelineIssues(p, destinationLabel),
];
const severityOf = computed<Record<string, PathSeverity>>(() =>
  Object.fromEntries(
    pipelines.value.map((p) => {
      const severity = worstSeverity(issuesOf(p));
      return [p.id, severity === "healthy" && metricsRestricted.value ? "restricted" : severity];
    }),
  ),
);

const scoped = computed(() =>
  pipelines.value.filter(
    (p) =>
      fleetShown(p.fleet) &&
      (telemetry.value === "all" || p.signal === telemetry.value) &&
      (!p.exporters.length || p.exporters.some((e) => destinationShown(e.destination))),
  ),
);

const legendCounts = computed(() =>
  scoped.value.reduce<Partial<Record<PathSeverity, number>>>((acc, p) => {
    const sev = severityOf.value[p.id];
    acc[sev] = (acc[sev] ?? 0) + 1;
    return acc;
  }, {}),
);

const visible = computed(() =>
  scoped.value.filter((p) => !hiddenSeverities.value.includes(severityOf.value[p.id])),
);
const hiddenByLegend = computed(() => scoped.value.length > 0 && visible.value.length === 0);

const fleetRate = (id: string) =>
  sumRates(pipelines.value.filter((p) => p.fleet === id).map((p) => p.out_rate));

// A fleet's own failure, such as a halted rollout, says more about it than its throughput.
function fleetLabel(id: string): I18nText {
  const failure = (fleetIssueMap.value[id] ?? []).find((i) => i.severity === "error");
  return failure?.title ?? rateText(fleetRate(id));
}

const fleetItems = computed<FlowListItem[]>(() =>
  fleets.value.map((f) => ({
    id: f.id,
    label: raw(f.name),
    rate: fleetLabel(f.id),
    value: fleetRate(f.id) ?? -1,
    dot: worstOf(
      pipelines.value.filter((p) => p.fleet === f.id).map((p) => severityOf.value[p.id]),
    ),
  })),
);

const destinationRate = (id: string) =>
  sumRates(
    pipelines.value.flatMap((p) =>
      p.exporters.filter((e) => e.destination === id).map((e) => e.rate),
    ),
  );

const destinationItems = computed<FlowListItem[]>(() =>
  destinations.value.map((d) => ({
    id: d.id,
    label: destinationLabel(d.id),
    rate: rateText(destinationRate(d.id)),
    value: destinationRate(d.id) ?? -1,
    dot: worstOf(
      pipelines.value
        .filter((p) => p.exporters.some((e) => e.destination === d.id))
        .map((p) => severityOf.value[p.id]),
    ),
  })),
);

const pipelineMap = computed(() =>
  buildPipelineMap(
    visible.value.map((p) => ({
      ...p,
      exporters: p.exporters.filter((e) => destinationShown(e.destination)),
    })),
    { width: canvasWidth.value, nodeWidth: NODE_WIDTH, row: ROW, top: TOP },
  ),
);
const mapNodeById = computed(() => new Map(pipelineMap.value.nodes.map((n) => [n.id, n])));
const pipelineById = computed(() => new Map(pipelines.value.map((p) => [p.id, p])));

// One signal names its unit; a node serving several signals counts items.
function nodeSignal(n: MapNode): FlowSignal {
  const signals = new Set(n.pipelines.map((id) => pipelineById.value.get(id)?.signal));
  return signals.size === 1 ? ([...signals][0] ?? "all") : "all";
}

function nodeLabel(n: MapNode): I18nText {
  if (n.column === "fleet") return raw(fleetName(n.name));
  if (n.column === "destination") return destinationLabel(n.name);
  return raw(n.name);
}

function nodeRing(n: MapNode): PathSeverity | undefined {
  if (n.column === "exporter") {
    if (ratio(n.failed, n.rate) >= ISSUE_RATIO || n.dropped > 0) return "error";
    if ((n.queue ?? 0) >= QUEUE_WARNING) return "warning";
  }
  if (n.column === "receiver" && ratio(n.refused, n.rate) >= ISSUE_RATIO) return "warning";
  return undefined;
}

const highlighted = computed<Set<string> | null>(() => {
  const sel = selection.value;
  if (!sel) return null;
  if (sel.kind === "pipeline") return new Set([sel.id]);
  if (sel.kind === "fleet") {
    return new Set(pipelines.value.filter((p) => p.fleet === sel.id).map((p) => p.id));
  }
  return new Set(mapNodeById.value.get(sel.id)?.pipelines ?? []);
});

function nodeData(n: MapNode): FleetFlowNodeData {
  const sel = selection.value;
  const label = nodeLabel(n);
  if (n.column === "fleet") {
    const issues = fleetIssueMap.value[n.name] ?? [];
    return {
      label,
      icon: COLUMN_ICON.f,
      sublabel: fleetMeta(fleetById.value.get(n.name)),
      selected: sel?.kind === "fleet" && sel.id === n.name,
      outbound: true,
      issueSeverity: worstSeverity(issues),
      issueCount: issues.length,
    };
  }
  const destination = n.column === "destination";
  return {
    label,
    icon: destination
      ? (DESTINATION_ICON[destinationById.value.get(n.name)?.type ?? ""] ?? "cloud-upload")
      : COLUMN_ICON[n.id[0]],
    sublabel: rateText(n.rate, nodeSignal(n)),
    compact: !destination,
    selected: sel?.kind === "node" && sel.id === n.id,
    inbound: true,
    outbound: !destination,
    ring: nodeRing(n),
  };
}

const nodes = computed<Node<FleetFlowNodeData>[]>(() =>
  pipelineMap.value.nodes.map((n) => ({
    id: n.id,
    type: n.column === "sink" ? "sink" : "fleet",
    ariaLabel: nodeLabel(n),
    position: { x: n.x, y: n.y },
    data: n.column === "sink" ? { label: nodeLabel(n), icon: "send" } : nodeData(n),
  })),
);

function edgeLabel(e: MapEdge): I18nText | undefined {
  if (!e.branch) return undefined;
  const value = percent(e.branch.ratio);
  return e.branch.kind === "failed"
    ? t("fleet.pipelines.sendFailed", { value })
    : t("fleet.pipelines.dropped", { value });
}

function edgeSummary(e: MapEdge): I18nText {
  const from = mapNodeById.value.get(e.source);
  const to = mapNodeById.value.get(e.target);
  return t("fleet.pipelines.edgeSummary", {
    from: from ? nodeLabel(from) : raw(e.source),
    to: e.branch ? (edgeLabel(e) ?? raw("")) : to ? nodeLabel(to) : raw(e.target),
    rate: rateText(e.rate, e.signal),
  });
}

const edges = computed<Edge<FleetFlowEdgeData>[]>(() => {
  const max = Math.max(0, ...pipelineMap.value.edges.map((e) => e.rate ?? 0));
  const focus = highlighted.value;
  return pipelineMap.value.edges.map((e) => {
    const lit = !!focus && e.pipelines.some((id) => focus.has(id));
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "fleet",
      ariaLabel: edgeSummary(e),
      zIndex: e.branch ? 2 : lit ? 1 : 0,
      data: {
        signal: e.signal,
        width: strokeWidth(e.rate, max),
        branch: !!e.branch,
        label: edgeLabel(e),
        noData: e.rate === null,
        highlighted: lit,
        dimmed: !!focus && !lit,
        summary: edgeSummary(e),
      },
    };
  });
});

function uniqueIssues(list: PathIssue[]): PathIssue[] {
  return [...new Map(list.map((i) => [i.id, i])).values()];
}

const details = computed(() => {
  const sel = selection.value;
  // Polls keep the last data on error, so a 403 or a removed pipeline must hide stale details.
  if (!sel || forbidden.value) return null;
  if (sel.kind === "pipeline") {
    const p = pipelineById.value.get(sel.id);
    if (!p) return null;
    return {
      title: t("fleet.pipelines.pipelineTitle", {
        fleet: raw(fleetName(p.fleet)),
        pipeline: raw(p.name),
      }),
      throughput: perSecond(p.out_rate, p.signal),
      issues: issuesOf(p),
      configId: fleetById.value.get(p.fleet)?.config ?? null,
      fleetId: p.fleet,
    };
  }
  if (sel.kind === "fleet") {
    const f = fleetById.value.get(sel.id);
    if (!f) return null;
    return {
      title: raw(f.name),
      throughput: perSecond(fleetRate(f.id)),
      issues: fleetIssueMap.value[f.id] ?? [],
      configId: f.config,
      fleetId: f.id,
    };
  }
  const n = mapNodeById.value.get(sel.id);
  if (!n) return null;
  const through = n.pipelines.map((id) => pipelineById.value.get(id)).filter((p) => !!p);
  return {
    title: nodeLabel(n),
    throughput: perSecond(n.rate, nodeSignal(n)),
    issues: uniqueIssues(through.flatMap(issuesOf)),
    configId: n.column === "destination" ? null : (fleetById.value.get(n.fleet)?.config ?? null),
    fleetId: n.column === "destination" ? null : n.fleet,
  };
});

// The popover floats at the click point, clamped to the canvas; the graph never reflows for it.
function placePopover(event: MouseEvent | TouchEvent, anchorToNode = false) {
  const rect = canvasEl.value?.getBoundingClientRect();
  const point = "clientX" in event ? event : event.touches[0];
  if (!rect || !point) return;
  const nodeEl = anchorToNode
    ? (event.target as HTMLElement | null)?.closest(".vue-flow__node")
    : null;
  const nodeRect = nodeEl?.getBoundingClientRect();
  popover.value = nodeRect
    ? { x: nodeRect.right - rect.left + POPOVER_GAP, y: nodeRect.top - rect.top }
    : { x: point.clientX - rect.left + POPOVER_GAP, y: point.clientY - rect.top };
  nextTick(clampPopover);
}

function clampPopover() {
  const card = popoverEl.value;
  const box = canvasEl.value;
  if (!card || !box) return;
  const maxX = box.clientWidth - card.offsetWidth - POPOVER_MARGIN;
  // Stay inside the canvas and inside the visible part of the window.
  const visibleBottom = Math.min(
    box.clientHeight,
    window.innerHeight - box.getBoundingClientRect().top,
  );
  const maxY = visibleBottom - card.offsetHeight - POPOVER_MARGIN;
  popover.value = {
    x: Math.max(POPOVER_MARGIN, Math.min(popover.value.x, maxX)),
    y: Math.max(POPOVER_MARGIN, Math.min(popover.value.y, maxY)),
  };
}

function select(next: Selection, event: MouseEvent | TouchEvent, anchorToNode: boolean) {
  const same = selection.value?.kind === next.kind && selection.value.id === next.id;
  selection.value = same ? null : next;
  if (!same) placePopover(event, anchorToNode);
}

function onNodeClick({ node, event }: NodeMouseEvent) {
  if (node.id.startsWith("x:")) return select({ kind: "node", id: node.id.slice(2) }, event, false);
  if (node.id.startsWith("f:")) return select({ kind: "fleet", id: node.id.slice(2) }, event, true);
  select({ kind: "node", id: node.id }, event, true);
}

function onEdgeClick({ edge, event }: EdgeMouseEvent) {
  const e = pipelineMap.value.edges.find((x) => x.id === edge.id);
  if (!e) return;
  if (e.branch) return select({ kind: "node", id: e.source }, event, false);
  if (e.pipelines[0]) select({ kind: "pipeline", id: e.pipelines[0] }, event, false);
}

function onOutsidePointer(event: PointerEvent) {
  if (!selection.value) return;
  const target = event.target as globalThis.Node | null;
  if (popoverEl.value?.contains(target)) return;
  // Clicks inside the canvas are handled by Vue Flow.
  if (canvasEl.value?.contains(target)) return;
  selection.value = null;
}

// The org lives in the URL, so a link that drops it lands the editor in the default org.
function openConfig(configId: string) {
  const org = route.query.org_identifier;
  router.push({
    name: "fleetConfigEditor",
    params: { id: configId },
    query: org ? { org_identifier: org } : {},
  });
}

function runAction(action: IssueAction) {
  switch (action.kind) {
    case "rollout":
      return emit("navigate", "fleets", { rollout: action.rolloutId });
    case "collectors":
      return emit("navigate", "fleets", action.query);
    case "upgrades":
      return emit("outdated");
  }
}

function measure() {
  const width = canvasEl.value?.clientWidth;
  if (width) canvasWidth.value = width;
}

// Vue Flow keeps the positions it mounted with, so it mounts only once the width is known.
function resetViewport() {
  measure();
  nextTick(() => setViewport({ x: 0, y: 0, zoom: 1 }));
}

watch(() => nodes.value.length, resetViewport);

onMounted(() => {
  if (!canvasEl.value) return;
  measure();
  resizeObserver = new ResizeObserver(([entry]) => {
    canvasWidth.value = entry.contentRect.width;
    resetViewport();
  });
  resizeObserver.observe(canvasEl.value);
  document.addEventListener("pointerdown", onOutsidePointer);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  document.removeEventListener("pointerdown", onOutsidePointer);
});

// Reka marks every open drawer, dialog, menu and tooltip as a layer, and that layer owns this Escape.
const overlayOpen = () => !!document.querySelector("[data-dismissable-layer]");

function onEscape() {
  if (selection.value) selection.value = null;
  else if (expanded.value && !overlayOpen()) expanded.value = false;
}

useShortcuts([{ id: "fleetFlowCloseDetails", handler: onEscape }]);
</script>
