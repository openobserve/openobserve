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
  Per-step Test result CONTENT — the Input / Output panes, status, copy,
  fullscreen, "Use as Test Input" and Replay for a single node. Shared by the
  results dock (WorkflowResultsPanel) in BOTH the editor and the read-only Runs
  view, so they render identical content from one source. The node is passed in
  via `nodeId`; everything else reads the shared testRun state (read-only when the
  run is historical — see `isHistory`).

  Data: the test response carries a per-node `inputs` map. Input = the records
  THIS node received (nodeTestInput). Output = what it emitted, derived per
  outgoing edge as the downstream node's input (nodeTestOutputBranches) — the graph
  is a single-incoming tree, so a child's input IS this node's output on that edge.
-->
<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- Input | Output, side by side (fullscreenable as one unit).
         flex-1 + min-h-0 so it fills the body down to the action row.
         The run status badge sits inline after the "Output" heading (below)
         rather than on its own line, to save vertical space in the dock. -->
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
            <OTooltip :content="useInputTooltip" :delay="300" side="top">
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
             it. History mode: read-only per-node input captured for the run. -->
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
          v-if="!isHistory && receivedRecords && inputInvalid"
          data-test="workflow-step-result-input-error"
          class="text-input-error-text mt-1 text-xs leading-snug"
        >
          {{ t("workflow.test.invalidJson") }}
        </div>
      </div>

      <!-- Output -->
      <div class="flex h-full w-1/2 min-w-0 flex-col">
        <div class="text-text-body mb-2 flex items-center justify-between text-sm font-bold">
          <div class="flex items-center gap-2">
            <span>{{ t("workflow.test.stepResult.output") }}</span>
            <!-- Run status (Passed / Errored / No Records) — inline after the
                 heading, same source as the node's canvas badge. -->
            <OBadge :variant="statusVariant" size="sm" data-test="workflow-step-result-status">
              {{ t(`workflow.test.stepResult.status.${stepStatus}`) }}
            </OBadge>
          </div>
          <div class="flex items-center gap-1">
            <OTooltip :content="useOutputTooltip" :delay="300" side="top">
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
          <div
            v-if="outputIsEmpty"
            data-test="workflow-step-result-output-empty"
            class="text-text-secondary flex h-full items-center justify-center p-8 text-center text-sm italic"
          >
            {{ outputEmptyMessage }}
          </div>
          <template v-else>
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

    <!-- Replay only makes sense for a live Test run — a past run is read-only. -->
    <div v-if="!isHistory" class="flex shrink-0 items-center justify-end">
      <OTooltip :content="t('workflow.test.stepResult.replayHint')" :delay="300" side="top">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { toggleFullscreen as domToggleFullScreen } from "@/utils/dom";

import {
  workflowObj,
  nodeMeta,
  executeTestRun,
  nodeTestInput,
  nodeTestOutputBranches,
} from "@/plugins/workflows/useWorkflowCanvas";
import { toast } from "@/lib/feedback/Toast/useToast";

// The node whose result to show — supplied by the host (drawer or dock panel).
const props = defineProps<{ nodeId: string }>();
const emit = defineEmits<{ (e: "replayed"): void }>();

const { t } = useI18nTyped();
const store = useStore();

const nodeId = computed(() => props.nodeId);
const result = computed<any>(() => workflowObj.testRun.result);

const node = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow?.nodes || []).find((n: any) => n.id === nodeId.value),
);

const errorEntries = computed<any[]>(() => {
  const raw = result.value?.errors?.[nodeId.value];
  return Array.isArray(raw?.errors) ? raw.errors : [];
});
const errorMessages = computed<string[]>(() =>
  errorEntries.value.map((e) => (Array.isArray(e) ? String(e[0]) : String(e))),
);

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

const deepUnwrapJson = (value: any): any => {
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
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
const prettyRecords = (records: any): string => JSON.stringify(deepUnwrapJson(records), null, 2);

const editableInput = ref("");
const seedInputFromRun = () => {
  const recs = nodeTestInput(nodeId.value);
  editableInput.value = recs == null ? "" : prettyRecords(recs);
};
seedInputFromRun();

const inputModel = computed<string>({
  get: () => editableInput.value,
  set: (val: string) => {
    if (!isHistory.value) editableInput.value = val;
  },
});

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
const receivedRecords = computed(() => nodeTestInput(nodeId.value) != null);

const isTerminal = computed(() => nodeTestOutputBranches(nodeId.value).length === 0);

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
const showBranchLabels = computed(() => isTerminal.value || outputBranchLabels.value.length > 1);

const emptyOutputMessage = computed(() =>
  node.value?.data?.node_type === "condition"
    ? t("workflow.test.stepResult.conditionNoMatch")
    : t("workflow.test.stepResult.branchFiltered"),
);

const showError = computed(() => errorMessages.value.length > 0);
const showForwarded = computed(() => !isTerminal.value || !showError.value);
const hasForwardedRecords = computed(() => showForwarded.value && !!outputRecordsText.value);
const showSectionHeadings = computed(() => showError.value && hasForwardedRecords.value);

const outputIsEmpty = computed(() => !showError.value && !hasForwardedRecords.value);
const outputEmptyMessage = computed(() =>
  isTerminal.value ? t("workflow.test.stepResult.destinationNoRecords") : emptyOutputMessage.value,
);

const copyableOutput = computed(() => {
  const parts: string[] = [];
  if (showError.value) parts.push(errorMessages.value.join("\n"));
  if (hasForwardedRecords.value && outputRecordsText.value) parts.push(outputRecordsText.value);
  return parts.join("\n\n");
});

const copy = (text: string, type: "input" | "output") => {
  if (!text) return;
  copyToClipboard(text, t, {
    successMessage: t(
      type === "input"
        ? "workflow.test.stepResult.copiedInput"
        : "workflow.test.stepResult.copiedOutput",
    ),
  });
};

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
watch(nodeId, seedInputFromRun);
// A fresh run replaces testRun.result; re-seed the editor from the new input.
watch(result, seedInputFromRun);
onMounted(() => {
  seedInputFromRun();
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
});

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
  if (r.ok) emit("replayed");
  else toast({ message: raw(r.error || t("workflow.test.runError")), variant: "error" });
};

const inputRecordsForTest = computed<any[] | null>(() => {
  const p = parsedReplayInput.value;
  return p && p.length ? p : null;
});
const outputRecordsForTest = computed<any[] | null>(() => {
  if (isTerminal.value) return nodeTestInput(nodeId.value);
  const recs = nodeTestOutputBranches(nodeId.value).flatMap((b) => b.records || []);
  return recs.length ? recs : null;
});

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
  workflowObj.testRun.resultDrawer = { show: false, nodeId: "" };
  workflowObj.testRun.show = true;
};

// Title helper exposed for hosts (drawer header).
defineExpose({ node });
</script>
