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
  a Test run. Shows the step's Input and Output side by side (with per-section
  copy + a shared fullscreen toggle, mirroring the LLM span preview), plus a
  Replay button that re-runs the workflow from this node with its input.

  Data: the test response carries a per-node `inputs` map. Input = the records
  THIS node received (nodeTestInput). Output = what it emitted, derived per
  outgoing edge as the downstream node's input (nodeTestOutputBranches) — the graph
  is a single-incoming tree, so a child's input IS this node's output on that edge.
  A terminal (destination) shows the records it sent externally; an errored node
  shows the error message(s). Opens for ANY node (✓ / grey / error), not just errors.
-->
<template>
  <ODrawer
    :open="true"
    size="xl"
    data-test="workflow-step-result-drawer"
    :title="drawerTitle"
    @update:open="onOpenChange"
  >
    <div class="flex h-full min-h-0 flex-col gap-3 p-4">
      <!-- status — reflects this node's actual test result (Errored / Passed /
           No Records), same as its canvas badge. -->
      <div class="flex items-center justify-end">
        <OBadge :variant="statusVariant" size="sm" data-test="workflow-step-result-status">
          {{ t(`workflow.test.stepResult.status.${stepStatus}`) }}
        </OBadge>
      </div>

      <!-- Input | Output, side by side (fullscreenable as one unit).
           flex-1 + min-h-0 so it fills the drawer body down to the footer. -->
      <div
        ref="ioContainerRef"
        data-test="workflow-step-io-container"
        class="flex min-h-0 flex-1 gap-2"
        :class="{
          'bg-surface-subtle h-screen max-h-screen items-stretch p-3': isFullscreen,
        }"
      >
        <!-- Input -->
        <div class="flex h-full w-1/2 min-w-0 flex-col">
          <div class="text-text-body mb-2 flex items-center justify-between text-sm font-bold">
            <div>{{ t("workflow.test.stepResult.input") }}</div>
            <div class="flex items-center gap-1">
              <OTooltip v-if="!isHistory" :content="useInputTooltip" :delay="300" side="top">
                <OButton
                  variant="outline"
                  size="icon"
                  :disabled="!inputRecordsForTest"
                  data-test="workflow-step-use-input-as-test"
                  @click="useAsTestInput(inputRecordsForTest)"
                >
                  <OIcon name="play-circle" size="xs" />
                </OButton>
              </OTooltip>
              <OButton
                variant="outline"
                size="icon"
                :title="fullscreenTitle"
                @click="toggleFullscreen"
              >
                <OIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" size="xs" />
              </OButton>
              <OButton
                variant="outline"
                size="icon"
                :title="t('workflow.test.stepResult.copyInput')"
                :disabled="!inputModel"
                @click="copy(inputModel, 'input')"
              >
                <OIcon name="content-copy" size="xs" />
              </OButton>
            </div>
          </div>
          <!-- Test mode: input is EDITABLE and Replay re-runs from this step with
               it. History mode: read-only per-node input captured for the run.
               When no records reached this step, show a clear empty state instead
               of a blank editor (which reads as "type something here"). -->
          <div
            class="border-border-default rounded-default bg-code-bg min-h-0 flex-1 overflow-hidden border"
          >
            <CodeQueryEditor
              v-if="receivedRecords"
              editor-id="workflow-step-input"
              language="json"
              :query="inputModel"
              :read-only="isHistory"
              :show-auto-complete="false"
              @update:query="inputModel = $event"
            />
            <div
              v-else
              data-test="workflow-step-result-no-input"
              class="text-text-secondary flex h-full items-center justify-center p-8 text-center text-sm italic"
            >
              {{ t("workflow.test.stepResult.noInput") }}
            </div>
          </div>
          <div
            v-if="!isHistory && receivedRecords && editableInput && inputInvalid"
            data-test="workflow-step-result-input-error"
            class="text-input-error-text mt-1 text-xs leading-snug"
          >
            {{ t("workflow.test.invalidJson") }}
          </div>
        </div>

        <!-- Output -->
        <div class="flex h-full w-1/2 min-w-0 flex-col">
          <div class="text-text-body mb-2 flex items-center justify-between text-sm font-bold">
            <div>{{ t("workflow.test.stepResult.output") }}</div>
            <div class="flex items-center gap-1">
              <OTooltip v-if="!isHistory" :content="useOutputTooltip" :delay="300" side="top">
                <OButton
                  variant="outline"
                  size="icon"
                  :disabled="!outputRecordsForTest"
                  data-test="workflow-step-use-output-as-test"
                  @click="useAsTestInput(outputRecordsForTest)"
                >
                  <OIcon name="play-circle" size="xs" />
                </OButton>
              </OTooltip>
              <OButton
                variant="outline"
                size="icon"
                :title="fullscreenTitle"
                @click="toggleFullscreen"
              >
                <OIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" size="xs" />
              </OButton>
              <OButton
                variant="outline"
                size="icon"
                :title="t('workflow.test.stepResult.copyOutput')"
                :disabled="!copyableOutput"
                @click="copy(copyableOutput, 'output')"
              >
                <OIcon name="content-copy" size="xs" />
              </OButton>
            </div>
          </div>
          <div
            class="border-border-default rounded-default bg-code-bg flex min-h-0 flex-1 flex-col overflow-hidden border"
          >
            <!-- Nothing produced (no error, no forwarded records) — one centered
                 empty state, matching the Input pane so both sides stay aligned. -->
            <div
              v-if="outputIsEmpty"
              data-test="workflow-step-result-output-empty"
              class="text-text-secondary flex h-full items-center justify-center p-8 text-center text-sm italic"
            >
              {{ outputEmptyMessage }}
            </div>
            <template v-else>
              <!-- Error message(s). Shown ABOVE the forwarded editor when a node
                   errored but still passed records on (e.g. a function that failed
                   on some records, forwarded others). -->
              <div
                v-if="showError"
                data-test="workflow-step-result-error-section"
                class="flex shrink-0 flex-col gap-1.5 overflow-auto p-2.5"
                :class="{ 'flex-1': !hasForwardedRecords }"
              >
                <div v-if="showSectionHeadings" class="text-status-error-text text-xs font-semibold">
                  {{ t("workflow.test.stepResult.errorHeading") }}
                </div>
                <div
                  v-for="(m, i) in errorMessages"
                  :key="i"
                  data-test="workflow-step-result-error-line"
                  class="text-status-error-text text-xs leading-snug whitespace-pre-wrap"
                >
                  {{ m }}
                </div>
              </div>

              <!-- Forwarded records in the SAME read-only editor the Input uses, so
                   the output gets JSON highlighting / folding. -->
              <template v-if="hasForwardedRecords">
                <div
                  v-if="showSectionHeadings"
                  class="text-text-secondary shrink-0 px-2.5 pt-2 text-xs font-semibold"
                >
                  {{ t("workflow.test.stepResult.forwardedHeading") }}
                </div>
                <div
                  v-for="(label, i) in showBranchLabels ? outputBranchLabels : []"
                  :key="i"
                  data-test="workflow-step-result-output-branch-label"
                  class="text-text-secondary flex shrink-0 items-center gap-1 px-2.5 pt-2 text-xs font-medium"
                >
                  <OIcon name="arrow-right" size="xs" />
                  <span class="min-w-0 truncate">{{ label }}</span>
                </div>
                <div class="min-h-0 flex-1" data-test="workflow-step-result-output-records">
                  <CodeQueryEditor
                    editor-id="workflow-step-output"
                    language="json"
                    :query="outputRecordsText || ''"
                    :read-only="true"
                    :show-auto-complete="false"
                  />
                </div>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom footer so the Replay button can carry a hover tooltip. -->
    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="close">
          {{ t("common.close") }}
        </OButton>
        <!-- Replay only makes sense for a live Test run — a past run is read-only. -->
        <OTooltip
          v-if="!isHistory"
          :content="t('workflow.test.stepResult.replayHint')"
          :delay="300"
          side="top"
        >
          <OButton
            variant="primary"
            size="sm-action"
            data-test="workflow-step-replay-btn"
            :disabled="!canReplay || replaying"
            :loading="replaying"
            @click="replay"
          >
            {{ t("workflow.test.stepResult.replay") }}
          </OButton>
        </OTooltip>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { toggleFullscreen as domToggleFullScreen } from "@/utils/dom";

import {
  workflowObj,
  nodeMeta,
  nodeConfigDetail,
  executeTestRun,
  nodeTestInput,
  nodeTestOutputBranches,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const store = useStore();

const nodeId = computed(() => workflowObj.testRun.resultDrawer.nodeId);
const result = computed<any>(() => workflowObj.testRun.result);

const node = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow?.nodes || []).find((n: any) => n.id === nodeId.value),
);

// Title = node type + its detail (e.g. "Function - error_fn"), capped at 30 chars.
const drawerTitle = computed(() => {
  const data = node.value?.data;
  const typeName = nodeMeta(data?.node_type)
    ? t(nodeMeta(data?.node_type)!.titleKey)
    : data?.node_type || "";
  const detail = nodeConfigDetail(data, 60);
  const full = detail ? `${typeName} - ${detail}` : typeName;
  return full.length > 30 ? `${full.slice(0, 30)}…` : full;
});

// The drawer only opens for ERROR nodes. NodeErrors serializes as
// { error_count, errors: [ [message, inputValue?], ... ] } — the Output is those
// error messages (no per-node node_io from the backend, by design).
const errorEntries = computed<any[]>(() => {
  const raw = result.value?.errors?.[nodeId.value];
  return Array.isArray(raw?.errors) ? raw.errors : [];
});
const errorMessages = computed<string[]>(() =>
  errorEntries.value.map((e) => (Array.isArray(e) ? String(e[0]) : String(e))),
);

// Header status — mirrors the node's canvas badge (same source of truth): Errored
// if it's in the errors map, Passed if records reached it, else No Records (it ran
// but was fed nothing — an upstream filter/error). The drawer opens for ANY node
// now, so this can't be hardcoded to "error".
const stepStatus = computed<"ok" | "error" | "skipped">(() => {
  const r = result.value;
  if (r?.errors?.[nodeId.value]) return "error";
  if (r?.inputs) return r.inputs[nodeId.value]?.length ? "ok" : "skipped";
  if (r?.blockedNodeIds?.includes(nodeId.value)) return "skipped";
  return "ok";
});
const statusVariant = computed<"error-soft" | "success-soft" | "default-soft">(() =>
  stepStatus.value === "error"
    ? "error-soft"
    : stepStatus.value === "ok"
      ? "success-soft"
      : "default-soft",
);

// A history run is read-only (viewing a past execution). A live Test run is
// editable + replayable.
const isHistory = computed(() => result.value?.mode === "history");

// A record's `data` field arrives JSON-stringified (a serialization artifact of
// the destination flattening), so a naive stringify renders it as an escaped
// one-liner. Recursively unwrap any string value that is itself JSON (object /
// array) so records read as clean nested JSON. Applied to BOTH panes' display.
const deepUnwrapJson = (value: any): any => {
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return deepUnwrapJson(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(deepUnwrapJson);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = deepUnwrapJson(value[k]);
    return out;
  }
  return value;
};
const prettyRecords = (records: any): string =>
  JSON.stringify(deepUnwrapJson(records), null, 2);

// Test mode: the Input editor shows the records THIS node actually received on
// the last run (from the backend `inputs` map), editable so Replay can re-run
// from here with a tweaked payload. The stringified `data` field is unwrapped for
// readability — Replay then sends that unwrapped shape (an accepted trade-off).
const editableInput = ref("");
const seedInputFromRun = () => {
  const recs = nodeTestInput(nodeId.value);
  editableInput.value = recs == null ? "" : prettyRecords(recs);
};
// Seed synchronously so the editor is populated on first paint (not a tick later);
// the watch + onMounted below re-seed if the selected node changes while open.
// Both Test and History runs carry the same per-node `inputs` map, so the Input is
// seeded the same way for both — history just renders it read-only (no Replay).
seedInputFromRun();

// What the Input editor shows. In history it's read-only (the editor's :read-only
// binding), so the setter no-ops.
const inputModel = computed<string>({
  get: () => editableInput.value,
  set: (val: string) => {
    if (!isHistory.value) editableInput.value = val;
  },
});

// Parsed editable input for Replay (must be a JSON array of records).
const parsedReplayInput = computed<any[] | null>(() => {
  const text = editableInput.value.trim();
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
});
const inputInvalid = computed(() => parsedReplayInput.value === null);

// Did records actually reach this node on the run? Based on what the backend
// captured (not the editable buffer), so it stays stable if the user clears the
// editor. When false, the Input pane shows an empty state instead of a blank
// editor, and Replay is disabled (there's nothing here to re-run).
const receivedRecords = computed(() => nodeTestInput(nodeId.value) != null);

// OUTPUT = per outgoing edge, the records the downstream node received (== what
// this node emitted on that branch). Empty array => terminal node (a sink) with
// no derivable downstream output. A branch with `records: null` passed nothing on
// (filtered out / never reached).
// A node with no outgoing edge is a terminal (destination/sink). Its "output" IS
// what it sends externally = the records it received.
const isTerminal = computed(() => nodeTestOutputBranches(nodeId.value).length === 0);

// The OUTPUT as ONE JSON document for the read-only editor — so it gets the same
// syntax highlighting / folding as the Input pane. A terminal shows the records it
// sent; a single downstream shows that branch's records; a fan-out shows an object
// keyed by "→ target" so each branch stays labelled. Null when nothing was emitted.
const outputRecordsText = computed<string | null>(() => {
  if (isTerminal.value) {
    const recs = nodeTestInput(nodeId.value);
    return recs == null ? null : prettyRecords(recs);
  }
  const branches = nodeTestOutputBranches(nodeId.value).filter((b) => b.records != null);
  if (!branches.length) return null;
  if (branches.length === 1) return prettyRecords(branches[0].records);
  const byBranch: Record<string, any> = {};
  for (const b of branches) {
    const typeName = nodeMeta(b.nodeType) ? t(nodeMeta(b.nodeType)!.titleKey) : b.nodeType;
    const label = b.detail ? `${typeName} · ${b.detail}` : typeName;
    byBranch[`→ ${label}`] = deepUnwrapJson(b.records);
  }
  return JSON.stringify(byBranch, null, 2);
});

// Caption line(s) shown above the output editor — where the records went and how
// many. One entry per downstream target (terminal → the external send).
const outputBranchLabels = computed<string[]>(() => {
  if (isTerminal.value) {
    const recs = nodeTestInput(nodeId.value);
    return recs && recs.length ? [t("workflow.test.stepResult.sentExternally")] : [];
  }
  return nodeTestOutputBranches(nodeId.value)
    .filter((b) => Array.isArray(b.records) && b.records.length)
    .map((b) => {
      const typeName = nodeMeta(b.nodeType) ? t(nodeMeta(b.nodeType)!.titleKey) : b.nodeType;
      return b.detail ? `${typeName} · ${b.detail}` : typeName;
    });
});
// A caption above the output editor is shown ONLY when it adds information: a
// terminal (names the external send) or a fan-out (distinguishes branches). For a
// single downstream the target is obvious from the canvas, so we show no caption at
// all — a "→ to node X" line there just reads as noise.
const showBranchLabels = computed(() => isTerminal.value || outputBranchLabels.value.length > 1);

// When nothing was emitted, explain WHY in the node's own terms: a condition
// matched nothing (the common, actionable case) vs. a generic drop.
const emptyOutputMessage = computed(() =>
  node.value?.data?.node_type === "condition"
    ? t("workflow.test.stepResult.conditionNoMatch")
    : t("workflow.test.stepResult.branchFiltered"),
);

// A node can BOTH error AND forward records (a function that errored on some
// records but passed others). Show the error text AND the forwarded editor. The
// exception is an errored TERMINAL (a failed send): no successful output to show.
const showError = computed(() => errorMessages.value.length > 0);
const showForwarded = computed(() => !isTerminal.value || !showError.value);
const hasForwardedRecords = computed(() => showForwarded.value && !!outputRecordsText.value);
// Label the two sections only when both are visible, so a plain output stays clean.
const showSectionHeadings = computed(() => showError.value && hasForwardedRecords.value);

// Nothing produced (no error, no forwarded records) → one centered empty state,
// same container pattern as the Input pane.
const outputIsEmpty = computed(() => !showError.value && !hasForwardedRecords.value);
const outputEmptyMessage = computed(() =>
  isTerminal.value
    ? t("workflow.test.stepResult.destinationNoRecords")
    : emptyOutputMessage.value,
);

// Output copy = the error text (if any) + the forwarded records.
const copyableOutput = computed(() => {
  const parts: string[] = [];
  if (showError.value) parts.push(errorMessages.value.join("\n"));
  if (hasForwardedRecords.value && outputRecordsText.value) parts.push(outputRecordsText.value);
  return parts.join("\n\n");
});

const copy = (text: string, type: "input" | "output") => {
  if (!text) return;
  copyToClipboard(text, {
    successMessage: t(
      type === "input"
        ? "workflow.test.stepResult.copiedInput"
        : "workflow.test.stepResult.copiedOutput",
    ),
  });
};

// Fullscreen the Input+Output container as one unit (mirrors the LLM preview).
const ioContainerRef = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);
const fullscreenTitle = computed(() =>
  t(
    isFullscreen.value
      ? "workflow.test.stepResult.exitFullscreen"
      : "workflow.test.stepResult.enterFullscreen",
  ),
);
const toggleFullscreen = () => {
  if (!ioContainerRef.value) return;
  domToggleFullScreen(ioContainerRef.value).catch((err: any) =>
    console.error("Failed to toggle fullscreen:", err),
  );
};
const onFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === ioContainerRef.value;
};
// Seed the Input editor with this node's received records when the drawer opens,
// and re-seed if the selected node changes while open (both Test and History).
watch(nodeId, seedInputFromRun);
onMounted(() => {
  seedInputFromRun();
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
});

// Replay = re-run the workflow from this node using the (editable) input.
const canReplay = computed(() => parsedReplayInput.value !== null);
const replaying = ref(false);

const replay = async () => {
  if (!canReplay.value || replaying.value || !parsedReplayInput.value) return;
  replaying.value = true;
  const r = await executeTestRun({
    orgId: store.state.selectedOrganization.identifier,
    inputs: parsedReplayInput.value,
    fromNode: nodeId.value,
  });
  replaying.value = false;
  if (r.ok) close();
  else
    toast({
      message: r.error || t("workflow.test.runError"),
      variant: "error",
    });
};

const close = () => {
  workflowObj.testRun.resultDrawer = { show: false, nodeId: "" };
};
const onOpenChange = (open: boolean) => {
  if (!open) close();
};

// "Use as Test Input" — promote a pane's records to the central test payload and
// open the Test dialog (set-and-open), so the WHOLE flow can be re-run with them.
// Input uses the (possibly edited) input editor; Output uses what the node emitted
// (its sent records for a terminal, or every downstream branch's records).
const inputRecordsForTest = computed<any[] | null>(() => {
  const p = parsedReplayInput.value;
  return p && p.length ? p : null;
});
const outputRecordsForTest = computed<any[] | null>(() => {
  if (isTerminal.value) return nodeTestInput(nodeId.value);
  const recs = nodeTestOutputBranches(nodeId.value).flatMap((b) => b.records || []);
  return recs.length ? recs : null;
});

// Disabled-state tooltips explain WHY there's nothing to use.
const useInputTooltip = computed(() =>
  inputRecordsForTest.value
    ? t("workflow.test.stepResult.useAsTestInput")
    : t("workflow.test.stepResult.useAsTestInputNoInput"),
);
const useOutputTooltip = computed(() =>
  outputRecordsForTest.value
    ? t("workflow.test.stepResult.useAsTestInput")
    : t("workflow.test.stepResult.useAsTestInputNoOutput"),
);

const useAsTestInput = (records: any[] | null) => {
  if (!records || !records.length) return;
  workflowObj.testRun.input = JSON.stringify(records, null, 2);
  close();
  workflowObj.testRun.show = true;
};
</script>
