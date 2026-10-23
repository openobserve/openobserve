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

<template>
  <ODrawer
    :open="open"
    size="xl"
    :title="t('workflow.http.panelTitle')"
    :sub-title="subtitle"
    data-test="workflow-http-panel"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4 p-4 text-left">
      <template v-if="kind">
        <OBanner variant="info" dense data-test="workflow-http-kind-note">
          <span>{{ kindNote }}</span>
          <OButton
            variant="ghost-primary"
            size="xs"
            class="ms-1"
            data-test="workflow-http-kind-note-payload"
            @click="showPayload = !showPayload"
          >
            {{
              showPayload
                ? t("workflow.http.kindNotePayloadHide")
                : t("workflow.http.kindNotePayload")
            }}
          </OButton>
        </OBanner>
        <OCodeBlock
          v-if="showPayload"
          :code="samplePayload"
          lang="json"
          data-test="workflow-http-kind-note-sample"
        />
      </template>
      <WorkflowHttpEndpointSection
        :workflow-id="workflowId"
        :workflow-name="workflowName"
        :is-draft-only="isDraftOnly"
        :workflow-enabled="workflowEnabled"
        :context="context"
        :before-create="beforeCreate"
        @run-test="onRunTest"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { triggerDef } from "@/plugins/workflows/triggers";
import { httpPreviewSample } from "@/plugins/workflows/httpEndpointUi";
import type { EndpointContext } from "@/plugins/workflows/useWorkflowHttpEndpoint";
import WorkflowHttpEndpointSection from "./WorkflowHttpEndpointSection.vue";

const props = defineProps<{
  open: boolean;
  workflowId: string | null;
  workflowName: string;
  /** Trigger kind; undefined while the workflow has no trigger node. */
  kind?: string;
  isDraftOnly: boolean;
  workflowEnabled: boolean;
  context: EndpointContext;
  beforeCreate?: () => Promise<boolean>;
}>();

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "run-test", seed: unknown[]): void;
}>();

const { t } = useI18nTyped();
const showPayload = ref(false);

const kindLabel = computed(() => (props.kind ? t(triggerDef(props.kind).labelKey) : raw("")));
const subtitle = computed(() =>
  props.kind
    ? t("workflow.http.panelSubtitle", { name: props.workflowName, kind: kindLabel.value })
    : raw(props.workflowName),
);
const kindNote = computed(() =>
  t("workflow.http.kindNote", {
    kind: kindLabel.value,
    field: raw('meta.trigger_source = "http"'),
  }),
);
const samplePayload = computed(() => JSON.stringify(httpPreviewSample(), null, 2));

// The editor opens Test on the canvas, so this panel must be gone first.
const onRunTest = (seed: unknown[]) => {
  emit("update:open", false);
  emit("run-test", seed);
};
</script>
