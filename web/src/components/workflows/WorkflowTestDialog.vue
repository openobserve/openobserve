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
  cramped 240px box. Destination steps are suppressed by default, so a Test cannot
  page on-call; switching that off dispatches for real and warns first.
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
    <div class="flex h-full flex-col gap-4 p-4 text-left">
      <!-- Run-from selector -->
      <div class="flex flex-col gap-1">
        <OText as="label" class="text-xs font-medium">
          {{ t("workflow.test.runFrom") }}
        </OText>
        <OSelect
          v-model="runFrom"
          :options="runFromOptions"
          icon-key="icon"
          data-test="workflow-test-run-from"
        />
        <OText v-if="workflowObj.testRun.fromNode" variant="meta" as="p">
          {{ t("workflow.test.runFromNote") }}
        </OText>
      </div>

      <!-- Destination dispatch control: safe by default, explicit when switched off -->
      <div class="flex flex-col gap-2">
        <OSwitch
          v-model="suppressDestinations"
          :label="t('workflow.test.suppressDestinations')"
          label-position="right"
          data-test="workflow-test-suppress-destinations"
        />
        <OText v-if="suppressDestinations" variant="meta" as="p">
          {{ t("workflow.test.suppressDestinationsHint") }}
        </OText>
        <OBanner
          v-else
          variant="warning"
          dense
          icon="warning"
          data-test="workflow-test-dispatch-warning"
        >
          {{ dispatchWarning }}
        </OBanner>
      </div>

      <!-- Sample input editor — fills the remaining drawer height -->
      <div class="flex min-h-0 flex-1 flex-col gap-1">
        <div class="flex items-center justify-between">
          <div class="flex min-w-0 items-center gap-2">
            <OText as="label" class="text-xs font-medium">
              {{ t("workflow.test.inputLabel") }}
            </OText>
            <!-- Provenance travels with the payload (it is persisted too), so a
                 hand-edited or run-seeded payload can never read as the sample. -->
            <OTag
              :variant="sourceVariant"
              size="sm"
              :label="sourceLabel"
              data-test="workflow-test-input-source"
            />
            <button
              v-if="canRevertInput"
              type="button"
              class="text-accent shrink-0 text-xs font-medium hover:underline"
              data-test="workflow-test-revert-input"
              @click="revertInput"
            >
              {{ t("workflow.test.revertInput") }}
            </button>
          </div>
          <div class="flex items-center gap-2">
            <OSelect
              v-if="hasPreviousRuns"
              v-model="pickedRunId"
              :options="runInputOptions"
              :loading="loadingRun"
              :placeholder="t('workflow.test.useRunInput')"
              class="w-56"
              data-test="workflow-test-run-picker"
            />
            <OButton
              variant="outline"
              size="sm"
              data-test="workflow-test-reset-sample"
              @click="resetSample"
            >
              {{ t("common.reset") }}
            </OButton>
          </div>
        </div>
        <div class="rounded-default border-border-default min-h-0 flex-1 overflow-hidden border">
          <CodeQueryEditor
            editor-id="workflow-test-input"
            language="json"
            :query="workflowObj.testRun.input"
            :show-auto-complete="false"
            @update:query="onInputEdited"
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
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import {
  workflowObj,
  nodeMeta,
  executeTestRun,
  flowOrderedNodeIds,
  nodeConfigDetail,
  nodeCustomName,
  currentTriggerKind,
  buildTriggerSampleText,
  runInputForNode,
  loadRunsHistory,
  loadWorkflowRun,
  isTestRun,
  LAST_TEST_RUN,
  persistTestData,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18nTyped();
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
    workflowObj.testRun.input = buildTriggerSampleText(currentTriggerKind());
    workflowObj.testRun.inputSource = "sample";
    workflowObj.testRun.inputRunLabel = "";
  }
  // State persisted before this flag existed carries no value; pin it ON so the
  // safe default is explicit rather than inferred from undefined.
  if (workflowObj.testRun.suppressDestinations === undefined) {
    workflowObj.testRun.suppressDestinations = true;
  }
  // The author opens Test with nothing loaded, so the past-runs list has to be
  // pulled here — otherwise there is never anything to pick from. Shared state,
  // so the Runs view and the NDV switcher reuse this same fetch.
  const id = workflowObj.currentSelectedWorkflow?.id;
  if (id) {
    const now = Date.now() * 1000;
    void loadRunsHistory({
      orgId: orgId(),
      workflowId: id,
      start: now - 7 * 24 * 60 * 60 * 1_000_000,
      end: now,
    });
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
    // Per-type glyph so a step's KIND is recognisable in the dropdown even when a
    // custom name (rename) hides the type from the label text.
    const icon = nodeMeta(type)?.icon || "help";
    const base = t(nodeMeta(type)?.titleKey || type);
    // Always keep the TYPE prefix so the kind reads clearly — a custom name (rename)
    // takes the detail slot ("Condition · My Name"); otherwise the config detail does.
    const custom = nodeCustomName(n);
    if (custom) return { label: raw(`${base} · ${custom}`), value: n.id, icon };
    const numbered = totals[type] > 1 ? raw(`${base} ${seen[type]}`) : base;
    const detail = nodeDetail(n);
    return { label: detail ? raw(`${numbered} · ${detail}`) : numbered, value: n.id, icon };
  });
  // "From Beginning" starts at the trigger, so surface the trigger's custom name
  // (rename) when set — e.g. "From Beginning · My Alert" — instead of a static label.
  const trigger = nodes.value.find((n) => n.data?.node_type === "workflow_trigger");
  const triggerName = trigger ? nodeCustomName(trigger) : "";
  const beginningLabel = triggerName
    ? raw(`${t("workflow.test.runFromBeginning")} · ${triggerName}`)
    : t("workflow.test.runFromBeginning");
  return [
    {
      label: beginningLabel,
      value: RUN_FROM_BEGINNING,
      icon: nodeMeta("workflow_trigger")?.icon || "notifications-active",
    },
    ...opts,
  ];
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

// Lives on the shared testRun state so a Run Step (canvas) honours the same choice.
const suppressDestinations = computed<boolean>({
  get: () => workflowObj.testRun.suppressDestinations !== false,
  set: (v) => (workflowObj.testRun.suppressDestinations = v),
});

// Destination steps that a live run would really deliver to. Named explicitly —
// "some destinations will fire" is not something an author can act on.
const liveDestinations = computed<string[]>(() => {
  const ids = nodesInFlowOrder()
    .filter((n) => n.data?.node_type === "destination")
    .map((n) => n.data?.destination_id)
    .filter(Boolean);
  return [...new Set(ids)];
});

const dispatchWarning = computed(() =>
  t("workflow.test.dispatchWarning", {
    destinations: liveDestinations.value.join(", "),
  }),
);

const run = async () => {
  if (!canRun.value || !parsedInputs.value) return;
  running.value = true;
  // Shared runner: hits the test endpoint, then plays the staged reveal on the
  // canvas (nodes light up one-by-one down the graph). Replay reuses the same.
  const r = await executeTestRun({
    orgId: orgId(),
    inputs: parsedInputs.value,
    fromNode: workflowObj.testRun.fromNode || undefined,
    suppressDestinations: suppressDestinations.value,
  });
  running.value = false;
  if (r.ok) workflowObj.testRun.show = false;
  else
    toast({
      message: raw(r.error || t("workflow.test.runError")),
      variant: "error",
    });
};

const seedSample = () => {
  workflowObj.testRun.input = buildTriggerSampleText(currentTriggerKind());
  workflowObj.testRun.inputSource = "sample";
  workflowObj.testRun.inputRunLabel = "";
};

const resetSample = () => seedSample();
const revertInput = () => seedSample();

// The editor re-emits its own value on mount/format, so only a real text change
// counts as a hand edit — otherwise an untouched sample relabels itself.
const onInputEdited = (text: string) => {
  if (text === workflowObj.testRun.input) return;
  workflowObj.testRun.input = text;
  workflowObj.testRun.inputSource = "edited";
  workflowObj.testRun.inputRunLabel = "";
  persistTestData();
};

const sourceLabel = computed<I18nText>(() => {
  if (workflowObj.testRun.inputSource === "edited") return t("workflow.test.source.edited");
  if (workflowObj.testRun.inputSource === "run")
    return t("workflow.test.source.run", { run: workflowObj.testRun.inputRunLabel });
  return t("workflow.test.source.sample");
});

const sourceVariant = computed(() =>
  workflowObj.testRun.inputSource === "sample" ? "default-soft" : "warning-soft",
);

// Only non-generated data needs a way back; the generated sample IS the origin.
const canRevertInput = computed(() => workflowObj.testRun.inputSource !== "sample");

const hasPreviousRuns = computed(() => runInputOptions.value.length > 0);
const loadingRun = ref(false);
const selectedRunId = ref("");

// Writable proxy: picking a run in the select immediately loads it and seeds the
// editor, so there is no second "apply" step to forget.
const pickedRunId = computed<string>({
  get: () => selectedRunId.value,
  set: (v) => {
    selectedRunId.value = v;
    void useRunInput(v);
  },
});

// A Test run records trigger metadata but NO payload server-side, so it can never
// seed an input. Listing it as pickable would let the author choose it and only
// then be told it is unusable — so it is offered disabled, with the reason inline.
const runInputOptions = computed(() => {
  // The in-memory test run is offered FIRST: its inputs are already here
  // (sessionStorage), so it needs no fetch and is the run an author re-tests most.
  const local = runInputForNode(workflowObj.testRun.fromNode || "")?.length
    ? [
        {
          isRunOption: true,
          value: LAST_TEST_RUN,
          disabled: false,
          label: t("workflow.test.lastTestRun"),
        },
      ]
    : [];
  return local.concat(
    // Test runs keep no server-side payload, and the one replayable test run is
    // already the local entry above — listing the others as dead rows would offer
    // the author choices that cannot be acted on.
    [...workflowObj.runsHistory.list]
      .filter((r: any) => !isTestRun(r))
      .sort((a: any, b: any) => (b.start_time || 0) - (a.start_time || 0))
      .map((r: any) => ({
        isRunOption: true,
        value: r.run_id,
        disabled: false,
        label: raw(
          timestampToTimezoneDate(Math.floor((r.start_time || 0) / 1000), store.state.timezone),
        ),
      })),
  );
});

// ONE fetch pulls the whole run (every node's input_map); the payload we seed is
// then just a slice of it — the Run-From node's own input, or the trigger's when
// running from the beginning. No per-step fetching.
const seedFromRun = (records: any[], runId: string) => {
  workflowObj.testRun.input = JSON.stringify(records, null, 2);
  workflowObj.testRun.inputSource = "run";
  workflowObj.testRun.inputRunLabel = runLabelFor(runId);
  persistTestData();
};

// The dropdown's own label, so the provenance line names the run the way the
// author picked it rather than re-deriving a second format for the same run.
const runLabelFor = (runId: string): string =>
  String(runInputOptions.value.find((o) => o.value === runId)?.label || runId);

const useRunInput = async (runId: string) => {
  if (!runId) return;
  // Already in memory — no request, and no run to load onto the canvas.
  if (runId === LAST_TEST_RUN) {
    const local = runInputForNode(workflowObj.testRun.fromNode || "");
    if (local?.length) seedFromRun(local, runId);
    return;
  }
  loadingRun.value = true;
  const r = await loadWorkflowRun({
    orgId: orgId(),
    workflowId: workflowObj.currentSelectedWorkflow?.id || "",
    runId,
  });
  loadingRun.value = false;
  if (!r.ok) {
    toast({ message: raw(r.error || t("workflow.history.loadRunError")), variant: "error" });
    return;
  }
  const recs = runInputForNode(workflowObj.testRun.fromNode || "");
  if (!recs?.length) {
    toast({ message: t("workflow.test.runHasNoInput"), variant: "warning" });
    return;
  }
  seedFromRun(recs, runId);
};
const close = () => {
  workflowObj.testRun.show = false;
};
</script>
