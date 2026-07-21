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

  Data: the test response is errors-only today, so for an ERROR node the input is
  derived from the errored records (`NodeErrors`) and the output is the error
  messages; Replay works. For an OK/skipped node there's no captured I/O yet, so
  the panels show a placeholder — they fill in automatically once the backend
  returns per-node `node_io { input, output }` (already read here when present).
-->
<template>
  <ODrawer
    :open="true"
    size="xl"
    data-test="workflow-step-result-drawer"
    :title="drawerTitle"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3 p-4 h-full min-h-0">
      <!-- status — the drawer only opens for error nodes, so it's always Errored -->
      <div class="flex items-center justify-end">
        <OBadge variant="error-soft" size="sm">
          {{ t("workflow.test.stepResult.status.error") }}
        </OBadge>
      </div>

      <!-- Input | Output, side by side (fullscreenable as one unit).
           flex-1 + min-h-0 so it fills the drawer body down to the footer. -->
      <div
        ref="ioContainerRef"
        data-test="workflow-step-io-container"
        class="flex gap-2 flex-1 min-h-0"
        :class="{
          'bg-surface-subtle p-3 h-screen max-h-screen items-stretch':
            isFullscreen,
        }"
      >
        <!-- Input -->
        <div class="flex flex-col h-full min-w-0 w-1/2">
          <div
            class="text-text-body text-sm mb-2 font-bold flex items-center justify-between"
          >
            <div>{{ t("workflow.test.stepResult.input") }}</div>
            <div class="flex items-center gap-1">
              <OButton
                variant="outline"
                size="icon"
                :title="fullscreenTitle"
                @click="toggleFullscreen"
              >
                <OIcon
                  :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
                  size="xs"
                />
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
            class="flex-1 min-h-0 border border-border-default rounded-default overflow-hidden bg-code-bg"
          >
            <CodeQueryEditor
              editor-id="workflow-step-input"
              language="json"
              :query="inputModel"
              :read-only="isHistory"
              :show-auto-complete="false"
              @update:query="inputModel = $event"
            />
          </div>
          <div
            v-if="!isHistory && editableInput && inputInvalid"
            data-test="workflow-step-result-input-error"
            class="text-xs leading-snug text-input-error-text mt-1"
          >
            {{ t("workflow.test.invalidJson") }}
          </div>
        </div>

        <!-- Output -->
        <div class="flex flex-col h-full min-w-0 w-1/2">
          <div
            class="text-text-body text-sm mb-2 font-bold flex items-center justify-between"
          >
            <div>{{ t("workflow.test.stepResult.output") }}</div>
            <div class="flex items-center gap-1">
              <OButton
                variant="outline"
                size="icon"
                :title="fullscreenTitle"
                @click="toggleFullscreen"
              >
                <OIcon
                  :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
                  size="xs"
                />
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
            class="flex-1 min-h-0 border border-border-default rounded-default overflow-hidden bg-code-bg"
          >
            <!-- The step errored — show the error message(s) as the output. -->
            <div
              v-if="errorMessages.length"
              class="h-full overflow-auto px-3 py-2.5 flex flex-col gap-1.5"
            >
              <div
                v-for="(m, i) in errorMessages"
                :key="i"
                data-test="workflow-step-result-error-line"
                class="text-xs leading-snug whitespace-pre-wrap text-status-error-text"
              >
                {{ m }}
              </div>
            </div>
            <div
              v-else
              data-test="workflow-step-result-no-output"
              class="h-full flex items-center justify-center p-8 text-center italic text-sm text-text-secondary"
            >
              {{ t("workflow.test.stepResult.noOutput") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom footer so the Replay button can carry a hover tooltip. -->
    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
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
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const store = useStore();

const nodeId = computed(() => workflowObj.testRun.resultDrawer.nodeId);
const result = computed<any>(() => workflowObj.testRun.result);

const node = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow?.nodes || []).find(
    (n: any) => n.id === nodeId.value,
  ),
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

// A history run is read-only (viewing a past execution). A live Test run is
// editable + replayable.
const isHistory = computed(() => result.value?.mode === "history");

// ONE central input, shared with the Test dialog (workflowObj.testRun.input).
// Editing it here or in the Test dialog stays in sync; Replay from this node
// feeds this same payload. Bound directly — no per-node copies to desync.
const editableInput = computed<string>({
  get: () => workflowObj.testRun.input || "",
  set: (val: string) => (workflowObj.testRun.input = val),
});

// History mode: the per-node input captured for this run (node_map[nodeId]),
// pretty-printed and read-only.
const nodeInputText = computed<string>(() => {
  const v = result.value?.nodeInputs?.[nodeId.value];
  return v == null ? "" : JSON.stringify(v, null, 2);
});

// What the Input editor shows: read-only per-node input for a past run, else the
// editable central input. The setter no-ops in history mode.
const inputModel = computed<string>({
  get: () => (isHistory.value ? nodeInputText.value : editableInput.value),
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

// Output copy = the error text.
const copyableOutput = computed(() => errorMessages.value.join("\n"));

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
onMounted(() => {
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
</script>
