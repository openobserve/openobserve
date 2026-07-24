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
  forked WorkflowCanvas + a drawer region (node config forms mount here in
  later slices). On create it pre-places the Alert Trigger node (FD: trigger
  anchored, never a blank canvas). The hover-`+` StepMenu (#6), node forms
  (#8-11), save/validation (#13) and Test (#14) arrive in later slices — their
  buttons toast until then.
-->
<template>
  <div data-test="workflow-editor-page" class="flex h-full min-h-0 flex-col">
    <!-- Toolbar — the shared OPageHeader (same as the pipeline editor): a
         back chevron in the module-icon slot, the workflow name input inline
         after the title, and the Test / Cancel / Save actions right-aligned. -->
    <OPageHeader
      :title="headerTitle"
      :back="{ label: t('workflow.header'), onClick: goBack, dataTest: 'workflow-editor-back' }"
      class="border-border-default border-b px-4"
    >
      <!-- Beta tag inside the title line (see WorkflowsList: #title-trail sits
           after the title+subtitle column, stranding it far from the title). -->
      <template #title>
        <span class="inline-flex min-w-0 items-center gap-2">
          <span class="truncate">{{ headerTitle }}</span>
          <BetaBadge />
        </span>
      </template>
      <!-- Name is editable on CREATE only; on edit it's shown read-only as the
           header title (mirrors the pipeline editor, where the name input is
           gated to the create route). Enable/disable status isn't shown here —
           it's managed from the list, same as pipelines. -->
      <template v-if="!workflowObj.isEditWorkflow" #title-trail>
        <div class="flex items-center gap-2">
          <div class="w-56 shrink-0">
            <OInput
              v-model="workflowObj.currentSelectedWorkflow.name"
              data-test="workflow-editor-name"
              hide-bottom-space
              :placeholder="t('workflow.namePlaceholder')"
              :error="workflowObj.nameError"
              @update:model-value="workflowObj.nameError = false"
            />
          </div>
          <div class="w-72 shrink-0">
            <OInput
              v-model="workflowObj.currentSelectedWorkflow.description"
              data-test="workflow-editor-description"
              hide-bottom-space
              :placeholder="t('workflow.descriptionPlaceholder')"
            />
          </div>
        </div>
      </template>

      <template #actions>
        <!-- History (Runs) — only meaningful for a saved workflow. Navigates to
             the dedicated read-only Runs inspection view (separate surface). -->
        <OButton
          v-if="workflowObj.isEditWorkflow"
          variant="outline"
          size="sm-action"
          data-test="workflow-editor-history"
          @click="openRuns"
        >
          {{ t("workflow.history.open") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="workflow-editor-test"
          @click="onTest"
        >
          {{ t("workflow.test.button") }}
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
      </template>
    </OPageHeader>

    <!-- workspace: docked palette + canvas (+ drawer region for node forms). The
         history drawer portals in here (below the toolbar) so it can sit
         side-by-side with the canvas. -->
    <div id="workflow-workspace" class="relative flex min-h-0 flex-1">
      <!-- Docked node palette — same shared component as Pipelines, so the two
           palettes can never drift apart. Workflows add click-to-append. -->
      <NodePalette
        v-if="workflowObj.showNodePalette"
        :items="paletteItems"
        test-prefix="workflow-palette"
        :on-drag-start="paletteDragStart"
        :on-item-click="paletteClick"
      />
      <!-- Canvas drop area — flush gray pane running to the viewport edges,
           matching the pipeline editor's `#pipelineChartContainer` so both look
           identical. `dark:bg-transparent` is part of that match: in dark mode
           the canvas falls through to the page background rather than sitting
           on the lighter `surface-subtle` slab, which is what made the two
           editors read as different shades. -->
      <div class="bg-surface-subtle relative min-w-0 flex-1 overflow-hidden dark:bg-transparent">
        <WorkflowCanvas />
      </div>
    </div>

    <!-- "add next step" picker (opened by the hover-+ on a node) — shared with
         pipelines. -->
    <StepPickerDialog
      v-if="workflowObj.stepPicker.show"
      :items="stepItems"
      :anchor="workflowObj.stepPicker.anchor"
      :search-placeholder="t('workflow.node.stepSearchPlaceholder')"
      :no-match-text="t('workflow.node.stepNoMatch')"
      test-prefix="workflow-step"
      @pick="onStepPick"
      @close="closeStepPicker"
    />

    <!-- node config side panel — mounted fresh per open (like PipelineEditor's
         node forms) so the drawer renders already-open without replaying the
         enter animation each time. -->
    <WorkflowNodeDrawer v-if="workflowObj.dialog.show" />

    <!-- Test input popup — collects the sample payload + run-from and runs the
         saved graph. Results render as ✓ / error badges on the canvas nodes. -->
    <WorkflowTestDialog v-if="workflowObj.testRun.show" />

    <!-- Per-step Input/Output result drawer — opened by clicking a node's badge
         after a run; also hosts the Replay-from-here button. -->
    <WorkflowStepResultDrawer v-if="workflowObj.testRun.resultDrawer.show" />

    <!-- Link-to-alerts prompt — shown once, right after a workflow is created, so
         the user can attach it to existing alerts without leaving for the alert
         screen. Either action (Link / Skip) returns to the list. -->
    <WorkflowLinkAlertsDialog
      v-if="linkAlerts.show"
      :workflow-id="linkAlerts.id"
      :workflow-name="linkAlerts.name"
      @linked="onLinkAlertsDone"
      @close="onLinkAlertsDone"
    />

    <!-- Save & Test prompt — Test runs the persisted workflow, so save first when
         it's new or has unsaved edits. -->
    <ConfirmDialog
      v-model="saveTestConfirm"
      :title="t('workflow.test.saveToTestTitle')"
      :message="t('workflow.test.saveToTestBody')"
      :ok-label="t('workflow.test.saveAndTest')"
      @update:ok="confirmSaveAndTest"
      @update:cancel="saveTestConfirm = false"
    />

    <!-- shared node-delete confirmation (both the hover-delete and the drawer's
         Delete button funnel through workflowObj.deleteConfirm). -->
    <ConfirmDialog
      v-model="workflowObj.deleteConfirm.show"
      :title="t('workflow.deleteNodeTitle')"
      :message="t('workflow.deleteNodeConfirm')"
      :ok-label="t('common.delete')"
      @update:ok="deleteNode(workflowObj.deleteConfirm.nodeId)"
      @update:cancel="cancelDeleteNode"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import WorkflowCanvas from "@/plugins/workflows/WorkflowCanvas.vue";
import WorkflowNodeDrawer from "./WorkflowNodeDrawer.vue";
import WorkflowTestDialog from "./WorkflowTestDialog.vue";
import WorkflowStepResultDrawer from "./WorkflowStepResultDrawer.vue";
import WorkflowLinkAlertsDialog from "./WorkflowLinkAlertsDialog.vue";
import StepPickerDialog from "@/components/flow/StepPickerDialog.vue";
import NodePalette from "@/components/flow/NodePalette.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
  nodeMeta,
  ADDABLE_NODE_TYPES,
  TRIGGER_NODE_TYPES,
} from "@/plugins/workflows/useWorkflowCanvas";
import workflowService from "@/services/workflows";

// Emitted after a successful save so the parent WorkflowsList refreshes its rows.
const emit = defineEmits<{ (e: "saved"): void }>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

// On edit the saved name is the title; on create it's "New Workflow" — the same
// label as the list's create button, mirroring how the pipeline editor's create
// route reuses `pipeline.addPipeline` for its crumb (the name itself is typed in
// the title-trail input). Shared by the `title` prop (which feeds the h1's
// tooltip) and the `#title` slot that renders it next to the Beta tag.
const headerTitle = computed(() =>
  workflowObj.isEditWorkflow
    ? workflowObj.currentSelectedWorkflow.name || t("workflow.header")
    : t("workflow.create"),
);
const {
  resetWorkflowData,
  deleteNode,
  cancelDeleteNode,
  addNodeAfter,
  addTriggerNode,
  closeStepPicker,
  onDragStart,
  addNodeToEnd,
} = useWorkflowCanvas();

// Docked palette items, grouped into sections (Transform / Destination) to
// mirror the pipeline sidebar. The trigger is pre-placed and not addable, so
// there's no Source section. Icons reuse the pipeline node images (shared map)
// so the two palettes look identical — the shared palette renders an "img:"
// glyph as an <img>, else falls back to the OIcon name. Workflows support
// click-to-append (addNodeToEnd) in addition to drag.
const paletteCard = (nt: string) => {
  const m = nodeMeta(nt);
  const img = m?.image;
  return {
    label: t(m?.titleKey || nt),
    icon: img ? "img:" + img : m?.icon || "help",
    io_type: m?.ioType || "default",
    subtype: nt,
    tooltip: t(m?.descKey || ""),
    isSectionHeader: false,
  };
};
const paletteItems = computed(() => {
  const transforms = ADDABLE_NODE_TYPES.filter((nt) => nodeMeta(nt)?.ioType !== "output");
  const destinations = ADDABLE_NODE_TYPES.filter((nt) => nodeMeta(nt)?.ioType === "output");
  return [
    { label: t("workflow.node.sectionTransform"), isSectionHeader: true },
    ...transforms.map(paletteCard),
    { label: t("workflow.node.sectionDestination"), isSectionHeader: true },
    ...destinations.map(paletteCard),
  ];
});
const paletteDragStart = (e: DragEvent, item: any) => onDragStart(e, item.subtype);
const paletteClick = (item: any) => addNodeToEnd(item.subtype);

// In "trigger" mode the picker is the workflow's FIRST node, so it offers the
// trigger types; otherwise it offers the addable step types.
const isTriggerStep = computed(() => workflowObj.stepPicker.mode === "trigger");

// Items for the shared step picker.
const stepItems = computed(() =>
  (isTriggerStep.value ? TRIGGER_NODE_TYPES : ADDABLE_NODE_TYPES).map((nt: string) => {
    const m = nodeMeta(nt);
    const img = m?.image;
    return {
      key: nt,
      title: t(m?.titleKey || nt),
      description: t(m?.descKey || ""),
      icon: img ? `img:${img}` : m?.icon || "help",
      iconTint:
        m?.category === "action"
          ? "bg-badge-success-soft-bg text-badge-success-soft-text"
          : m?.category === "trigger"
            ? "bg-badge-blue-soft-bg text-badge-blue-soft-text"
            : "bg-badge-warning-soft-bg text-badge-warning-soft-text",
      // v1 has one trigger kind; when more land they become their own
      // TRIGGER_NODE_TYPES entries carrying their own kind.
      trigger_kind: "alert_fired",
    };
  }),
);

const onStepPick = (item: any) => {
  const { source, handle, mode, position } = workflowObj.stepPicker;
  closeStepPicker();
  // The trigger has nothing before it, so it is placed rather than appended.
  if (mode === "trigger") addTriggerNode(item.key, item.trigger_kind, position);
  else addNodeAfter(source, handle, item.key);
};

const orgId = () => store.state.selectedOrganization.identifier as string;

// Start a fresh workflow on an EMPTY canvas. It used to pre-place an Alert
// Trigger node here; the canvas now shows a "Choose a Trigger" start node that
// opens the trigger picker, the same shape as the pipeline editor's source
// start node. That scales as more trigger kinds land — a seeded node can only
// ever pick one — and keeps create/extend a single interaction.
//
// Nothing is staged here, so no drawer opens on arrival: the config panel is a
// consequence of CHOOSING a trigger, not of landing on the page.
const startNewWorkflow = () => {
  resetWorkflowData();
  workflowObj.isEditWorkflow = false;
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
  const trigger = nodes.find((n: any) => n.data?.node_type === "workflow_trigger");
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
  const orphan = nodes.find((n: any) => n.id !== trigger.id && !targets.has(n.id));
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
    created_by: "",
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

// Persist (create or update) WITHOUT navigating — returns true on success.
// Shared by the Save button (which then returns to the list) and Save & Test
// (which then opens the Test drawer). On create it captures the new id so the
// workflow is immediately editable/testable. Emits `saved` so the parent list
// re-fetches (reaches WorkflowsList via its <router-view> slot binding).
const persist = async (): Promise<boolean> => {
  if (saving.value || !validate()) return false;
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
      if (newId) {
        workflowObj.currentSelectedWorkflow.id = newId;
        workflowObj.isEditWorkflow = true;
      }
      toast({ message: t("workflow.createSuccess"), variant: "success" });
    }
    workflowObj.dirtyFlag = false;
    emit("saved");
    return true;
  } catch (e: any) {
    toast({
      message: e?.response?.data?.message || t("workflow.saveError"),
      variant: "error",
    });
    return false;
  } finally {
    saving.value = false;
  }
};

// After a brand-new workflow is created, offer to link it to existing alerts
// (the link is stored on the alert side). Skipped on update — the workflow is
// already in place and can be linked from an alert's settings.
const linkAlerts = ref<{ show: boolean; id: string; name: string }>({
  show: false,
  id: "",
  name: "",
});

const onSave = async () => {
  const wasCreate = !workflowObj.currentSelectedWorkflow.id;
  if (!(await persist())) return;
  // persist() captures the new id on create; use it to open the link prompt.
  if (wasCreate && workflowObj.currentSelectedWorkflow.id) {
    linkAlerts.value = {
      show: true,
      id: workflowObj.currentSelectedWorkflow.id,
      name: workflowObj.currentSelectedWorkflow.name || "",
    };
    return;
  }
  goBack();
};

const onLinkAlertsDone = () => {
  linkAlerts.value.show = false;
  goBack();
};

// Test runs the SAVED graph. If the workflow is new or has unsaved edits, prompt
// to save first; otherwise open the Test drawer directly.
const saveTestConfirm = ref(false);
const onTest = () => {
  const wf = workflowObj.currentSelectedWorkflow;
  if (!wf.id || workflowObj.dirtyFlag) {
    saveTestConfirm.value = true;
    return;
  }
  workflowObj.testRun.show = true;
};
const confirmSaveAndTest = async () => {
  saveTestConfirm.value = false;
  if (await persist()) workflowObj.testRun.show = true;
};

// History → the dedicated read-only Runs inspection view (separate surface).
const openRuns = () => {
  router.push({
    name: "workflowRuns",
    query: {
      id: workflowObj.currentSelectedWorkflow.id,
      name: workflowObj.currentSelectedWorkflow.name,
      org_identifier: orgId(),
    },
  });
};

onMounted(async () => {
  const query = router.currentRoute.value.query;
  const id = query.id as string | undefined;
  if (id) {
    // Edit-from-list already hydrated the shared state synchronously; only
    // re-fetch on a cold load (deep link / refresh) where it's missing.
    if (workflowObj.currentSelectedWorkflow?.id !== id) await loadWorkflow(id);
  } else {
    startNewWorkflow();
  }
});

onBeforeUnmount(() => resetWorkflowData());
</script>
