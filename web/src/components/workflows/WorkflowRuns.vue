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
  specific run is shareable. "Edit Workflow" is the deliberate switch to the build
  canvas. Test lives here too — it's a read-only dry-run (never edits the graph),
  so there's no reason to force a trip to the editor just to run one; a test simply
  swaps the canvas from the selected historical run to the fresh test result.
-->
<template>
  <div data-test="workflow-runs-page" class="flex h-full min-h-0 flex-col">
    <OPageHeader
      :title="workflowName || t('workflow.runs.title')"
      :back="{
        label: t('workflow.header'),
        onClick: goBack,
        dataTest: 'workflow-runs-back',
      }"
      class="border-border-default border-b px-4"
    >
      <!-- Beta tag inside the title line (see WorkflowsList: #title-trail sits
           after the title+subtitle column, stranding it far from the title). -->
      <template #title>
        <span class="inline-flex min-w-0 items-center gap-2">
          <span class="truncate">{{ workflowName || t("workflow.runs.title") }}</span>
          <BetaBadge />
        </span>
      </template>
      <template #actions>
        <!-- Test is a read-only dry-run (it never edits the workflow), so it's
             offered here too — no need to switch to the editor just to test. -->
        <OButton variant="outline" data-test="workflow-runs-test" @click="onTest">
          {{ t("workflow.test.button") }}
        </OButton>
        <OButton variant="outline" data-test="workflow-runs-edit" @click="onEditWorkflow">
          {{ t("workflow.runs.edit") }}
        </OButton>
      </template>
    </OPageHeader>

    <div class="flex min-h-0 flex-1 gap-2 px-2 pt-3">
      <!-- Read-only canvas (per-node run status overlay). The SAME results dock as
           the editor docks the step Input/Output below the canvas once a run is
           loaded (read-only here) — instead of the old overlay drawer. -->
      <div class="rounded-surface bg-surface-subtle relative mb-3 min-w-0 flex-1 overflow-hidden">
        <WorkflowResultsDock>
          <WorkflowCanvas />
        </WorkflowResultsDock>
      </div>

      <!-- Persistent runs list (master-detail). -->
      <div
        class="rounded-surface border-border-default bg-surface-base mb-3 flex min-h-0 w-[27.5rem] max-w-[46%] shrink-0 flex-col overflow-hidden border"
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

    <!-- Test input popup — a fresh dry-run of the current graph, launched from the
         header. Results paint on the read-only canvas (switching it out of the
         selected historical run) and open in the results dock above. -->
    <WorkflowTestDialog v-if="workflowObj.testRun.show" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import WorkflowCanvas from "@/plugins/workflows/WorkflowCanvas.vue";
import WorkflowResultsDock from "./WorkflowResultsDock.vue";
import WorkflowTestDialog from "./WorkflowTestDialog.vue";
import WorkflowRunsPanel from "./WorkflowRunsPanel.vue";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
  loadWorkflowRun,
} from "@/plugins/workflows/useWorkflowCanvas";
import workflowService from "@/services/workflows";

const { t } = useI18nTyped();

const { resetWorkflowData } = useWorkflowCanvas(t);

const router = useRouter();
const store = useStore();

const orgId = computed(() => store.state.selectedOrganization.identifier as string);
const workflowId = computed(() => (router.currentRoute.value.query.id as string) || "");
const workflowName = computed(() => workflowObj.currentSelectedWorkflow?.name || "");
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

// Dry-run the current graph without leaving to the editor. Deselect the historical
// run first — the canvas is about to show the LIVE test result instead, and a
// lingering row highlight would misrepresent what's on the canvas. Clicking a run
// in the list again reloads history, toggling back.
const onTest = () => {
  selectedRunId.value = "";
  workflowObj.testRun.show = true;
};

// A live test result (from the header Test button, or a step drawer's "Use as Test
// Input" which drops the user into a fresh test) replaces the historical run on the
// canvas. Deselect the run so the list stops highlighting a row that no longer
// matches what's shown. A history load keeps `mode: "history"`, so it's left alone.
watch(
  () => workflowObj.testRun.result,
  (result: any) => {
    if (result && result.mode !== "history") selectedRunId.value = "";
  },
);

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
      message: raw(r.error || t("workflow.history.loadRunError")),
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
