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
  Focused dependency graph (Template → Destination → Alert) sized for the
  "View dependencies" popover. Shows ONE entity's chain as a small VueFlow canvas
  (the earlier graph visual), with the alerts paged 10 at a time so a destination
  feeding thousands stays usable. Nodes carry Open + Delete (inline confirm — no
  modal, so it never dismisses the popover). Data via useDependencyGraph +
  buildFocusChain; canvas mirrors TraceDAG.
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="loading"
      class="text-text-secondary flex flex-1 items-center justify-center gap-2 p-4 text-sm"
      data-test="dependency-graph-loading"
    >
      <OSpinner size="sm" />
      {{ t("alert_dependencies.loading") }}
    </div>

    <OBanner
      v-else-if="error"
      variant="error"
      icon="error"
      class="m-2"
      :content="t('alert_dependencies.failedToLoad', { error })"
      data-test="dependency-graph-error"
    />

    <div
      v-else-if="!flowNodes.length"
      class="text-text-muted flex flex-1 items-center justify-center p-4 text-sm"
      data-test="dependency-graph-empty"
    >
      {{ t("alert_dependencies.noDependencies") }}
    </div>

    <template v-else>
      <div class="min-h-0 flex-1" data-test="dependency-graph-canvas">
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :min-zoom="0.2"
          :max-zoom="1.5"
          fit-view-on-init
          :fit-view-options="{ padding: 0.15, minZoom: 0.4, maxZoom: 1 }"
          class="dependency-graph-flow bg-surface-panel! h-full w-full"
        >
          <Background :pattern-color="dotColor" :gap="14" />

          <template #node-dep="{ data }">
            <Handle
              v-if="data.kind !== 'template'"
              type="target"
              :position="Position.Left"
              class="bg-info border-surface-base h-1.5 w-1.5 rounded-full border"
            />
            <div
              :data-test="`dependency-graph-node-${data.kind}-${data.name}`"
              class="rounded-default group relative flex min-h-6 max-w-40 min-w-24 flex-col gap-0.5 border px-2 py-1 shadow-sm"
              :class="[nodeBgClass(data), nodeBorderClass(data)]"
            >
              <div class="flex items-center gap-1">
                <OIcon :name="nodeIcon(data.kind)" size="xs" class="text-text-secondary shrink-0" />
                <span class="text-2xs min-w-0 truncate font-semibold" :title="data.name">{{
                  data.name
                }}</span>
              </div>
              <div v-if="data.kind === 'destination' && !data.missing" class="flex">
                <OTag type="countChip" value="neutral" class="text-3xs">{{
                  t("alert_dependencies.usedBy", { count: data.usageCount }, data.usageCount)
                }}</OTag>
              </div>

              <!-- Inline confirm (no modal → keeps the popover open). -->
              <div
                v-if="confirmingId === data.id"
                class="nodrag bg-surface-base border-border-default rounded-default absolute -top-6 right-0 flex items-center gap-0.5 border px-1 py-0.5 shadow-sm"
              >
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :data-test="`dependency-graph-confirm-yes-${data.name}`"
                  @click.stop="doDelete(data)"
                >
                  <OIcon name="check" size="xs" class="text-status-negative" />
                </OButton>
                <OButton variant="ghost" size="icon-xs" @click.stop="confirmingId = null">
                  <OIcon name="close" size="xs" />
                </OButton>
              </div>
              <div
                v-else-if="!data.missing"
                class="nodrag bg-surface-base border-border-default rounded-default absolute -top-6 right-0 flex items-center gap-0.5 border px-0.5 py-0.5 opacity-0 shadow-sm group-hover:opacity-100"
              >
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :data-test="`dependency-graph-open-${data.name}`"
                  @click.stop="openEntity(data)"
                >
                  <OIcon name="open-in-new" size="xs" />
                </OButton>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :data-test="`dependency-graph-delete-${data.name}`"
                  @click.stop="confirmingId = data.id"
                >
                  <OIcon name="delete" size="xs" class="text-status-negative" />
                </OButton>
              </div>
            </div>
            <Handle
              v-if="data.kind !== 'alert'"
              type="source"
              :position="Position.Right"
              class="bg-info border-surface-base h-1.5 w-1.5 rounded-full border"
            />
          </template>
        </VueFlow>
      </div>

      <!-- Alert pager: outside the canvas so panning never hides it. -->
      <div
        v-if="chain.alerts.length > pageSize"
        class="border-border-default flex items-center justify-center gap-2 border-t px-2 py-1"
        data-test="dependency-graph-pager"
      >
        <OButton
          variant="ghost"
          size="icon-xs"
          :disabled="alertPage === 0"
          data-test="dependency-graph-prev"
          @click="alertPage = Math.max(0, alertPage - 1)"
        >
          <OIcon name="chevron-left" size="sm" />
        </OButton>
        <span class="text-text-secondary text-2xs tabular-nums">
          {{
            t("alert_dependencies.pageRange", {
              from: pageStart + 1,
              to: pageEnd,
              total: chain.alerts.length.toLocaleString(),
            })
          }}
        </span>
        <OButton
          variant="ghost"
          size="icon-xs"
          :disabled="pageEnd >= chain.alerts.length"
          data-test="dependency-graph-next"
          @click="alertPage = alertPage + 1"
        >
          <OIcon name="chevron-right" size="sm" />
        </OButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { VueFlow, Position, Handle, MarkerType } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

import { useI18nTyped, raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import alertsService from "@/services/alerts";
import useDependencyGraph, { buildFocusChain } from "@/composables/alerts/useDependencyGraph";
import type { DepNode, DepFocus } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{ focus: DepFocus }>();
const emit = defineEmits<{
  (e: "deleted"): void;
  (e: "close"): void;
}>();

const EDGE_COLOR = "var(--color-grey-500)";
const dotColor = "var(--color-grey-400)";
const pageSize = 10;
// Canvas coordinates (not CSS) — plain numbers are correct.
const COL_X: Record<DepNode["kind"], number> = { template: 0, destination: 210, alert: 420 };
const ROW_H = 54;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { graph, loading, error, loadGraph } = useDependencyGraph();

const alertPage = ref(0);
const confirmingId = ref<string | null>(null);

const org = () => store.state.selectedOrganization.identifier;
const refresh = async () => {
  await loadGraph(org());
};

onMounted(refresh);
watch(
  () => props.focus,
  () => {
    alertPage.value = 0;
    confirmingId.value = null;
    refresh();
  },
);

const chain = computed(() => buildFocusChain(graph.value, props.focus));
const pageStart = computed(() => alertPage.value * pageSize);
const pageEnd = computed(() => Math.min(pageStart.value + pageSize, chain.value.alerts.length));
const pagedAlerts = computed(() => chain.value.alerts.slice(pageStart.value, pageEnd.value));

// Layout: templates (left) → destinations (mid) → this page's alerts (right),
// vertically centred on the alert block so the small chain reads left-to-right.
const positions = computed(() => {
  const pos = new Map<string, { x: number; y: number }>();
  const alerts = pagedAlerts.value;
  alerts.forEach((a, i) => pos.set(a.id, { x: COL_X.alert, y: i * ROW_H }));
  const midY = alerts.length ? ((alerts.length - 1) * ROW_H) / 2 : 0;

  const dests = chain.value.destinations;
  dests.forEach((d, i) =>
    pos.set(d.id, { x: COL_X.destination, y: midY + (i - (dests.length - 1) / 2) * ROW_H }),
  );
  const tpls = chain.value.templates;
  tpls.forEach((tpl, i) =>
    pos.set(tpl.id, { x: COL_X.template, y: midY + (i - (tpls.length - 1) / 2) * ROW_H }),
  );
  return pos;
});

const visibleIds = computed(
  () =>
    new Set<string>([
      ...chain.value.templates.map((n) => n.id),
      ...chain.value.destinations.map((n) => n.id),
      ...pagedAlerts.value.map((n) => n.id),
    ]),
);

const flowNodes = computed(() =>
  [...chain.value.templates, ...chain.value.destinations, ...pagedAlerts.value].map((n) => ({
    id: n.id,
    type: "dep",
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: n,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: true,
    selectable: false,
  })),
);

const flowEdges = computed(() =>
  graph.value.edges
    .filter((e) => visibleIds.value.has(e.source) && visibleIds.value.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLOR },
      style: {
        strokeWidth: 1.5,
        stroke: EDGE_COLOR,
        strokeDasharray: e.relation === "override" ? "5 3" : undefined,
      },
    })),
);

const nodeIcon = (kind: DepNode["kind"]) =>
  kind === "template"
    ? "description"
    : kind === "destination"
      ? "location-on"
      : "shield-alert-outline";

const nodeBgClass = (n: DepNode) =>
  n.kind === "template"
    ? "bg-[color-mix(in_srgb,var(--color-text-muted)_10%,var(--color-surface-base))]"
    : n.kind === "destination"
      ? "bg-[color-mix(in_srgb,var(--color-info)_12%,var(--color-surface-base))]"
      : "bg-[color-mix(in_srgb,var(--color-status-positive)_14%,var(--color-surface-base))]";

const nodeBorderClass = (n: DepNode) => {
  if (n.missing) return "border-status-negative!";
  if (n.orphan) return "border-status-warning!";
  if (n.kind === "destination") return "border-info!";
  if (n.kind === "alert") return "border-status-positive!";
  return "border-border-default";
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

// Node already confirmed inline — delete straight away.
const doDelete = async (n: DepNode) => {
  confirmingId.value = null;
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
    emit("deleted");
    if (!chain.value.focusNode) emit("close");
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message) ||
        t("alert_dependencies.deleteFailedToast", { name: n.name }),
    });
  }
};
</script>

<style scoped>
/* keep: lib-override:vue-flow — VueFlow's background layer paints its own surface,
   so repaint it with the panel token (flips light/dark on its own). */
.dependency-graph-flow :deep(.vue-flow__background) {
  background-color: var(--color-surface-panel) !important;
}
</style>
