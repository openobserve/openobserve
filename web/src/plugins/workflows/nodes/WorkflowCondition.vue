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
  Condition node body — a thin wrapper over the shared ConditionBuilder (same
  FilterGroup body the pipeline condition form uses). The fields are the
  fired-alert payload (ALERT_PAYLOAD_FIELDS), since a workflow has no upstream
  stream node; the guidelines below carry the workflow filter wording.

  A Condition is a filter (single output): matching records continue, the rest
  are dropped. WorkflowNodeDrawer's Save calls submit() → { version, conditions }
  or null when nothing is configured.
-->
<template>
  <div data-test="workflow-condition-body" class="w-full">
    <ConditionBuilder
      ref="builder"
      :fields="fields"
      :initial-conditions="savedConditions"
    >
      <!-- The examples below are CODE SAMPLES held in en-US.json: only the
           illustrative column name ("severity") is meant to vary per locale —
           the operators and literals (`!=`, `""`, `null`) are expression syntax
           and must be copied verbatim, so translators should leave them alone. -->
      <template #guidelines>
        <div
          class="bg-banner-warning-bg text-banner-warning-text w-full rounded-default p-3 mt-4 flex flex-col gap-2"
          data-test="workflow-condition-note"
        >
          <div class="text-sm font-bold">
            {{ t("workflow.node.conditionNoteTitle") }}
          </div>
          <div class="flex flex-col gap-1 text-sm">
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
              <span>
                {{ t("workflow.node.conditionNoteEmpty") }}
                <span class="font-mono py-px px-1 rounded-default bg-code-bg text-code-text">{{ t("workflow.node.conditionExampleEmpty") }}</span>
              </span>
            </div>
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
              <span>
                {{ t("workflow.node.conditionNoteNull") }}
                <span class="font-mono py-px px-1 rounded-default bg-code-bg text-code-text">{{ t("workflow.node.conditionExampleNull") }}</span>
              </span>
            </div>
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
              <span>{{ t("workflow.node.conditionNoteCustom") }}</span>
            </div>
          </div>
        </div>
      </template>
    </ConditionBuilder>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { ALERT_PAYLOAD_FIELDS } from "@/plugins/workflows/alertFields";

const { t } = useI18n();
const fields = ALERT_PAYLOAD_FIELDS;
const savedConditions =
  workflowObj.currentSelectedNodeData?.data?.conditions ?? null;

const builder = ref<any>(null);
// The builder validates through its zod schema (async) and renders the error
// inline, returning null when the rule is empty/incomplete.
const submit = async () => (await builder.value?.submit()) ?? null;

defineExpose({ submit });
</script>
