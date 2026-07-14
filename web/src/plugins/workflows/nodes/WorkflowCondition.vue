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
      <template #guidelines>
        <div
          class="bg-[#f9f290] text-[#2d3748] w-full rounded-md p-3 mt-4 flex flex-col gap-2"
          data-test="workflow-condition-note"
        >
          <div class="text-sm font-bold">
            {{ t("workflow.node.conditionNoteTitle") }}
          </div>
          <div class="flex flex-col gap-1 text-sm">
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-amber-500" />
              <span>
                {{ t("workflow.node.conditionNoteEmpty") }}
                <span class="font-mono py-[1px] px-[4px] rounded-[3px] bg-[rgba(0,0,0,0.06)] text-[#b30059]">severity != ""</span>
              </span>
            </div>
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-amber-500" />
              <span>
                {{ t("workflow.node.conditionNoteNull") }}
                <span class="font-mono py-[1px] px-[4px] rounded-[3px] bg-[rgba(0,0,0,0.06)] text-[#b30059]">severity != null</span>
              </span>
            </div>
            <div class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-amber-500" />
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
const submit = () => builder.value?.getPayload() ?? null;

defineExpose({ submit });
</script>
