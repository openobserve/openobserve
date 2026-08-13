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

<!--
  Reusable notification dependency graph (Template → Destination → Alert),
  cross-referenced by name in useDependencyGraph; the canvas mirrors TraceDAG.
  Two consumers:
    - the dedicated page (AlertDependencies.vue) — full org graph, `embedded=false`.
    - the on-the-fly popup (ViewDependenciesDialog.vue) — one row's chain, via
      `embedded` + `focus`.

  Aggregated by default: destinations render collapsed with an "N alerts" badge;
  click one to expand (or "Expand all"). Nodes carry Open / Delete hover actions,
  so it doubles as a management surface — a linked delete returns the backend 409
  "used by" guard. With `focus` set it shows only that entity's dependency chain,
  traversed directionally so a shared template doesn't drag in sibling branches.
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Toolbar + summary are page-only; the focused popup shows just the chain. -->
    <template v-if="!embedded">
      <div
        class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2"
        data-test="alert-dependencies-toolbar"
      >
        <OSearchInput
          v-model="search"
          data-test="alert-dependencies-search"
          class="w-64"
          :placeholder="t('alert_dependencies.searchPlaceholder')"
        />
        <OToggleGroup
          :model-value="activeFilter"
          @update:model-value="(v) => (activeFilter = v as FilterKey)"
          data-test="alert-dependencies-filter"
        >
          <OToggleGroupItem
            value="linked"
            size="sm"
            :title="t('alert_dependencies.hintLinked')"
            data-test="alert-dependencies-filter-linked"
          >
            {{ t("alert_dependencies.filterLinked") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            value="all"
            size="sm"
            :title="t('alert_dependencies.hintAll')"
            data-test="alert-dependencies-filter-all"
          >
            {{ t("alert_dependencies.filterAll") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            value="orphan"
            size="sm"
            :title="t('alert_dependencies.hintUnused')"
            data-test="alert-dependencies-filter-orphan"
          >
            {{ t("alert_dependencies.filterOrphans") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            value="broken"
            size="sm"
            :title="t('alert_dependencies.hintBroken')"
            data-test="alert-dependencies-filter-broken"
          >
            {{ t("alert_dependencies.filterBroken") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          :variant="allExpanded ? 'primary' : 'outline'"
          size="sm"
          data-test="alert-dependencies-expand-all"
          @click="toggleExpandAll"
        >
          <template #icon-left>
            <OIcon :name="allExpanded ? 'unfold-less' : 'unfold-more'" size="sm" />
          </template>
          {{
            allExpanded ? t("alert_dependencies.collapseAll") : t("alert_dependencies.expandAll")
          }}
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="alert-dependencies-refresh"
          @click="refresh"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
        <span class="text-text-muted ml-auto text-xs">{{
          t("alert_dependencies.expandHint")
        }}</span>
      </div>

      <div
        class="border-border-default flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2"
        data-test="alert-dependencies-summary"
      >
        <span class="text-text-secondary text-xs">
          {{
            t("alert_dependencies.summary", {
              templates: graph.stats.templates,
              destinations: graph.stats.destinations,
              alerts: graph.stats.alerts,
            })
          }}
        </span>
        <OTag
          v-if="graph.stats.orphanDestinations || graph.stats.orphanTemplates"
          type="countChip"
          value="warning"
          data-test="alert-dependencies-orphan-count"
        >
          {{
            t("alert_dependencies.orphanSummary", {
              count: graph.stats.orphanDestinations + graph.stats.orphanTemplates,
            })
          }}
        </OTag>
        <OTag
          v-if="graph.stats.danglingReferences"
          type="countChip"
          value="error"
          data-test="alert-dependencies-broken-count"
        >
          {{ t("alert_dependencies.brokenSummary", { count: graph.stats.danglingReferences }) }}
        </OTag>
      </div>
    </template>

    <div
      v-if="loading"
      data-test="alert-dependencies-loading"
      class="flex flex-1 flex-col items-center justify-center p-6"
    >
      <OSpinner size="lg" />
      <div class="text-text-secondary mt-3 text-sm">{{ t("alert_dependencies.loading") }}</div>
    </div>

    <div v-else-if="error" data-test="alert-dependencies-error" class="p-3">
      <OBanner
        variant="error"
        icon="error"
        :content="t('alert_dependencies.failedToLoad', { error })"
      />
    </div>

    <div
      v-else-if="!visibleNodes.length"
      data-test="alert-dependencies-empty"
      class="flex flex-1 items-center justify-center p-6"
    >
      <OEmptyState
        size="hero"
        preset="no-alert-destinations"
        :filtered="!embedded && activeFilter !== 'all'"
      />
    </div>

    <div v-else class="relative min-h-0 flex-1" data-test="alert-dependencies-canvas">
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :min-zoom="0.2"
        :max-zoom="2"
        fit-view-on-init
        :fit-view-options="fitOptions"
        class="dependency-flow bg-surface-panel! h-full w-full"
      >
        <Background :pattern-color="dotColor" :gap="16" />

        <Controls :show-interactive="false">
          <template #top>
            <ControlButton
              data-test="alert-dependencies-rearrange"
              :title="t('alert_dependencies.rearrange')"
              @click="rearrange"
            >
              <OIcon name="auto-awesome" size="sm" />
            </ControlButton>
            <ControlButton
              data-test="alert-dependencies-fit"
              :title="t('alert_dependencies.fitToScreen')"
              @click="fitToScreen"
            >
              <OIcon name="open-in-full" size="sm" />
            </ControlButton>
          </template>
        </Controls>

        <template #node-dep="{ data }">
          <Handle
            v-if="data.kind !== 'template'"
            type="target"
            :position="Position.Left"
            class="bg-info border-surface-base h-2 w-2 rounded-full border"
          />
          <div
            :data-test="`alert-dependencies-node-${data.kind}-${data.name}`"
            class="rounded-default group relative flex min-h-8 max-w-52 min-w-32 flex-col gap-0.5 border px-2.5 py-1.5 shadow-sm transition-all duration-150 hover:shadow-md"
            :class="[
              nodeBgClass(data),
              nodeBorderClass(data),
              { 'opacity-30': data.dimmed, 'cursor-pointer': isBodyClickable(data) },
            ]"
            @click="onBodyClick(data)"
          >
            <div
              v-if="!data.missing"
              class="nodrag bg-surface-base border-border-default rounded-default absolute -top-7 right-0 flex gap-0.5 border p-0.5 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
            >
              <OButton
                variant="ghost"
                size="icon-sm"
                :data-test="`alert-dependencies-open-${data.name}`"
                @click.stop="openEntity(data)"
              >
                <OIcon name="open-in-new" size="sm" />
                <OTooltip side="top" :content="t('alert_dependencies.actionOpen')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-sm"
                :data-test="`alert-dependencies-delete-${data.name}`"
                @click.stop="requestDelete(data)"
              >
                <OIcon name="delete" size="sm" class="text-status-negative" />
                <OTooltip side="top" :content="t('alert_dependencies.actionDelete')" />
              </OButton>
            </div>

            <div class="flex items-center gap-1.5">
              <OIcon
                v-if="data.kind === 'destination' && data.usageCount"
                :name="data.expanded ? 'expand-more' : 'chevron-right'"
                size="sm"
                class="text-text-secondary shrink-0"
              />
              <OIcon
                v-else
                :name="nodeIcon(data.kind)"
                size="sm"
                class="text-text-secondary shrink-0"
              />
              <span class="text-compact min-w-0 truncate font-semibold" :title="data.name">{{
                data.name
              }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-text-muted text-2xs uppercase">{{
                t(`alert_dependencies.kind.${data.kind}`)
              }}</span>
              <OTag
                v-if="data.kind === 'destination' && !data.missing"
                type="countChip"
                value="neutral"
                :data-test="`alert-dependencies-usage-${data.name}`"
                >{{
                  t("alert_dependencies.usedBy", { count: data.usageCount }, data.usageCount)
                }}</OTag
              >
              <OTag
                v-if="data.orphan"
                type="countChip"
                value="warning"
                :data-test="`alert-dependencies-orphan-${data.name}`"
                >{{ t("alert_dependencies.orphanTag") }}</OTag
              >
              <OTag
                v-if="data.missing"
                type="countChip"
                value="error"
                :data-test="`alert-dependencies-missing-${data.name}`"
                >{{ t("alert_dependencies.missingTag") }}</OTag
              >
            </div>
          </div>
          <Handle
            v-if="data.kind !== 'alert'"
            type="source"
            :position="Position.Right"
            class="bg-info border-surface-base h-2 w-2 rounded-full border"
          />
        </template>
      </VueFlow>
    </div>

    <ConfirmDialog
      v-model="confirmDelete.visible"
      :title="t('alert_dependencies.deleteTitle', { name: confirmDelete.node?.name || '' })"
      :message="t('alert_dependencies.deleteMessage')"
      @update:ok="performDelete"
      @update:cancel="cancelDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeMount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { VueFlow, Position, Handle, MarkerType, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls, ControlButton } from "@vue-flow/controls";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

import { useI18nTyped } from "@/types/i18n";
import { raw } from "@/types/i18n";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import alertsService from "@/services/alerts";
import useDependencyGraph from "@/composables/alerts/useDependencyGraph";
import type { DepNode, DepFocus } from "@/composables/alerts/useDependencyGraph";

const props = withDefaults(
  defineProps<{
    /** Hide the page toolbar/summary — for the focused popup. */
    embedded?: boolean;
    /** Restrict to one entity's dependency chain (traversed directionally). */
    focus?: DepFocus | null;
  }>(),
  { embedded: false, focus: null },
);

const emit = defineEmits<{
  // A node was deleted — the parent list should refresh its own table.
  (e: "deleted"): void;
  // The focused entity is gone (or the chain is empty) — the popup should close.
  (e: "close"): void;
}>();

type FilterKey = "linked" | "all" | "orphan" | "broken";
type VisibleNode = DepNode & { expanded?: boolean; dimmed?: boolean };

// Resting edge colour — the same grey token the flow canvases use (makeEdge).
const EDGE_COLOR = "var(--color-grey-500)";
const dotColor = "var(--color-grey-400)";
const fitOptions = { padding: 0.2, minZoom: 0.4, maxZoom: 1.1 };

// Canvas layout constants are VueFlow coordinates (not CSS lengths), so plain
// numbers are correct here.
const COL_X: Record<DepNode["kind"], number> = { template: 0, destination: 340, alert: 680 };
const ROW_H = 64;
const LANE_GAP = 20;
// Extra vertical break between the linked / unused / broken groups in "All".
const GROUP_GAP = 80;
// Minimum vertical spacing enforced when de-overlapping a column.
const MIN_GAP = 56;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { fitView, setNodes } = useVueFlow();
const { graph, loading, error, loadGraph } = useDependencyGraph();

const search = ref("");
const activeFilter = ref<FilterKey>("linked");
// The ONE source of truth for expansion (page mode). "Expand all" fills it,
// "Collapse all" clears it — so a manually-expanded node obeys the bulk toggle.
const expanded = ref<Set<string>>(new Set());
const confirmDelete = ref<{ visible: boolean; node: DepNode | null }>({
  visible: false,
  node: null,
});

const org = () => store.state.selectedOrganization.identifier;

const refresh = async () => {
  await loadGraph(org());
  expanded.value = new Set();
};

onBeforeMount(refresh);
onActivated(() => {
  if (!graph.value.nodes.length) refresh();
});
// Reloading when the popup re-targets a different row keeps the chain fresh.
watch(
  () => props.focus,
  () => {
    if (props.focus && !loading.value) refresh();
  },
);

// A focused view treats every destination as expanded (show its alerts).
const isExpanded = (destId: string) => (props.focus ? true : expanded.value.has(destId));

// Group rank for "All" so linked destinations sort above unused above broken.
const destGroupRank = (n: DepNode) => (n.missing ? 2 : n.usageCount === 0 ? 1 : 0);

const filteredDestinations = computed(() => {
  const dests = graph.value.nodes.filter((n) => n.kind === "destination");
  if (activeFilter.value === "linked") return dests.filter((n) => !n.missing && n.usageCount > 0);
  if (activeFilter.value === "orphan") return dests.filter((n) => n.orphan);
  if (activeFilter.value === "broken") return dests.filter((n) => n.missing);
  return dests;
});

const brokenNodeIds = computed(() => {
  const missing = new Set(graph.value.nodes.filter((n) => n.missing).map((n) => n.id));
  const keep = new Set(missing);
  for (const e of graph.value.edges) {
    if (missing.has(e.source)) keep.add(e.target);
    if (missing.has(e.target)) keep.add(e.source);
  }
  return keep;
});

// The focus node (or null if the entity has no node yet).
const focusNodeId = computed(() => {
  const f = props.focus;
  if (!f) return null;
  if (f.kind === "alert") {
    const n = graph.value.nodes.find(
      (x) => x.kind === "alert" && (x.alertId === f.alertId || x.name === f.name),
    );
    return n?.id ?? null;
  }
  const id = `${f.kind}:${f.name}`;
  return graph.value.nodes.some((x) => x.id === id) ? id : null;
});

// One entity's dependency chain, traversed DIRECTIONALLY so a shared template
// pulls in only the focused branch, never sibling destinations.
const focusIds = computed(() => {
  const f = props.focus;
  const start = focusNodeId.value;
  const ids = new Set<string>();
  if (start) ids.add(start);
  if (!f || !start) return ids;
  const edges = graph.value.edges;

  if (f.kind === "destination") {
    // upstream template(s) + downstream alerts (+ those alerts' override templates)
    for (const e of edges) if (e.relation === "template" && e.target === start) ids.add(e.source);
    const alerts: string[] = [];
    for (const e of edges)
      if (e.relation === "usage" && e.source === start) {
        ids.add(e.target);
        alerts.push(e.target);
      }
    for (const a of alerts)
      for (const e of edges) if (e.relation === "override" && e.target === a) ids.add(e.source);
  } else if (f.kind === "template") {
    // downstream destinations + their alerts + directly-overriding alerts
    const dests: string[] = [];
    for (const e of edges)
      if (e.relation === "template" && e.source === start) {
        ids.add(e.target);
        dests.push(e.target);
      }
    for (const d of dests)
      for (const e of edges) if (e.relation === "usage" && e.source === d) ids.add(e.target);
    for (const e of edges) if (e.relation === "override" && e.source === start) ids.add(e.target);
  } else if (f.kind === "alert") {
    // upstream destination(s) + their templates + this alert's override template
    const dests: string[] = [];
    for (const e of edges)
      if (e.relation === "usage" && e.target === start) {
        ids.add(e.source);
        dests.push(e.source);
      }
    for (const d of dests)
      for (const e of edges) if (e.relation === "template" && e.target === d) ids.add(e.source);
    for (const e of edges) if (e.relation === "override" && e.target === start) ids.add(e.source);
  }
  return ids;
});

const visibleNodes = computed<VisibleNode[]>(() => {
  if (props.focus) {
    return graph.value.nodes
      .filter((n) => focusIds.value.has(n.id))
      .map((n) => ({ ...n, expanded: n.kind === "destination" }));
  }

  if (activeFilter.value === "broken") {
    return graph.value.nodes.filter((n) => brokenNodeIds.value.has(n.id));
  }

  const destIds = new Set(filteredDestinations.value.map((n) => n.id));

  const alertIds = new Set<string>();
  for (const e of graph.value.edges) {
    if (e.relation === "usage" && destIds.has(e.source) && isExpanded(e.source)) {
      alertIds.add(e.target);
    }
  }

  const tplIds = new Set<string>();
  if (activeFilter.value === "all") {
    for (const n of graph.value.nodes) if (n.kind === "template") tplIds.add(n.id);
  } else if (activeFilter.value === "orphan") {
    for (const n of graph.value.nodes) if (n.kind === "template" && n.orphan) tplIds.add(n.id);
  }
  for (const e of graph.value.edges) {
    if (e.relation === "template" && destIds.has(e.target)) tplIds.add(e.source);
    if (e.relation === "override" && alertIds.has(e.target)) tplIds.add(e.source);
  }

  const keep = new Set<string>([...destIds, ...alertIds, ...tplIds]);
  return graph.value.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, expanded: n.kind === "destination" && isExpanded(n.id) }));
});

const expandableIds = computed(() =>
  visibleNodes.value.filter((n) => n.kind === "destination" && n.usageCount > 0).map((n) => n.id),
);
const allExpanded = computed(
  () => expandableIds.value.length > 0 && expandableIds.value.every((id) => expanded.value.has(id)),
);
const toggleExpandAll = () => {
  expanded.value = allExpanded.value
    ? new Set()
    : new Set([...expanded.value, ...expandableIds.value]);
};

const visibleIds = computed(() => new Set(visibleNodes.value.map((n) => n.id)));

const visibleEdges = computed(() =>
  graph.value.edges.filter((e) => visibleIds.value.has(e.source) && visibleIds.value.has(e.target)),
);

const dimmedIds = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return new Set<string>();
  const matched = new Set(
    visibleNodes.value.filter((n) => n.name.toLowerCase().includes(term)).map((n) => n.id),
  );
  const keep = new Set(matched);
  for (const e of visibleEdges.value) {
    if (matched.has(e.source)) keep.add(e.target);
    if (matched.has(e.target)) keep.add(e.source);
  }
  return new Set(visibleNodes.value.filter((n) => !keep.has(n.id)).map((n) => n.id));
});

const deoverlap = (ids: string[], pos: Map<string, { x: number; y: number }>) => {
  const sorted = ids.slice().sort((a, b) => (pos.get(a)!.y ?? 0) - (pos.get(b)!.y ?? 0));
  for (let i = 1; i < sorted.length; i++) {
    const prev = pos.get(sorted[i - 1])!;
    const cur = pos.get(sorted[i])!;
    if (cur.y < prev.y + MIN_GAP) cur.y = prev.y + MIN_GAP;
  }
};

const positions = computed(() => {
  const pos = new Map<string, { x: number; y: number }>();

  const alertsByDest = new Map<string, string[]>();
  for (const e of visibleEdges.value) {
    if (e.relation === "usage") {
      if (!alertsByDest.has(e.source)) alertsByDest.set(e.source, []);
      alertsByDest.get(e.source)!.push(e.target);
    }
  }

  const destinations = visibleNodes.value
    .filter((n) => n.kind === "destination")
    .sort((a, b) => destGroupRank(a) - destGroupRank(b) || a.name.localeCompare(b.name));

  const placedAlerts = new Set<string>();
  let y = 0;
  let prevRank = destinations.length ? destGroupRank(destinations[0]) : 0;
  for (const dst of destinations) {
    const rank = destGroupRank(dst);
    if (rank !== prevRank) {
      y += GROUP_GAP;
      prevRank = rank;
    }
    const laneAlerts = (alertsByDest.get(dst.id) ?? []).filter((id) => !placedAlerts.has(id));
    const rows = Math.max(1, laneAlerts.length);
    pos.set(dst.id, { x: COL_X.destination, y: y + ((rows - 1) * ROW_H) / 2 });
    laneAlerts.forEach((id, i) => {
      pos.set(id, { x: COL_X.alert, y: y + i * ROW_H });
      placedAlerts.add(id);
    });
    y += rows * ROW_H + LANE_GAP;
  }

  const templates = visibleNodes.value.filter((n) => n.kind === "template");
  let fallbackY = 0;
  for (const tpl of templates) {
    const targetYs = visibleEdges.value
      .filter((e) => e.source === tpl.id)
      .map((e) => pos.get(e.target)?.y)
      .filter((v): v is number => v != null);
    pos.set(tpl.id, {
      x: COL_X.template,
      y: targetYs.length
        ? targetYs.reduce((a, b) => a + b, 0) / targetYs.length
        : (fallbackY += ROW_H),
    });
  }
  deoverlap(
    templates.map((n) => n.id),
    pos,
  );

  let leftoverY = y;
  for (const node of visibleNodes.value) {
    if (!pos.has(node.id)) {
      pos.set(node.id, {
        x: node.kind === "alert" ? COL_X.alert : COL_X.template,
        y: (leftoverY += ROW_H),
      });
    }
  }
  return pos;
});

const flowNodes = computed(() =>
  visibleNodes.value.map((n) => ({
    id: n.id,
    type: "dep",
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: { ...n, dimmed: dimmedIds.value.has(n.id) },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: true,
    selectable: false,
  })),
);

const flowEdges = computed(() =>
  visibleEdges.value.map((e) => {
    const dim = dimmedIds.value.has(e.source) || dimmedIds.value.has(e.target);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: EDGE_COLOR },
      style: {
        strokeWidth: 2,
        stroke: EDGE_COLOR,
        opacity: dim ? 0.15 : 1,
        strokeDasharray: e.relation === "override" ? "6 4" : undefined,
      },
    };
  }),
);

const nodeIcon = (kind: DepNode["kind"]) =>
  kind === "template"
    ? "description"
    : kind === "destination"
      ? "location-on"
      : "shield-alert-outline";

// Subtle per-type background tint so the box type reads at a glance. color-mix
// blends the hue INTO the opaque surface (not an alpha overlay), so the card stays
// opaque and the canvas/edges don't bleed through. Token flips light/dark on its own.
const nodeBgClass = (n: DepNode) =>
  n.kind === "template"
    ? "bg-[color-mix(in_srgb,var(--color-text-muted)_10%,var(--color-surface-base))]"
    : n.kind === "destination"
      ? "bg-[color-mix(in_srgb,var(--color-info)_12%,var(--color-surface-base))]"
      : "bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-surface-base))]";

const nodeBorderClass = (n: DepNode) => {
  if (n.missing) return "border-status-negative!";
  if (n.orphan) return "border-status-warning!";
  if (n.kind === "alert" && n.enabled === false) return "border-border-default opacity-60";
  if (n.kind === "destination") return "border-info!";
  if (n.kind === "alert") return "border-accent!";
  return "border-border-default";
};

// The only bare-click affordance is expanding a destination (page mode). A plain
// click never navigates — the hover "Open" button is the single redirect path,
// so templates/alerts don't silently jump away when you click to inspect them.
const isBodyClickable = (n: DepNode) =>
  n.kind === "destination" && !props.focus && n.usageCount > 0;

const toggleExpand = (destId: string) => {
  const next = new Set(expanded.value);
  next.has(destId) ? next.delete(destId) : next.add(destId);
  expanded.value = next;
};

const onBodyClick = (n: DepNode) => {
  if (isBodyClickable(n)) toggleExpand(n.id);
};

const openEntity = (n: DepNode) => {
  if (n.missing) return;
  const org_identifier = org();
  if (n.kind === "destination") {
    router.push({
      name: "alertDestinations",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "template") {
    router.push({
      name: "alertTemplates",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "alert" && n.alertId) {
    router.push({
      name: "alertDetail",
      params: { alert_id: n.alertId },
      query: { org_identifier, ...(n.folderId ? { folder: n.folderId } : {}) },
    });
  }
};

// ── Delete (full management) ────────────────────────────────────────────────
const requestDelete = (n: DepNode) => {
  confirmDelete.value = { visible: true, node: n };
};
const cancelDelete = () => {
  confirmDelete.value = { visible: false, node: null };
};
const performDelete = async () => {
  const n = confirmDelete.value.node;
  confirmDelete.value = { visible: false, node: null };
  if (!n) return;
  const org_identifier = org();
  try {
    if (n.kind === "destination") {
      await destinationService.delete({ org_identifier, destination_name: n.name });
    } else if (n.kind === "template") {
      await templateService.delete({ org_identifier, template_name: n.name });
    } else if (n.kind === "alert" && n.alertId) {
      await alertsService.delete_by_alert_id(org_identifier, n.alertId, n.folderId);
    } else {
      return;
    }
    toast({ variant: "success", message: t("alert_dependencies.deletedToast", { name: n.name }) });
    await refresh();
    // Let the originating list refresh its own table so the deleted row clears.
    emit("deleted");
    // If the popup was focused on this now-gone entity (or nothing is left in the
    // chain), close it — its subject no longer exists.
    if (props.focus && (!focusNodeId.value || !visibleNodes.value.length)) emit("close");
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message) ||
        t("alert_dependencies.deleteFailedToast", { name: n.name }),
    });
  }
};

// ── Canvas controls ─────────────────────────────────────────────────────────
const fitToScreen = () => fitView(fitOptions);
const rearrange = () => {
  setNodes(flowNodes.value);
  nextTick(() => fitView(fitOptions));
};
</script>

<style scoped>
/* keep: lib-override:vue-flow — VueFlow's background layer paints its own surface
   over the canvas, so it must be repainted with the panel token here (the token
   flips light/dark on its own, so no `.dark` twin is needed). */
.dependency-flow :deep(.vue-flow__background) {
  background-color: var(--color-surface-panel) !important;
}
</style>
