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
  a Test run. Shows the step's Input and Output side by side, plus a Replay button
  that re-runs the workflow from this node with its input.

  Data: the backend test response is errors-only today, so for an ERROR node the
  input is derived from the errored records (`NodeErrors`) and the output is the
  error messages; Replay works. For an OK/skipped node there's no captured I/O
  yet, so the panels show a placeholder — they fill in automatically once the
  backend returns per-node `node_io { input, output }` (the drawer already reads
  that field when present).
-->
<template>
  <ODrawer
    :open="true"
    size="xl"
    data-test="workflow-step-result-drawer"
    :title="drawerTitle"
    :primary-button-label="t('workflow.test.stepResult.replay')"
    :primary-button-disabled="!canReplay || replaying"
    :primary-button-loading="replaying"
    :secondary-button-label="t('common.close')"
    @update:open="onOpenChange"
    @click:primary="replay"
    @click:secondary="close"
  >
    <div class="tw:flex tw:flex-col tw:gap-3 tw:p-4">
      <!-- status -->
      <div class="tw:flex tw:items-center tw:gap-2">
        <span class="wf-status" :class="`wf-status--${status}`">
          {{ t(`workflow.test.stepResult.status.${status}`) }}
        </span>
      </div>

      <!-- Input | Output, side by side — fill the drawer height (minus header,
           footer, status row + hint). A concrete height is needed so the Monaco
           editors size correctly. -->
      <div class="tw:flex tw:gap-3 tw:h-[calc(100vh-230px)]">
        <div class="tw:flex-1 tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
          <OText as="label" class="tw:text-[12px] tw:font-medium tw:mb-1">
            {{ t("workflow.test.stepResult.input") }}
          </OText>
          <div class="wf-io-box">
            <CodeQueryEditor
              v-if="inputText"
              editor-id="workflow-step-input"
              language="json"
              :read-only="true"
              :query="inputText"
              :show-auto-complete="false"
            />
            <div v-else class="wf-io-empty">
              {{ t("workflow.test.stepResult.noInput") }}
            </div>
          </div>
        </div>

        <div class="tw:flex-1 tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
          <OText as="label" class="tw:text-[12px] tw:font-medium tw:mb-1">
            {{ t("workflow.test.stepResult.output") }}
          </OText>
          <div class="wf-io-box">
            <CodeQueryEditor
              v-if="outputText"
              editor-id="workflow-step-output"
              language="json"
              :read-only="true"
              :query="outputText"
              :show-auto-complete="false"
            />
            <!-- Error node: no output, show the error messages instead. -->
            <div v-else-if="errorMessages.length" class="wf-io-errors">
              <div
                v-for="(m, i) in errorMessages"
                :key="i"
                class="wf-io-error-line"
              >
                {{ m }}
              </div>
            </div>
            <div v-else class="wf-io-empty">
              {{ t("workflow.test.stepResult.noOutput") }}
            </div>
          </div>
        </div>
      </div>

      <OText variant="meta" as="p" class="tw:text-text-secondary">
        {{ t("workflow.test.stepResult.replayHint") }}
      </OText>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OText from "@/lib/core/Typography/OText.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

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

const drawerTitle = computed(() => {
  const data = node.value?.data;
  const label =
    nodeConfigDetail(data, 60) ||
    (nodeMeta(data?.node_type) ? t(nodeMeta(data?.node_type)!.titleKey) : "");
  return `${t("workflow.test.stepResult.title")} — ${label}`;
});

const status = computed<"ok" | "error" | "skipped">(() => {
  const r = result.value;
  if (r?.errors?.[nodeId.value]) return "error";
  if (r?.blockedNodeIds?.includes(nodeId.value)) return "skipped";
  return "ok";
});

// Per-node I/O — prefer the backend's node_io; fall back to error-derived input.
const backendIo = computed<any>(() => result.value?.nodeIo?.[nodeId.value]);
const hasCapturedIo = computed(() => !!backendIo.value);

// NodeErrors serializes as { error_count, errors: [ [message, inputValue?], ... ] }.
const errorEntries = computed<any[]>(() => {
  const raw = result.value?.errors?.[nodeId.value];
  return Array.isArray(raw?.errors) ? raw.errors : [];
});
const errorMessages = computed<string[]>(() =>
  hasCapturedIo.value
    ? []
    : errorEntries.value.map((e) => (Array.isArray(e) ? String(e[0]) : String(e))),
);

// Input records: backend node_io input, else the errored input records.
const inputRecords = computed<any[]>(() => {
  if (backendIo.value?.input) return backendIo.value.input;
  return errorEntries.value
    .map((e) => (Array.isArray(e) ? e[1] : undefined))
    .filter((v) => v !== undefined && v !== null);
});
const outputRecords = computed<any[] | null>(() =>
  backendIo.value?.output ?? null,
);

const toJson = (v: any) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
};
const inputText = computed(() =>
  inputRecords.value.length ? toJson(inputRecords.value) : "",
);
const outputText = computed(() =>
  outputRecords.value && outputRecords.value.length
    ? toJson(outputRecords.value)
    : "",
);

// Replay = re-run the workflow from this node using its input.
const canReplay = computed(() => inputRecords.value.length > 0);
const replaying = ref(false);

const replay = async () => {
  if (!canReplay.value || replaying.value) return;
  replaying.value = true;
  const r = await executeTestRun({
    orgId: store.state.selectedOrganization.identifier,
    inputs: inputRecords.value,
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
.wf-status {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
}
.wf-status--ok {
  background: #dcfce7;
  color: #15803d;
}
.wf-status--error {
  background: #fee2e2;
  color: #b91c1c;
}
.wf-status--skipped {
  background: #f3f4f6;
  color: #6b7280;
}
.wf-io-box {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
}
.wf-io-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--o2-color-text-secondary, #8a94a6);
}
.wf-io-errors {
  height: 100%;
  overflow: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf-io-error-line {
  font-size: 12px;
  line-height: 1.4;
  color: #b91c1c;
  white-space: pre-wrap;
}
</style>
