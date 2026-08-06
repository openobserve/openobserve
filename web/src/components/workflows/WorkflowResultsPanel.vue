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
    <div v-if="showStepList" class="border-border-default flex w-40 shrink-0 flex-col border-r">
      <div
        class="text-text-secondary border-border-default shrink-0 border-b px-3 py-2 text-xs font-semibold"
      >
        {{ t("workflow.results.nodesTitle") }}
      </div>
      <div class="min-h-0 flex-1 overflow-auto py-1">
        <button
          v-for="row in nodeRows"
          :key="row.id"
          type="button"
          :data-test="`workflows-results-node-${row.id}`"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
          :class="
            row.id === selectedId
              ? 'bg-select-item-hover-bg text-text-body'
              : 'text-text-secondary hover:bg-surface-subtle'
          "
          @click="selectNode(row.id)"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="statusDotClass(row.status)"
            aria-hidden="true"
          />
          <OIcon :name="row.icon" size="xs" class="shrink-0" />
          <span class="min-w-0 truncate">{{ row.label }}</span>
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
import { useI18n } from "vue-i18n";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import WorkflowStepResultContent from "./WorkflowStepResultContent.vue";

import {
  workflowObj,
  nodeMeta,
  nodeConfigDetail,
  nodeCustomName,
  triggerDef,
  flowOrderedNodeIds,
} from "@/plugins/workflows/useWorkflowCanvas";

// The right (vertical) dock hides the step list to reclaim width; the bottom dock
// keeps it. Defaults to shown.
withDefaults(defineProps<{ showStepList?: boolean }>(), { showStepList: true });

const { t } = useI18n();

const result = computed<any>(() => workflowObj.testRun.result);
const nodes = computed<any[]>(() => workflowObj.currentSelectedWorkflow?.nodes || []);
const nodeById = (id: string) => nodes.value.find((n: any) => n.id === id);

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

const nodeRows = computed(() =>
  ranIds.value.map((id) => {
    const node = nodeById(id);
    return {
      id,
      label: nodeLabel(node),
      icon: nodeIcon(node),
      status: nodeStatus(id),
    };
  }),
);

const statusDotClass = (status: string) =>
  status === "error"
    ? "bg-status-negative"
    : status === "ok"
      ? "bg-status-positive"
      : "bg-badge-default-solid-bg";

// Selection = shared resultDrawer.nodeId so a canvas badge and a list row stay in
// sync. Falls back to the first executed step so the panel is never blank.
const selectedId = computed(() => {
  const current = workflowObj.testRun.resultDrawer.nodeId;
  if (current && ranIds.value.includes(current)) return current;
  return ranIds.value[0] || "";
});
const selectNode = (id: string) => {
  workflowObj.testRun.resultDrawer = { show: true, nodeId: id };
};

// Keep the shared selection pointed at a valid step when a new run arrives.
watch(ranIds, (ids) => {
  const current = workflowObj.testRun.resultDrawer.nodeId;
  if ((!current || !ids.includes(current)) && ids.length) {
    workflowObj.testRun.resultDrawer = { show: true, nodeId: ids[0] };
  }
});
</script>
