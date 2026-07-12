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
  Workflow Test input popup. Collects the sample alert payload + optional
  run-from node, runs the SAVED workflow, and stores the per-node result on
  `workflowObj.testRun.result`. Results are then rendered as ✓ / error badges on
  the canvas nodes (WorkflowNode), not in this dialog — so it stays a compact
  input form. A Destination step genuinely dispatches during a run.
-->
<template>
  <ODialog
    v-model:open="open"
    data-test="workflow-test-dialog"
    size="lg"
    :title="t('workflow.test.title')"
    :primary-button-label="t('workflow.test.run')"
    :primary-button-disabled="!canRun"
    :primary-button-loading="running"
    :secondary-button-label="t('common.close')"
    @click:primary="run"
    @click:secondary="close"
  >
    <div class="tw:flex tw:flex-col tw:gap-4 tw:text-left">
      <OText variant="meta" as="p">{{ t("workflow.test.intro") }}</OText>

      <!-- Run-from selector -->
      <div class="tw:flex tw:flex-col tw:gap-1">
        <OText as="label" class="tw:text-[12px] tw:font-medium">
          {{ t("workflow.test.runFrom") }}
        </OText>
        <OSelect
          v-model="runFrom"
          :options="runFromOptions"
          data-test="workflow-test-run-from"
        />
        <OText v-if="workflowObj.testRun.fromNode" variant="meta" as="p">
          {{ t("workflow.test.runFromNote") }}
        </OText>
      </div>

      <!-- Sample input editor -->
      <div class="tw:flex tw:flex-col tw:gap-1">
        <div class="tw:flex tw:items-center tw:justify-between">
          <OText as="label" class="tw:text-[12px] tw:font-medium">
            {{ t("workflow.test.inputLabel") }}
          </OText>
          <OButton
            variant="ghost"
            size="sm"
            data-test="workflow-test-reset-sample"
            @click="resetSample"
          >
            {{ t("workflow.test.resetSample") }}
          </OButton>
        </div>
        <div
          class="tw:h-[240px] tw:rounded-md tw:border tw:border-border-default tw:overflow-hidden"
        >
          <CodeQueryEditor
            editor-id="workflow-test-input"
            language="json"
            :query="workflowObj.testRun.input"
            :show-auto-complete="false"
            @update:query="workflowObj.testRun.input = $event"
          />
        </div>
        <OText v-if="parseError" variant="meta" as="p" class="tw:text-error">
          {{ t("workflow.test.invalidJson") }}
        </OText>
        <OText v-else variant="meta" as="p">
          {{ t("workflow.test.resultHint") }}
        </OText>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import {
  workflowObj,
  nodeMeta,
  startTestPlayback,
  flowOrderedNodeIds,
  reachableFrom,
} from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSampleText } from "@/plugins/workflows/testSample";
import { getTruncatedConditions } from "@/utils/conditionPreview";
import workflowService from "@/services/workflows";

const { t } = useI18n();
const store = useStore();

const running = ref(false);
// v-model:open — closing the dialog (X / overlay) clears the flag.
const open = computed({
  get: () => workflowObj.testRun.show,
  set: (v: boolean) => (workflowObj.testRun.show = v),
});

const nodes = computed<any[]>(
  () => workflowObj.currentSelectedWorkflow?.nodes || [],
);
const edges = computed<any[]>(
  () => workflowObj.currentSelectedWorkflow?.edges || [],
);

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

// A node's configured detail, so two same-type nodes are distinguishable:
// Function -> its VRL function name, Destination -> its destination name,
// Condition -> a preview of its rule (same formatter the canvas card uses).
const nodeDetail = (n: any): string => {
  const type = n.data?.node_type;
  if (type === "function") return n.data?.name || "";
  if (type === "destination") return n.data?.destination_id || "";
  if (type === "condition")
    return getTruncatedConditions(n.data?.conditions, 40);
  return "";
};

// Nodes in graph (flow) order so the dropdown matches the canvas top-to-bottom
// instead of raw insertion order (shared BFS helper — same one the reveal uses).
const nodesInFlowOrder = (): any[] => {
  const byId = new Map<string, any>(nodes.value.map((n) => [n.id, n]));
  return flowOrderedNodeIds(nodes.value, edges.value)
    .map((id) => byId.get(id))
    .filter(Boolean);
};

const runFromOptions = computed(() => {
  const steps = nodesInFlowOrder().filter(
    (n) => n.data?.node_type !== "workflow_trigger",
  );
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
  return [
    { label: t("workflow.test.runFromBeginning"), value: RUN_FROM_BEGINNING },
    ...opts,
  ];
});

// Nodes that actually run for the chosen from_node (it + everything downstream).
const runningNodeIds = (): string[] => {
  const from = workflowObj.testRun.fromNode;
  if (!from) return nodes.value.map((n) => n.id);
  return [...reachableFrom(edges.value, [from])];
};

// Nodes downstream of an errored node. Since the backend reports only errors
// (no per-node success/processed count), we can't confirm these actually passed
// — records may not have reached them — so they must NOT show a ✓. They render a
// neutral "not verified" badge instead. (Strictly downstream — exclude the
// error nodes themselves, which show their own error badge.)
const downstreamOfErrors = (errorIds: string[]): string[] => {
  if (!errorIds.length) return [];
  const set = reachableFrom(edges.value, errorIds);
  for (const id of errorIds) set.delete(id);
  return [...set];
};

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
  try {
    const res = await workflowService.testWorkflow({
      org_identifier: orgId(),
      id: workflowObj.currentSelectedWorkflow.id,
      inputs: parsedInputs.value,
      from_node: workflowObj.testRun.fromNode || undefined,
    });
    // Close the popup and play the staged reveal on the canvas (nodes light up
    // one-by-one down the graph, so the run reads as flowing through it).
    workflowObj.testRun.show = false;
    const errors = res.data?.errors || {};
    startTestPlayback({
      errors,
      ranNodeIds: runningNodeIds(),
      // Downstream of an error → "not verified", not a ✓ (see helper above).
      blockedNodeIds: downstreamOfErrors(Object.keys(errors)),
    });
  } catch (e: any) {
    toast({
      message: e?.response?.data?.message || t("workflow.test.runError"),
      variant: "error",
    });
  } finally {
    running.value = false;
  }
};

const resetSample = () => {
  workflowObj.testRun.input = buildTestSampleText();
};
const close = () => {
  workflowObj.testRun.show = false;
};
</script>
