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
  Workflow Test input panel. Collects the sample alert payload + optional
  run-from node, runs the SAVED workflow, and stores the per-node result on
  `workflowObj.testRun.result`. Results are then rendered as ✓ / error badges on
  the canvas nodes (WorkflowNode), not in this panel. A right-side drawer (not a
  centered dialog) so the JSON sample editor gets full drawer height instead of a
  cramped 240px box. A Destination step genuinely dispatches during a run.
-->
<template>
  <ODrawer
    v-model:open="open"
    data-test="workflow-test-drawer"
    size="xl"
    :title="t('workflow.test.title')"
    :primary-button-label="t('workflow.test.run')"
    :primary-button-disabled="!canRun"
    :primary-button-loading="running"
    :secondary-button-label="t('common.close')"
    @click:primary="run"
    @click:secondary="close"
  >
    <div class="flex flex-col gap-4 text-left h-full p-4">
      <!-- Run-from selector -->
      <div class="flex flex-col gap-1">
        <OText as="label" class="text-xs font-medium">
          {{ t("workflow.test.runFrom") }}
        </OText>
        <OSelect v-model="runFrom" :options="runFromOptions" data-test="workflow-test-run-from" />
        <OText v-if="workflowObj.testRun.fromNode" variant="meta" as="p">
          {{ t("workflow.test.runFromNote") }}
        </OText>
      </div>

      <!-- Sample input editor — fills the remaining drawer height -->
      <div class="flex flex-col gap-1 flex-1 min-h-0">
        <div class="flex items-center justify-between">
          <OText as="label" class="text-xs font-medium">
            {{ t("workflow.test.inputLabel") }}
          </OText>
          <OButton
            variant="outline"
            size="sm"
            data-test="workflow-test-reset-sample"
            @click="resetSample"
          >
            {{ t("common.reset") }}
          </OButton>
        </div>
        <div class="flex-1 min-h-0 rounded-default border border-border-default overflow-hidden">
          <CodeQueryEditor
            editor-id="workflow-test-input"
            language="json"
            :query="workflowObj.testRun.input"
            :show-auto-complete="false"
            @update:query="workflowObj.testRun.input = $event"
          />
        </div>
        <OText v-if="parseError" variant="meta" as="p" class="text-input-error-text">
          {{ t("workflow.test.invalidJson") }}
        </OText>
        <OText v-else variant="meta" as="p">
          {{ t("workflow.test.resultHint") }}
        </OText>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import {
  workflowObj,
  nodeMeta,
  executeTestRun,
  flowOrderedNodeIds,
  nodeConfigDetail,
} from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSampleText } from "@/plugins/workflows/testSample";

const { t } = useI18n();
const store = useStore();

const running = ref(false);
// v-model:open — closing the dialog (X / overlay) clears the flag.
const open = computed({
  get: () => workflowObj.testRun.show,
  set: (v: boolean) => (workflowObj.testRun.show = v),
});

const nodes = computed<any[]>(() => workflowObj.currentSelectedWorkflow?.nodes || []);
const edges = computed<any[]>(() => workflowObj.currentSelectedWorkflow?.edges || []);

// Seed the sample payload the first time the dialog opens (persisted after).
onMounted(() => {
  if (!workflowObj.testRun.input) {
    workflowObj.testRun.input = buildTestSampleText();
  }
});

// Display-only sentinel for the "Beginning" option. OSelect treats "" as
// no-selection (blank trigger) and its null option round-trips awkwardly through
// Reka — so the select uses this non-empty value, and the `runFrom` proxy below
// maps it to/from the real `fromNode = ""`. The sentinel never leaves this file.
const RUN_FROM_BEGINNING = "__beginning__";

// v-model proxy for the Run-From select: "" (beginning) shows as the sentinel;
// picking the sentinel writes "" back to fromNode.
const runFrom = computed<string>({
  get: () => workflowObj.testRun.fromNode || RUN_FROM_BEGINNING,
  set: (v) => {
    workflowObj.testRun.fromNode = v === RUN_FROM_BEGINNING ? "" : v;
  },
});

// A node's configured detail, so two same-type nodes are distinguishable
// (shared helper — same detail the canvas card shows).
const nodeDetail = (n: any): string => nodeConfigDetail(n.data, 40);

// Nodes in graph (flow) order so the dropdown matches the canvas top-to-bottom
// instead of raw insertion order (shared BFS helper — same one the reveal uses).
const nodesInFlowOrder = (): any[] => {
  const byId = new Map<string, any>(nodes.value.map((n) => [n.id, n]));
  return flowOrderedNodeIds(nodes.value, edges.value)
    .map((id) => byId.get(id))
    .filter(Boolean);
};

const runFromOptions = computed(() => {
  const steps = nodesInFlowOrder().filter((n) => n.data?.node_type !== "workflow_trigger");
  // Per-type totals so we only number when a type repeats.
  const totals: Record<string, number> = {};
  for (const n of steps) {
    const type = n.data?.node_type;
    totals[type] = (totals[type] || 0) + 1;
  }
  const seen: Record<string, number> = {};
  const opts = steps.map((n) => {
    const type = n.data?.node_type;
    seen[type] = (seen[type] || 0) + 1;
    const base = t(nodeMeta(type)?.titleKey || type);
    const numbered = totals[type] > 1 ? `${base} ${seen[type]}` : base;
    const detail = nodeDetail(n);
    return { label: detail ? `${numbered} · ${detail}` : numbered, value: n.id };
  });
  return [{ label: t("workflow.test.runFromBeginning"), value: RUN_FROM_BEGINNING }, ...opts];
});

const parsedInputs = computed<unknown[] | null>(() => {
  try {
    const v = JSON.parse(workflowObj.testRun.input);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
});
const parseError = computed(() => parsedInputs.value === null);
const canRun = computed(() => !parseError.value && !running.value);

const orgId = () => store.state.selectedOrganization.identifier as string;

const run = async () => {
  if (!canRun.value || !parsedInputs.value) return;
  running.value = true;
  // Shared runner: hits the test endpoint, then plays the staged reveal on the
  // canvas (nodes light up one-by-one down the graph). Replay reuses the same.
  const r = await executeTestRun({
    orgId: orgId(),
    inputs: parsedInputs.value,
    fromNode: workflowObj.testRun.fromNode || undefined,
  });
  running.value = false;
  if (r.ok) workflowObj.testRun.show = false;
  else
    toast({
      message: r.error || t("workflow.test.runError"),
      variant: "error",
    });
};

const resetSample = () => {
  workflowObj.testRun.input = buildTestSampleText();
};
const close = () => {
  workflowObj.testRun.show = false;
};
</script>
