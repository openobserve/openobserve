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
  Docked results panel CONTENT (T4) — the SAME body rendered by both dock layouts
  (bottom + right). An executed-node list on the left (click a step to inspect it,
  keeping the canvas in view) and the shared WorkflowStepResultContent on the
  right (Input / Output / Replay). Selection is the shared
  testRun.resultDrawer.nodeId, so a canvas badge click and a list row stay in sync.
-->
<template>
  <div class="flex h-full min-h-0" data-test="workflows-results-panel">
    <!-- Executed-step list. Hidden in the narrow right (vertical) dock, where the
         width is better spent on Input/Output — steps are switched by clicking a
         node on the canvas instead (the active node is highlighted there). -->
    <div v-if="showStepList" class="border-border-default flex w-56 shrink-0 flex-col border-r">
      <div
        class="text-text-secondary border-border-default shrink-0 border-b px-3 py-2 text-xs font-semibold"
      >
        {{ t("workflow.results.nodesTitle") }}
      </div>
      <div class="min-h-0 flex-1 overflow-auto py-1">
        <!-- Step tree — replicates the traces waterfall "Operation Name" column:
             one fixed-width guide column per depth level, drawn with absolutely-
             positioned border-left (vertical │) / border-top (elbow └/├) segments,
             plus a circled child-count badge (leaf steps show a status dot). Rows
             are a fixed height so the vertical rails join seamlessly across rows. -->
        <button
          v-for="row in nodeRows"
          :key="row.id"
          type="button"
          :data-test="`workflows-results-node-${row.id}`"
          class="flex h-9 w-full items-center pr-3 pl-2 text-left text-sm"
          :class="
            row.id === selectedId
              ? 'bg-select-item-hover-bg text-text-body'
              : 'text-text-secondary hover:bg-surface-subtle'
          "
          @click="selectNode(row.id)"
        >
          <!-- Guide columns (one per depth level). Each column is w-5, the SAME
               width as the badge slot below, so a child's elbow rail (in column
               `depth`) sits exactly under its parent's badge (slot `depth`). -->
          <span
            v-for="i in row.depth"
            :key="i"
            class="relative h-full w-5 shrink-0"
            aria-hidden="true"
          >
            <!-- Ancestor rail: full-height vertical only where the subtree continues.
                 Elbow column (the node's own level): vertical from the top to the
                 mid-point, extended full-height when this step has a following
                 sibling, plus a horizontal stub reaching toward the badge. -->
            <span
              v-if="i < row.depth ? row.guides[i - 1] : true"
              class="border-border-default absolute top-0 left-1/2 border-l"
              :class="i < row.depth ? 'bottom-0' : row.guides[i - 1] ? 'h-full' : 'h-1/2'"
            />
            <span
              v-if="i === row.depth"
              class="border-border-default absolute top-1/2 right-0 left-1/2 border-t"
            />
          </span>

          <!-- Badge (child count) / leaf dot — centred in a w-5 slot on the same
               grid as the guide columns, so rails line up under it. -->
          <span class="flex h-full w-5 shrink-0 items-center justify-center">
            <span
              v-if="row.hasChildren"
              class="bg-surface-base flex h-5 w-5 items-center justify-center rounded-full border text-xs leading-none font-semibold"
              :class="statusRingClass(row.status)"
              :data-test="`workflows-results-node-${row.id}-count`"
            >
              {{ row.childCount }}
            </span>
            <span
              v-else
              class="h-2 w-2 rounded-full"
              :class="statusDotClass(row.status)"
              aria-hidden="true"
            />
          </span>

          <!-- Type icon + label. A stale step (deleted / disabled after the run) is
               struck-through and muted. -->
          <span
            class="flex min-w-0 items-center gap-1.5 pl-1.5"
            :class="{ 'opacity-60': row.stale }"
          >
            <OIcon :name="row.icon" size="xs" class="shrink-0" />
            <span class="min-w-0 truncate" :class="{ 'line-through': row.stale }">
              {{ row.label }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <!-- Selected step Input / Output / Replay -->
    <div class="min-h-0 min-w-0 flex-1 p-3">
      <WorkflowStepResultContent v-if="selectedId" :node-id="selectedId" />
      <div
        v-else
        class="text-text-secondary flex h-full items-center justify-center p-8 text-center text-sm italic"
      >
        {{ t("workflow.results.empty") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import WorkflowStepResultContent from "./WorkflowStepResultContent.vue";

import {
  workflowObj,
  nodeMeta,
  nodeConfigDetail,
  nodeCustomName,
  triggerDef,
  flowOrderedNodeIds,
  buildStepTree,
  isNodeDisabled,
} from "@/plugins/workflows/useWorkflowCanvas";

// The right (vertical) dock hides the step list to reclaim width; the bottom dock
// keeps it. Defaults to shown.
withDefaults(defineProps<{ showStepList?: boolean }>(), { showStepList: true });

const { t } = useI18nTyped();

const result = computed<any>(() => workflowObj.testRun.result);
const nodes = computed<any[]>(() => workflowObj.currentSelectedWorkflow?.nodes || []);

// The executed nodes for this run, in flow order (trigger → down). Nodes that
// didn't run (unwired / skipped from the run set) aren't listed.
const ranIds = computed<string[]>(() => {
  const ran: string[] = result.value?.ranNodeIds || [];
  const set = new Set(ran);
  return flowOrderedNodeIds(nodes.value, workflowObj.currentSelectedWorkflow?.edges || []).filter(
    (id) => set.has(id),
  );
});

const nodeStatus = (id: string): "ok" | "error" | "skipped" => {
  const r = result.value;
  if (r?.errors?.[id]) return "error";
  if (r?.inputs) return r.inputs[id]?.length ? "ok" : "skipped";
  if (r?.blockedNodeIds?.includes(id)) return "skipped";
  return "ok";
};

const nodeLabel = (node: any): string => {
  const custom = nodeCustomName(node);
  if (custom) return custom;
  const type = node?.data?.node_type;
  if (type === "workflow_trigger") return t(triggerDef(node?.data?.trigger_kind).nodeTitleKey);
  const meta = nodeMeta(type);
  return nodeConfigDetail(node?.data, 28) || (meta ? t(meta.titleKey) : type || "");
};
const nodeIcon = (node: any): string => {
  const meta = nodeMeta(node?.data?.node_type);
  return meta?.image ? `img:${meta.image}` : meta?.icon || "help";
};

interface StepRow {
  id: string;
  label: string;
  icon: string;
  status: "ok" | "error" | "skipped";
  depth: number;
  childCount: number;
  hasChildren: boolean;
  guides: boolean[];
  // The step no longer matches the live graph — it was DELETED or DISABLED after
  // the run. Rendered struck-through but still inspectable.
  stale: boolean;
}

const nodeById = (id: string) => nodes.value.find((n: any) => n.id === id);

// Turn a tree node (frozen snapshot or freshly built) into a render row. `live` is
// the node's current record in the graph (null if deleted); label/icon prefer it
// so a rename after the run is reflected, falling back to the frozen data.
const toStepRow = (s: any, live: any, frozen: any): StepRow => {
  const node = live || frozen;
  return {
    id: s.id,
    label: nodeLabel(node),
    icon: nodeIcon(node),
    status: nodeStatus(s.id),
    depth: s.depth,
    childCount: s.childCount,
    hasChildren: s.childCount > 0,
    guides: s.guides,
    stale: !live || isNodeDisabled(live),
  };
};

// The executed steps as a tree (traces-waterfall layout). A live Test run renders
// from the run-time SNAPSHOT (result.ranSteps) so a step later deleted/disabled
// stays listed struck-through; a history run (no snapshot) rebuilds the tree from
// the live graph.
const nodeRows = computed<StepRow[]>(() => {
  const steps = result.value?.ranSteps;
  if (Array.isArray(steps)) {
    return steps.map((s: any) =>
      toStepRow(s, nodeById(s.id), { id: s.id, data: s.data, meta: s.meta }),
    );
  }
  const tree = buildStepTree(
    nodes.value,
    workflowObj.currentSelectedWorkflow?.edges || [],
    ranIds.value,
  );
  return tree.map((s) => {
    const live = nodeById(s.id);
    return toStepRow(s, live, live);
  });
});

const statusDotClass = (status: string) =>
  status === "error"
    ? "bg-status-negative"
    : status === "ok"
      ? "bg-status-positive"
      : "bg-badge-default-solid-bg";

// Circle badge (child count) ring + text colour, keyed to the step's run status.
const statusRingClass = (status: string) =>
  status === "error"
    ? "border-status-negative text-status-negative"
    : status === "ok"
      ? "border-status-positive text-status-positive"
      : "border-border-strong text-text-secondary";

// Ids of the currently rendered rows — includes removed/disabled steps (which
// aren't in `ranIds`), so a struck-through step stays selectable in the log.
const rowIds = computed<string[]>(() => nodeRows.value.map((r) => r.id));

// Selection = shared resultDrawer.nodeId so a canvas badge and a list row stay in
// sync. Falls back to the first executed step so the panel is never blank.
const selectedId = computed(() => {
  const current = workflowObj.testRun.resultDrawer.nodeId;
  if (current && rowIds.value.includes(current)) return current;
  return rowIds.value[0] || "";
});
const selectNode = (id: string) => {
  workflowObj.testRun.resultDrawer = { show: true, nodeId: id };
};

// Keep the shared selection pointed at a valid step when a new run arrives.
watch(rowIds, (ids) => {
  const current = workflowObj.testRun.resultDrawer.nodeId;
  if ((!current || !ids.includes(current)) && ids.length) {
    workflowObj.testRun.resultDrawer = { show: true, nodeId: ids[0] };
  }
});
</script>
