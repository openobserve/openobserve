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
    class="rounded-surface border-border-default bg-surface-base grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_16rem] overflow-hidden border max-lg:grid-cols-1"
    data-test="fleet-flow-overview"
  >
    <div
      class="border-border-default min-h-0 border-e max-lg:h-64 max-lg:border-e-0 max-lg:border-b"
    >
      <FleetFlowList
        v-model="checkedConfigs"
        list-id="configs"
        :title="t('fleet.flow.configurations')"
        :filter-placeholder="t('fleet.flow.filterConfigs')"
        :items="configItems"
      />
    </div>

    <div
      class="flex min-h-0 flex-col"
      :class="expanded ? 'max-lg:h-dvh' : 'max-lg:h-112'"
      data-test="fleet-flow-overview-map"
    >
      <OBanner
        v-if="loadError"
        class="mx-3 mt-3"
        variant="error"
        dense
        :content="t('fleet.flow.loadFailed')"
        data-test="fleet-flow-overview-error"
      >
        <template #actions>
          <OButton variant="outline" size="sm" data-test="fleet-flow-overview-retry" @click="retry">
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
      <div ref="canvasEl" class="relative min-h-0 flex-1">
        <div
          v-if="forbidden"
          class="absolute inset-0 grid place-items-center"
          data-test="fleet-flow-overview-forbidden"
        >
          <OEmptyState size="block" preset="no-access" />
        </div>
        <div
          v-else
          class="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="pointer-events-auto flex items-center gap-3">
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
              <OSwitch
                v-model="issuesOnly"
                size="sm"
                :label="t('fleet.flowIssues.issuesOnly')"
                data-test="fleet-flow-overview-issues-only"
              />
            </div>
            <div class="pointer-events-auto flex items-center gap-2">
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
          <FleetFlowLegend
            v-model="severityFilter"
            class="pointer-events-auto self-start"
            :counts="legendCounts"
          />
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
          :min-zoom="1"
          :max-zoom="1.25"
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
          <template #edge-fleet="edgeProps">
            <FleetFlowEdge v-bind="edgeProps" />
          </template>
        </VueFlow>

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
            class="max-h-112"
            @close="selection = null"
            @action="runAction"
            @open-config="openConfig(details.configId)"
          />
        </div>

        <div
          v-if="noConfigs"
          class="absolute inset-0 grid place-items-center"
          data-test="fleet-flow-overview-no-configs"
        >
          <OEmptyState
            size="block"
            preset="no-data"
            :description="t('fleet.flow.noConfigs')"
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
            :description="t('fleet.flow.emptyHint')"
            hide-action
          />
        </div>

        <OInnerLoading :showing="loading" data-test="fleet-flow-overview-loading" />
      </div>
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
  VueFlow,
  useVueFlow,
  type Edge,
  type EdgeMouseEvent,
  type Node,
  type NodeMouseEvent,
} from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { FleetFlowLink } from "@/services/fleet";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import FleetFlowList, { type FlowListItem } from "./FleetFlowList.vue";
import FleetFlowNode from "./FleetFlowNode.vue";
import FleetFlowEdge from "./FleetFlowEdge.vue";
import FleetFlowLegend from "./FleetFlowLegend.vue";
import FleetFlowDetails from "./FleetFlowDetails.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import type { FleetTab } from "./fleetRoute";
import { useRoute, useRouter } from "vue-router";
import {
  useFlowIssues,
  worstSeverity,
  SEVERITY_ORDER,
  type IssueAction,
  type PathSeverity,
} from "./flowIssues";
import type { FleetFlowEdgeData, FleetFlowNodeData, FlowSignal, FlowWindow } from "./flowTypes";
import { formatCount } from "./fleetFormat";
import { useFleetConfigs, useFleetFlow } from "./useFleetApi";

const emit = defineEmits<{
  navigate: [tab: FleetTab, query: Record<string, string>];
  outdated: [];
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

const { t } = useI18nTyped();
const expandLabel = computed(() =>
  t(expanded.value ? "fleet.flow.collapseMap" : "fleet.flow.expandMap"),
);
const router = useRouter();
const route = useRoute();
const { configIssues, pathIssues, error: issuesError, refetch: refetchIssues } = useFlowIssues();

const worstOf = (list: PathSeverity[]): PathSeverity =>
  SEVERITY_ORDER.find((s) => list.includes(s)) ??
  (list.includes("restricted") ? "restricted" : "healthy");

const flowId = "fleet-flow-overview";
const { setViewport } = useVueFlow(flowId);
// SVG fill on the background dots, the one place a token is read by var().
const dotColor = "var(--color-border-strong)";
// Layout is in screen pixels at zoom 1: readable text beats fitting everything on screen.
const ROW = 112;
const TOP = 120;
const NODE_HALF = 72;
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

const configsQuery = useFleetConfigs(() => true, FLOW_POLL_MS);
const flowQuery = useFleetFlow(() => timeWindow.value);

// The configs list is org-wide, but the flow and the counts cover only fleets the caller may read.
const fleetConfigs = computed(() => {
  const linked = new Set((flowQuery.flow.value?.links ?? []).map((l) => l.config));
  return configsQuery.rows.value.filter(
    (c) => !c.template && (c.collectors > 0 || linked.has(c.id)),
  );
});
const flowLinks = computed(() => {
  const shown = new Set(fleetConfigs.value.map((c) => c.id));
  return (flowQuery.flow.value?.links ?? []).filter((l) => shown.has(l.config));
});
const destinations = computed(() => {
  const linked = new Set(flowLinks.value.map((l) => l.destination));
  return (flowQuery.flow.value?.destinations ?? []).filter((d) => linked.has(d.id));
});

const forbidden = computed(() => flowQuery.forbidden.value || configsQuery.forbidden.value);
const loadError = computed(
  () =>
    !forbidden.value && !!(flowQuery.error.value || configsQuery.error.value || issuesError.value),
);
const loading = computed(
  () => !forbidden.value && (configsQuery.loading.value || flowQuery.loading.value),
);
const noConfigs = computed(
  () =>
    !forbidden.value &&
    !configsQuery.loading.value &&
    !loadError.value &&
    fleetConfigs.value.length === 0,
);

function retry() {
  flowQuery.refetch();
  configsQuery.refetch();
  refetchIssues();
}

// Stored as exclusions, so configurations and destinations that arrive later start checked.
const excludedConfigs = ref<string[]>([]);
const excludedDestinations = ref<string[]>([]);
const checkedConfigs = computed<string[]>({
  get: () =>
    fleetConfigs.value.map((c) => c.id).filter((id) => !excludedConfigs.value.includes(id)),
  set: (ids) => {
    excludedConfigs.value = fleetConfigs.value.map((c) => c.id).filter((id) => !ids.includes(id));
  },
});
const checkedDestinations = computed<string[]>({
  get: () =>
    destinations.value.map((d) => d.id).filter((id) => !excludedDestinations.value.includes(id)),
  set: (ids) => {
    excludedDestinations.value = destinations.value
      .map((d) => d.id)
      .filter((id) => !ids.includes(id));
  },
});
const issuesOnly = ref(false);
const severityFilter = ref<PathSeverity | null>(null);
const selection = ref<{ kind: "edge" | "node"; id: string } | null>(null);
const popover = ref({ x: 0, y: 0 });
const popoverEl = ref<HTMLElement | null>(null);

// Under "all" a link is null only when every signal is null, so a measured zero still reads as zero.
function linkRate(l: FleetFlowLink): number | null {
  if (telemetry.value !== "all") return l.rate[telemetry.value];
  const rates = [l.rate.logs, l.rate.metrics, l.rate.traces];
  return rates.every((r) => r === null)
    ? null
    : rates.reduce<number>((sum, r) => sum + (r ?? 0), 0);
}

// Null only when every link is null, so a measured zero still reads as zero.
function sumRates(links: FleetFlowLink[]): number | null {
  const rates = links.map(linkRate).filter((r): r is number => r !== null);
  return rates.length ? rates.reduce((sum, r) => sum + r, 0) : null;
}

const rateOf = (configId: string) => sumRates(flowLinks.value.filter((l) => l.config === configId));

const destinationRate = (destId: string, onlyChecked = false) =>
  sumRates(
    flowLinks.value.filter(
      (l) => l.destination === destId && (!onlyChecked || checkedConfigs.value.includes(l.config)),
    ),
  );

const perSecond = (rate: number | null): I18nText | null =>
  rate === null ? null : t(PER_SECOND[telemetry.value], { value: raw(formatCount(rate)) });

// A null rate under restricted metrics means the user may not read it, not that nothing flowed.
const metricsRestricted = computed(() => !!flowQuery.flow.value?.metrics_restricted);
const rateText = (rate: number | null): I18nText =>
  perSecond(rate) ??
  (metricsRestricted.value ? t("fleet.flow.metricsRestricted") : t("fleet.flow.noThroughputData"));

const destinationById = computed(() => new Map(destinations.value.map((d) => [d.id, d])));

// A config-scoped destination has exactly one link, so its config tells same-named exporters apart.
function destinationLabel(id: string): I18nText {
  const d = destinationById.value.get(id);
  if (d?.target) return raw(d.target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""));
  const config = flowQuery.flow.value?.links.find((l) => l.destination === id)?.config;
  return raw([d?.exporter, config].filter(Boolean).join(" · "));
}

const linkId = (l: FleetFlowLink) => `${l.config}->${l.destination}`;
const linkPathIssues = (l: FleetFlowLink) =>
  pathIssues(l, telemetry.value, destinationLabel(l.destination));
const nodeIssues = computed(() =>
  Object.fromEntries(fleetConfigs.value.map((c) => [c.id, configIssues(c.id)])),
);
const linkSeverity = computed<Record<string, PathSeverity>>(() =>
  Object.fromEntries(
    flowLinks.value.map((l) => {
      const severity = worstSeverity(linkPathIssues(l));
      return [
        linkId(l),
        severity === "healthy" && metricsRestricted.value ? "restricted" : severity,
      ];
    }),
  ),
);

const configItems = computed<FlowListItem[]>(() =>
  fleetConfigs.value.map((c) => ({
    id: c.id,
    label: raw(c.name),
    rate: sourceLabel(c.id),
    value: rateOf(c.id) ?? -1,
    dot: worstSeverity(nodeIssues.value[c.id] ?? []),
  })),
);

const destinationItems = computed<FlowListItem[]>(() =>
  destinations.value.map((d) => ({
    id: d.id,
    label: destinationLabel(d.id),
    rate: rateText(destinationRate(d.id)),
    value: destinationRate(d.id) ?? -1,
    dot: worstOf(
      flowLinks.value
        .filter((l) => l.destination === d.id)
        .map((l) => linkSeverity.value[linkId(l)]),
    ),
  })),
);

const checkedLinks = computed(() =>
  flowLinks.value.filter(
    (l) =>
      checkedConfigs.value.includes(l.config) && checkedDestinations.value.includes(l.destination),
  ),
);
const visibleLinks = computed(() =>
  checkedLinks.value.filter(
    (l) => !issuesOnly.value || linkSeverity.value[linkId(l)] !== "healthy",
  ),
);
const visibleConfigs = computed(() =>
  fleetConfigs.value.filter(
    (c) =>
      checkedConfigs.value.includes(c.id) &&
      (!issuesOnly.value ||
        visibleLinks.value.some((l) => l.config === c.id) ||
        (nodeIssues.value[c.id]?.length ?? 0) > 0),
  ),
);
const visibleDestinations = computed(() =>
  destinations.value.filter(
    (d) =>
      checkedDestinations.value.includes(d.id) &&
      (!issuesOnly.value || visibleLinks.value.some((l) => l.destination === d.id)),
  ),
);

const legendCounts = computed(() =>
  checkedLinks.value.reduce<Partial<Record<PathSeverity, number>>>((acc, l) => {
    const sev = linkSeverity.value[linkId(l)];
    acc[sev] = (acc[sev] ?? 0) + 1;
    return acc;
  }, {}),
);

const nodes = computed<Node<FleetFlowNodeData>[]>(() => {
  const left = visibleConfigs.value;
  const right = visibleDestinations.value;
  const offset = (a: number, b: number) => TOP + ((Math.max(a, b) - a) * ROW) / 2;
  const leftX = Math.max(0, canvasWidth.value * 0.15 - NODE_HALF);
  const rightX = Math.min(canvasWidth.value * 0.85 - NODE_HALF, canvasWidth.value - 2 * NODE_HALF);
  return [
    ...left.map((c, i) => {
      const issues = nodeIssues.value[c.id] ?? [];
      return {
        id: `c:${c.id}`,
        type: "fleet",
        ariaLabel: raw(c.name),
        position: { x: leftX, y: offset(left.length, right.length) + i * ROW },
        data: {
          label: raw(c.name),
          icon: "tune" as const,
          sublabel: t("fleet.flow.collectorsBadge", { count: c.collectors }),
          selected: selection.value?.kind === "node" && selection.value.id === c.id,
          outbound: true,
          issueSeverity: worstSeverity(issues),
          issueCount: issues.length,
        },
      };
    }),
    ...right.map((d, i) => ({
      id: `d:${d.id}`,
      type: "fleet",
      ariaLabel: destinationLabel(d.id),
      position: { x: rightX, y: offset(right.length, left.length) + i * ROW },
      data: {
        label: destinationLabel(d.id),
        icon: DESTINATION_ICON[d.type] ?? "cloud-upload",
        inbound: true,
      },
    })),
  ];
});

// A config's own failure, such as a halted rollout, says more about it than its throughput.
function sourceLabel(configId: string): I18nText {
  const failure = (nodeIssues.value[configId] ?? []).find((i) => i.severity === "error");
  return failure?.title ?? rateText(rateOf(configId));
}

const pathLabel = (l: FleetFlowLink) =>
  t("fleet.flow.pathLabel", {
    config: raw(l.config),
    destination: destinationLabel(l.destination),
  });

function edgeSummary(l: FleetFlowLink) {
  const issues = linkPathIssues(l);
  return t("fleet.flowIssues.edgeSummary", {
    path: pathLabel(l),
    rate: rateText(linkRate(l)),
    issues: issues.length
      ? raw(issues.map((i) => i.title).join("; "))
      : metricsRestricted.value
        ? t("fleet.flow.metricsRestricted")
        : t("fleet.flowIssues.noIssues"),
  });
}

const edges = computed<Edge<FleetFlowEdgeData>[]>(() => {
  const seenSource = new Set<string>();
  const seenTarget = new Set<string>();
  return visibleLinks.value.map((l) => {
    const severity = linkSeverity.value[linkId(l)];
    const highlighted =
      (selection.value?.kind === "edge" && selection.value.id === linkId(l)) ||
      (selection.value?.kind === "node" && selection.value.id === l.config);
    const firstFromSource = !seenSource.has(l.config);
    const firstIntoTarget = !seenTarget.has(l.destination);
    seenSource.add(l.config);
    seenTarget.add(l.destination);
    return {
      id: linkId(l),
      source: `c:${l.config}`,
      target: `d:${l.destination}`,
      type: "fleet",
      ariaLabel: pathLabel(l),
      animated: severity === "progress",
      zIndex: severity === "healthy" ? 0 : 1,
      data: {
        severity,
        highlighted,
        dimmed: !!severityFilter.value && severityFilter.value !== severity,
        summary: edgeSummary(l),
        sourceLabel: firstFromSource ? sourceLabel(l.config) : undefined,
        targetLabel: firstIntoTarget ? rateText(destinationRate(l.destination, true)) : undefined,
      },
    };
  });
});

const details = computed(() => {
  const sel = selection.value;
  // Polls keep the last data on error, so a 403 or a removed config must hide stale details.
  if (!sel || forbidden.value) return null;
  if (sel.kind === "node") {
    if (!fleetConfigs.value.some((c) => c.id === sel.id)) return null;
    return {
      title: raw(sel.id),
      throughput: perSecond(rateOf(sel.id)),
      issues: nodeIssues.value[sel.id] ?? [],
      configId: sel.id,
    };
  }
  const link = flowLinks.value.find((l) => linkId(l) === sel.id);
  if (!link) return null;
  return {
    title: pathLabel(link),
    throughput: perSecond(linkRate(link)),
    issues: linkPathIssues(link),
    configId: link.config,
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

function onNodeClick({ node, event }: NodeMouseEvent) {
  const [prefix, id] = node.id.split(":");
  if (prefix !== "c") return;
  const same = selection.value?.kind === "node" && selection.value.id === id;
  selection.value = same ? null : { kind: "node", id };
  if (!same) placePopover(event, true);
}

function onEdgeClick({ edge, event }: EdgeMouseEvent) {
  const same = selection.value?.kind === "edge" && selection.value.id === edge.id;
  selection.value = same ? null : { kind: "edge", id: edge.id };
  if (!same) placePopover(event);
}

function onOutsidePointer(event: PointerEvent) {
  if (!selection.value) return;
  const target = event.target as globalThis.Node | null;
  if (popoverEl.value?.contains(target)) return;
  // Clicks inside the canvas are handled by Vue Flow (pane, node and edge clicks).
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
      return emit("navigate", "fleets", { scope: "all", ...action.query });
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
