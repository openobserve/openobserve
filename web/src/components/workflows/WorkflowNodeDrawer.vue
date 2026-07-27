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
  Node config side panel. Opens whenever a node is selected/added
  (workflowObj.dialog). Save commits the staged node (add + auto-wire) or
  updates the existing one; Cancel discards; Delete (edit mode) removes it.

  The body switches on the node_type. For now each type shows a placeholder —
  the real forms land in later slices (AlertTrigger #9, Condition #10,
  Function #11, SendToDestination #12) and replace the matching placeholder.
-->
<template>
  <ODrawer
    :open="true"
    @update:open="onOpenChange"
    :title="title"
    :width="drawerWidth"
    :size="drawerSize"
    :show-close="true"
    :primary-button-label="
      hideFooter || readonlyBody || bodyCreatingNew ? undefined : t('common.save')
    "
    :secondary-button-label="
      hideFooter || readonlyBody || bodyCreatingNew ? undefined : t('common.cancel')
    "
    :neutral-button-label="
      !hideFooter && !bodyCreatingNew && workflowObj.isEditNode && meta?.category !== 'trigger'
        ? t('workflow.deleteNode')
        : undefined
    "
    @click:primary="onSave"
    @click:secondary="onCancel"
    @click:neutral="onDelete"
    data-test="workflow-node-drawer"
  >
    <div :class="workflowObj.dialog.expand ? 'h-full min-h-0' : 'p-4'">
      <!-- Per-node-type body. Each exposes submit() returning the data payload
           (or null to block Save). Types without a form yet fall back to the
           placeholder below. -->
      <component v-if="bodyComponent" :is="bodyComponent" ref="bodyRef" />
      <div
        v-else
        class="text-text-secondary flex flex-col items-center justify-center gap-2 py-10 text-center"
      >
        <OIcon :name="meta?.icon || 'help'" size="lg" />
        <div class="text-sm">
          {{ t("workflow.node.configComingSoon", { node: title }) }}
        </div>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import WorkflowAlertTrigger from "@/plugins/workflows/nodes/WorkflowAlertTrigger.vue";
import WorkflowCondition from "@/plugins/workflows/nodes/WorkflowCondition.vue";
import WorkflowFunction from "@/plugins/workflows/nodes/WorkflowFunction.vue";
import WorkflowDestination from "@/plugins/workflows/nodes/WorkflowDestination.vue";
import useWorkflowCanvas, { workflowObj, nodeMeta } from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const { commitNode, cancelNodeDrawer, requestDeleteNode } = useWorkflowCanvas();

const meta = computed(() => nodeMeta(workflowObj.dialog.name));
const title = computed(() => (meta.value ? t(meta.value.titleKey) : workflowObj.dialog.name));

// Node types that have a real config form. The rest still show the placeholder.
const BODY_COMPONENTS: Record<string, any> = {
  workflow_trigger: WorkflowAlertTrigger,
  condition: WorkflowCondition,
  function: WorkflowFunction,
  destination: WorkflowDestination,
};
const bodyComponent = computed(() => BODY_COMPONENTS[workflowObj.dialog.name]);
// Match the pipeline node-form drawer widths per type:
//   condition -> width 45, function -> width 30 (97 while creating inline),
//   destination -> size "lg", trigger -> size "md".
// `width` (vw) takes precedence in ODrawer; when it's undefined, `size` applies.
const drawerWidth = computed(() => {
  if (workflowObj.dialog.expand) return 97; // full-width (inline function editor)
  if (workflowObj.dialog.name === "condition") return 45;
  if (workflowObj.dialog.name === "function") return 30;
  return undefined; // destination + trigger fall back to `size`
});
const drawerSize = computed(() => (workflowObj.dialog.name === "destination" ? "lg" : "md"));

// Ref to the active body so Save can pull its payload / let it veto.
const bodyRef = ref<any>(null);

// The full-width inline function editor supplies its own controls, so the
// drawer footer is hidden there.
const hideFooter = computed(() => workflowObj.dialog.expand);

// A body showing its own inline create form (the destination node's "Create New
// Destination") — it carries its own Save/Cancel, so the drawer hides its footer
// while creating (pipeline ExternalDestination pattern).
const bodyCreatingNew = computed(() => !!bodyRef.value?.createNewDestination);

// The trigger is a read-only payload reference — nothing to save/cancel, so the
// footer is hidden and the header's close (X) is the only control.
const readonlyBody = computed(() => meta.value?.category === "trigger");

// Save: if a body form is mounted, ask it for its payload (null → invalid,
// abort). Otherwise commit the staged node as-is (placeholder types).
// Awaited because schema-validated bodies (the destination picker) resolve
// asynchronously; a plain value from a sync body awaits straight through.
const onSave = async () => {
  if (bodyComponent.value) {
    const payload = await bodyRef.value?.submit?.();
    if (payload == null) return;
    commitNode(payload);
    return;
  }
  commitNode({});
};
const onCancel = () => cancelNodeDrawer();
// Route through the shared confirm (rendered in WorkflowEditor). On confirm,
// deleteNode() also closes this drawer (it clears the open dialog for the node).
const onDelete = () => {
  const id = workflowObj.currentSelectedNodeData?.id;
  if (id) requestDeleteNode(id);
};
const onOpenChange = (open: boolean) => {
  if (!open) cancelNodeDrawer();
};
</script>
