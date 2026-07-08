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
  Workflow editor shell (todo #5).

  Self-contained toolbar (back · name · status · Test · Cancel · Save) + the
  forked WorkflowFlow canvas + a drawer region (node config forms mount here in
  later slices). On create it pre-places the Alert Trigger node (FD: trigger
  anchored, never a blank canvas). The hover-`+` StepMenu (#6), node forms
  (#8-11), save/validation (#13) and Test (#14) arrive in later slices — their
  buttons toast until then.
-->
<template>
  <div
    data-test="workflow-editor-page"
    class="tw:flex tw:flex-col tw:h-[calc(100vh-var(--navbar-height,2.25rem))] tw:min-h-0"
  >
    <!-- toolbar -->
    <header
      class="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:h-[54px] tw:shrink-0 tw:border-b tw:border-border-default"
    >
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="arrow-back"
        data-test="workflow-editor-back"
        @click="goBack"
      >
        <OTooltip side="bottom" :content="t('workflow.backToList')" />
      </OButton>

      <OInput
        v-model="workflowObj.currentSelectedWorkflow.name"
        class="tw:w-[260px]"
        data-test="workflow-editor-name"
        :placeholder="t('workflow.namePlaceholder')"
        :error="workflowObj.nameError"
        @update:model-value="workflowObj.nameError = false"
      />

      <OTag
        v-if="workflowObj.currentSelectedWorkflow.id"
        type="alertStatus"
        :value="workflowObj.currentSelectedWorkflow.enabled ? 'active' : 'paused'"
      />

      <div class="tw:flex-1"></div>

      <OButton
        variant="outline"
        size="sm-action"
        data-test="workflow-editor-test"
        @click="onTest"
      >
        {{ t("workflow.test") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="workflow-editor-cancel"
        @click="goBack"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="workflow-editor-save"
        :loading="saving"
        :disabled="saving"
        @click="onSave"
      >
        {{ t("common.save") }}
      </OButton>
    </header>

    <!-- workspace: canvas (+ drawer region for node forms in later slices) -->
    <div class="tw:flex-1 tw:flex tw:min-h-0 tw:relative">
      <div class="tw:flex-1 tw:relative tw:min-w-0">
        <WorkflowFlow />
      </div>
    </div>

    <!-- "add next step" picker (opened by the hover-+ on a node) -->
    <WorkflowStepDialog v-if="workflowObj.stepPicker.show" />

    <!-- node config side panel — mounted fresh per open (like PipelineEditor's
         node forms) so the drawer renders already-open without replaying the
         enter animation each time. -->
    <WorkflowNodeDrawer v-if="workflowObj.dialog.show" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getUUID } from "@/utils/zincutils";

import WorkflowFlow from "@/plugins/workflows/WorkflowFlow.vue";
import WorkflowNodeDrawer from "./WorkflowNodeDrawer.vue";
import WorkflowStepDialog from "./WorkflowStepDialog.vue";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
} from "@/plugins/workflows/useWorkflowCanvas";
import workflowService from "@/services/workflows";

const { t } = useI18n();
const router = useRouter();
const store = useStore();
const { resetWorkflowData, editNode } = useWorkflowCanvas();

const orgId = () => store.state.selectedOrganization.identifier as string;

// Seed a fresh workflow with the chosen trigger anchored near the top-center.
// `triggerKind` maps to the future backend WorkflowTriggerKind (B1); the node
// type stays "workflow_trigger" for all kinds in v1.
const seedTrigger = (triggerKind = "alert_fired") => {
  resetWorkflowData();
  const id = getUUID();
  workflowObj.currentSelectedWorkflow.nodes = [
    {
      id,
      // VueFlow node type selects the render template (source-only trigger).
      type: "input",
      position: { x: 320, y: 80 },
      data: {
        label: id,
        node_type: "workflow_trigger",
        trigger_kind: triggerKind,
        alert_ids: [],
      },
    },
  ];
  workflowObj.isEditWorkflow = false;
  // Auto-open the trigger's panel on create so users discover that nodes are
  // clickable (Outputs / Test live there). Only on create — editing a saved
  // workflow doesn't pop it open.
  editNode(id);
};

// Deep-link / refresh fallback: no GET /workflows/{id} yet (backend B5), so
// load via the list and find by id, then hydrate. The normal "Edit from list"
// path hydrates synchronously from the row, so this only runs on a cold load.
const loadWorkflow = async (id: string) => {
  try {
    const res = await workflowService.listWorkflows(orgId());
    const list = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    const wf = list.find((w: any) => w.id === id);
    if (!wf) {
      toast({ message: t("workflow.loadError"), variant: "error" });
      return;
    }
    hydrateWorkflow(wf);
  } catch (e) {
    toast({ message: t("workflow.loadError"), variant: "error" });
  }
};

const goBack = () => {
  resetWorkflowData();
  router.push({ name: "workflows", query: { org_identifier: orgId() } });
};

const saving = ref(false);

// Frontend validation before hitting the API: name, a trigger, at least one
// step, and no orphan (unconnected) nodes. Mirrors PipelineEditor's checks.
const validate = (): boolean => {
  const wf = workflowObj.currentSelectedWorkflow;
  const name = (wf.name || "").trim();
  if (!name) {
    workflowObj.nameError = true;
    toast({ message: t("workflow.nameRequired"), variant: "warning" });
    return false;
  }
  workflowObj.nameError = false;

  const nodes = wf.nodes || [];
  const trigger = nodes.find(
    (n: any) => n.data?.node_type === "workflow_trigger",
  );
  if (!trigger) {
    toast({ message: t("workflow.triggerRequired"), variant: "warning" });
    return false;
  }
  if (nodes.length < 2) {
    toast({ message: t("workflow.addStepRequired"), variant: "warning" });
    return false;
  }

  // Every non-trigger node must have an incoming edge.
  const targets = new Set((wf.edges || []).map((e: any) => e.target));
  const orphan = nodes.find(
    (n: any) => n.id !== trigger.id && !targets.has(n.id),
  );
  if (orphan) {
    toast({ message: t("workflow.connectAllNodes"), variant: "warning" });
    return false;
  }
  return true;
};

// The Workflow struct has no serde defaults, so every field must be present.
// org_id/id/name are overridden/generated by the backend on create, but must
// still be sent for deserialization.
const buildPayload = () => {
  const wf = workflowObj.currentSelectedWorkflow;
  return {
    id: wf.id || "",
    org_id: "",
    name: (wf.name || "").trim(),
    description: wf.description || "",
    enabled: wf.enabled ?? true,
    created_at: wf.created_at || 0,
    updated_at: wf.updated_at || 0,
    nodes: (wf.nodes || []).map(serializeNode),
    edges: wf.edges || [],
  };
};

// Emit only the fields the backend persists: id, io_type, position, data, and
// (when present) meta / style. Everything else on the in-memory node is VueFlow
// runtime state (`type`, `dimensions`, `handleBounds`, `computedPosition`,
// `selected`, `dragging`, …) and is dropped.
//
// `io_type` is derived from `node_type` (trigger=input, condition/function=
// default, destination=output) — the same value VueFlow uses for the render
// template (`node.type`). We send it because the backend `Node` struct requires
// it (matches the pipeline payload); it isn't a source of truth.
const serializeNode = (node: any) => {
  const nodeType = node?.data?.node_type;
  const data = { ...(node.data || {}) };
  const meta: Record<string, string> = { ...(node.meta || {}) };

  // Trigger: NodeData::WorkflowTrigger is a unit variant, so its kind can't live
  // in `data`; carry it in `meta` (strings survive serialization).
  if (nodeType === "workflow_trigger") {
    meta.trigger_kind = data.trigger_kind || "alert_fired";
  }

  const out: any = {
    id: node.id,
    io_type: node.type || "default",
    position: {
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    },
    data,
  };
  if (Object.keys(meta).length) out.meta = meta;
  if (node.style) out.style = node.style;
  return out;
};

const onSave = async () => {
  if (saving.value || !validate()) return;
  saving.value = true;
  const org = orgId();
  const data = buildPayload();
  try {
    if (workflowObj.currentSelectedWorkflow.id) {
      await workflowService.updateWorkflow({
        org_identifier: org,
        id: data.id,
        data,
      });
      toast({ message: t("workflow.updateSuccess"), variant: "success" });
    } else {
      const res = await workflowService.createWorkflow({
        org_identifier: org,
        data,
      });
      const newId = res.data?.id;
      toast({ message: t("workflow.createSuccess"), variant: "success" });
      // Per the create flow: after create, land on that workflow's editor so
      // the user can keep editing (and link alerts on the trigger).
      if (newId) {
        workflowObj.currentSelectedWorkflow.id = newId;
        workflowObj.isEditWorkflow = true;
        router.replace({
          name: "workflowEditor",
          query: { id: newId, org_identifier: org },
        });
      }
    }
  } catch (e: any) {
    toast({
      message: e?.response?.data?.message || t("workflow.saveError"),
      variant: "error",
    });
  } finally {
    saving.value = false;
  }
};

// Test is a later slice (#14).
const onTest = () => toast({ message: t("workflow.comingSoon"), variant: "info" });

onMounted(() => {
  const query = router.currentRoute.value.query;
  const id = query.id as string | undefined;
  if (id) {
    // Edit-from-list already hydrated the shared state synchronously; only
    // re-fetch on a cold load (deep link / refresh) where it's missing.
    if (workflowObj.currentSelectedWorkflow?.id !== id) loadWorkflow(id);
  } else {
    seedTrigger((query.trigger as string) || "alert_fired");
  }
});

onBeforeUnmount(() => resetWorkflowData());
</script>
