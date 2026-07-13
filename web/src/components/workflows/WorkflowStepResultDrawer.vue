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
    <div class="tw:flex tw:flex-col tw:gap-3 tw:p-4 tw:h-full tw:min-h-0">
      <!-- status — the drawer only opens for error nodes, so it's always Errored -->
      <div class="tw:flex tw:items-center tw:justify-end">
        <OBadge variant="error-soft" size="sm">
          {{ t("workflow.test.stepResult.status.error") }}
        </OBadge>
      </div>

      <!-- Input | Output, side by side (fullscreenable as one unit).
           flex-1 + min-h-0 so it fills the drawer body down to the footer. -->
      <div
        ref="ioContainerRef"
        class="io-container tw:flex tw:gap-2 tw:flex-1 tw:min-h-0"
        :class="{ 'io-container-dark': isDark }"
      >
        <!-- Input -->
        <div class="io-section tw:w-1/2">
          <div
            class="section-label tw:font-bold tw:flex tw:items-center tw:justify-between"
          >
            <div>{{ t("workflow.test.stepResult.input") }}</div>
            <div class="tw:flex tw:items-center tw:gap-1">
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
                :disabled="!editableInput"
                @click="copy(editableInput, 'input')"
              >
                <OIcon name="content-copy" size="xs" />
              </OButton>
            </div>
          </div>
          <!-- Input is EDITABLE — edit it and Replay re-runs from this step with
               your input (that's what makes Replay useful). -->
          <div class="io-content-box">
            <CodeQueryEditor
              editor-id="workflow-step-input"
              language="json"
              :query="editableInput"
              :show-auto-complete="false"
              @update:query="editableInput = $event"
            />
          </div>
          <div
            v-if="editableInput && inputInvalid"
            class="wf-input-error tw:mt-1"
          >
            {{ t("workflow.test.invalidJson") }}
          </div>
        </div>

        <!-- Output -->
        <div class="io-section tw:w-1/2">
          <div
            class="section-label tw:font-bold tw:flex tw:items-center tw:justify-between"
          >
            <div>{{ t("workflow.test.stepResult.output") }}</div>
            <div class="tw:flex tw:items-center tw:gap-1">
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
          <div class="io-content-box">
            <!-- The step errored — show the error message(s) as the output. -->
            <div v-if="errorMessages.length" class="io-errors">
              <div
                v-for="(m, i) in errorMessages"
                :key="i"
                class="io-error-line"
              >
                {{ m }}
              </div>
            </div>
            <div v-else class="no-data-message">
              {{ t("workflow.test.stepResult.noOutput") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom footer so the Replay button can carry a hover tooltip. -->
    <template #footer>
      <div class="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:w-full">
        <OButton variant="outline" size="sm-action" @click="close">
          {{ t("common.close") }}
        </OButton>
        <OTooltip
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

const isDark = computed(() => store.state.theme === "dark");

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

// ONE central input, shared with the Test dialog (workflowObj.testRun.input).
// Editing it here or in the Test dialog stays in sync; Replay from this node
// feeds this same payload. Bound directly — no per-node copies to desync.
const editableInput = computed<string>({
  get: () => workflowObj.testRun.input || "",
  set: (val: string) => (workflowObj.testRun.input = val),
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

<style scoped>
.io-section {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}
.section-label {
  color: var(--o2-text-primary);
  font-size: 14px;
  margin-bottom: 0.5rem;
}
.io-content-box {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--o2-border-color, #e5e7eb);
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--o2-code-bg);
}
.no-data-message {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  font-style: italic;
  font-size: 14px;
  color: var(--o2-text-secondary, #8a94a6);
}
.io-errors {
  height: 100%;
  overflow: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.io-error-line {
  font-size: 12px;
  line-height: 1.4;
  color: #b91c1c;
  white-space: pre-wrap;
}
.wf-input-error {
  font-size: 11px;
  line-height: 1.3;
  color: #b91c1c;
}

/* Fullscreen: the io-container fills the screen with both panels stretched. */
.io-container:fullscreen {
  background-color: #f5f5f5;
  padding: 0.75rem;
  height: 100vh;
  max-height: 100vh;
  gap: 0.5rem;
  align-items: stretch;
}
.io-container:fullscreen .io-section {
  flex: 1;
}
.io-container:fullscreen .io-content-box {
  height: calc(100vh - 80px);
  max-height: unset;
}
.io-container-dark:fullscreen {
  background: #1e1e1e;
}
</style>
