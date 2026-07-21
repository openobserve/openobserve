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
  Workflow Runs — the dedicated, READ-ONLY run-inspection surface (its own route,
  its own URL, deep-linkable by ?run_id). This is the industry-standard pattern
  (AWS Step Functions Execution Details, Airflow Dag Run, Camunda Operate): run
  inspection is separate from the build/edit canvas, presented as a master-detail:

    ┌──────────────────────────────┬──────────────────────┐
    │  read-only workflow canvas    │  persistent runs list │
    │  (per-node ✓/✗ overlay,       │  (timeline + table,   │
    │   click a node for I/O)       │   click a run to load)│
    └──────────────────────────────┴──────────────────────┘

  Selecting a run loads it onto the canvas (read-only) and updates ?run_id, so a
  specific run is shareable. "Edit Workflow" is the deliberate switch to the
  editor — the two surfaces never blur together, and nothing resizes mid-flow.
-->
<template>
  <div
    data-test="workflow-runs-page"
    class="flex flex-col h-full min-h-0"
  >
    <OPageHeader
      :title="workflowName || t('workflow.runs.title')"
      :back="{
        label: t('workflow.header'),
        onClick: goBack,
        dataTest: 'workflow-runs-back',
      }"
      class="px-4 border-b border-border-default"
    >
      <!-- Beta tag inside the title line (see WorkflowsList: #title-trail sits
           after the title+subtitle column, stranding it far from the title). -->
      <template #title>
        <span class="inline-flex items-center gap-2 min-w-0">
          <span class="truncate">{{
            workflowName || t("workflow.runs.title")
          }}</span>
          <BetaBadge />
        </span>
      </template>
      <template #actions>
        <OButton
          variant="outline"
          data-test="workflow-runs-edit"
          @click="onEditWorkflow"
        >
          {{ t("workflow.runs.edit") }}
        </OButton>
      </template>
    </OPageHeader>

    <div class="flex-1 flex min-h-0 pt-3 px-2 gap-2">
      <!-- Read-only canvas (per-node run status overlay). -->
      <div
        class="flex-1 relative min-w-0 rounded-xl overflow-hidden mb-3 bg-surface-subtle"
      >
        <WorkflowCanvas />
      </div>

      <!-- Persistent runs list (master-detail). -->
      <div
        class="w-[27.5rem] max-w-[46%] shrink-0 mb-3 rounded-xl overflow-hidden border border-border-default bg-surface-base flex flex-col min-h-0"
      >
        <WorkflowRunsPanel
          :org-id="orgId"
          :workflow-id="workflowId"
          :workflow-name="workflowName"
          :selected-run-id="selectedRunId"
          @select-run="onSelectRun"
        />
      </div>
    </div>

    <!-- Per-step Input/Output result drawer — opened by clicking an error node's
         badge. Read-only (no Replay on a historical run). -->
    <WorkflowStepResultDrawer v-if="workflowObj.testRun.resultDrawer.show" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import WorkflowCanvas from "@/plugins/workflows/WorkflowCanvas.vue";
import WorkflowStepResultDrawer from "./WorkflowStepResultDrawer.vue";
import WorkflowRunsPanel from "./WorkflowRunsPanel.vue";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
  loadWorkflowRun,
} from "@/plugins/workflows/useWorkflowCanvas";
import workflowService from "@/services/workflows";

const { resetWorkflowData } = useWorkflowCanvas();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgId = computed(
  () => store.state.selectedOrganization.identifier as string,
);
const workflowId = computed(
  () => (router.currentRoute.value.query.id as string) || "",
);
const workflowName = computed(
  () => workflowObj.currentSelectedWorkflow?.name || "",
);
const selectedRunId = ref<string>("");

// Steps this run executed that no longer exist in the workflow (deleted/edited
// since). Their badges can't render, so the canvas alone would under-report the
// run — the banner tells the user the graph has moved on.
const ghostNodeCount = computed(
  () => (workflowObj.testRun.result as any)?.ghostNodeIds?.length ?? 0,
);

const goBack = () => {
  router.push({ name: "workflows", query: { org_identifier: orgId.value } });
};

// Deliberate switch to the editor — the only bridge between inspect and build.
const onEditWorkflow = () => {
  router.push({
    name: "workflowEditor",
    query: {
      id: workflowId.value,
      name: workflowName.value,
      org_identifier: orgId.value,
    },
  });
};

// Cold-load hydrate (deep link / refresh): the list hydrates synchronously, so
// only re-fetch when the shared state doesn't already hold this workflow.
const loadWorkflow = async (id: string) => {
  try {
    const res = await workflowService.listWorkflows(orgId.value);
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

// Load a run onto the read-only canvas and deep-link it (?run_id) so it's
// shareable and survives refresh.
const onSelectRun = async (runId: string) => {
  const r = await loadWorkflowRun({
    orgId: orgId.value,
    workflowId: workflowId.value,
    runId,
  });
  if (!r.ok) {
    toast({
      message: r.error || t("workflow.history.loadRunError"),
      variant: "error",
    });
    return;
  }
  // The workflow was edited after this run: some steps it executed no longer
  // exist, so their badges (including errors) can't render and the run would
  // look cleaner than it was. Flag it once, on load — no permanent chrome.
  if (ghostNodeCount.value > 0) {
    toast({
      message: t("workflow.runs.staleGraphWarning", {
        count: ghostNodeCount.value,
      }),
      variant: "warning",
    });
  }
  selectedRunId.value = runId;
  router.replace({
    name: "workflowRuns",
    query: { ...router.currentRoute.value.query, run_id: runId },
  });
};

onMounted(async () => {
  // Read-only inspection surface — no editing on the canvas.
  workflowObj.readOnly = true;

  const id = workflowId.value;
  if (id && workflowObj.currentSelectedWorkflow?.id !== id) {
    await loadWorkflow(id);
  }
  // Deep-linked run (?run_id) — load it immediately.
  const runId = router.currentRoute.value.query.run_id as string | undefined;
  if (runId) await onSelectRun(runId);
});

onBeforeUnmount(() => {
  workflowObj.readOnly = false;
  resetWorkflowData();
});
</script>
