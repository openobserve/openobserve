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
  Per-step Test result drawer — opened by clicking a node's ✓ / error badge after
  a Test run (used on the read-only Runs canvas). It's a thin ODrawer wrapper
  around the shared WorkflowStepResultContent, which the docked results panel (T4)
  also renders — so the drawer and the dock always show identical content.
-->
<template>
  <ODrawer
    :open="true"
    size="xl"
    data-test="workflow-step-result-drawer"
    :title="drawerTitle"
    @update:open="onOpenChange"
  >
    <div class="h-full min-h-0 p-4">
      <WorkflowStepResultContent :node-id="nodeId" @replayed="close" />
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="close">
          {{ t("common.close") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import WorkflowStepResultContent from "./WorkflowStepResultContent.vue";

import {
  workflowObj,
  nodeMeta,
  nodeConfigDetail,
  nodeCustomName,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();

const nodeId = computed(() => workflowObj.testRun.resultDrawer.nodeId);
const node = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow?.nodes || []).find((n: any) => n.id === nodeId.value),
);

// Title = the node's custom name (T2) if set, else its type + config detail
// (e.g. "Function - error_fn"), capped at 30 chars.
const drawerTitle = computed(() => {
  const data = node.value?.data;
  const custom = nodeCustomName(node.value);
  if (custom) return custom.length > 30 ? `${custom.slice(0, 30)}…` : custom;
  const typeName = nodeMeta(data?.node_type)
    ? t(nodeMeta(data?.node_type)!.titleKey)
    : data?.node_type || "";
  const detail = nodeConfigDetail(data, 60);
  const full = detail ? `${typeName} - ${detail}` : typeName;
  return full.length > 30 ? `${full.slice(0, 30)}…` : full;
});

const close = () => {
  workflowObj.testRun.resultDrawer = { show: false, nodeId: "" };
};
const onOpenChange = (open: boolean) => {
  if (!open) close();
};
</script>
