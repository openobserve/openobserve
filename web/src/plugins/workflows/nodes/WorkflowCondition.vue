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
  Condition node body (drawer content only — the ODrawer chrome + Save/Cancel/
  Delete live in WorkflowNodeDrawer). Reuses the alerts FilterGroup with the V2
  condition format, exactly like pipeline's Condition.vue, but the fields are
  the fired-alert payload (ALERT_PAYLOAD_FIELDS) since a workflow has no
  upstream stream node. `allow-custom-columns` lets users type any other field.

  A Condition is a filter (single output): records that match the rule continue
  to the next step(s); the rest are dropped. This form only owns the rule —
  WorkflowNodeDrawer's Save calls submit(), which returns the payload merged into
  the node's data ({ version, conditions }) or null to block the save when
  nothing is configured.
-->
<template>
  <div data-test="workflow-condition-body" class="tw:w-full">
    <div class="workflow-filter-group-wrapper tw:max-w-full" @submit.stop.prevent>
      <FilterGroup
        v-if="conditionGroup && conditionGroup.conditions"
        :key="filterGroupKey"
        :stream-fields="fields"
        :group="conditionGroup"
        :depth="0"
        condition-input-width="tw:w-[130px]"
        :allow-custom-columns="true"
        module="pipelines"
        @add-condition="(g) => updateGroup(g)"
        @add-group="(g) => updateGroup(g)"
        @remove-group="(id) => removeGroup(id)"
      />
    </div>

    <!-- Guidelines box — matches the pipeline Condition's styling (same
         FilterGroup), with workflow-correct wording (a condition is a filter:
         matching records continue, the rest are dropped). -->
    <div
      class="tw:bg-[#f9f290] tw:text-[#2d3748] tw:w-full tw:rounded-md tw:p-3 tw:mt-4 tw:flex tw:flex-col tw:gap-2"
      data-test="workflow-condition-note"
    >
      <div class="tw:text-sm tw:font-bold">
        {{ t("workflow.node.conditionNoteTitle") }}
      </div>
      <div class="tw:flex tw:flex-col tw:gap-1 tw:text-sm">
        <div class="tw:flex tw:items-start tw:gap-2">
          <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
          <span>
            {{ t("workflow.node.conditionNoteEmpty") }}
            <span class="tw:font-mono tw:py-[1px] tw:px-[4px] tw:rounded-[3px] tw:bg-[rgba(0,0,0,0.06)] tw:text-[#b30059]">severity != ""</span>
          </span>
        </div>
        <div class="tw:flex tw:items-start tw:gap-2">
          <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
          <span>
            {{ t("workflow.node.conditionNoteNull") }}
            <span class="tw:font-mono tw:py-[1px] tw:px-[4px] tw:rounded-[3px] tw:bg-[rgba(0,0,0,0.06)] tw:text-[#b30059]">severity != null</span>
          </span>
        </div>
        <div class="tw:flex tw:items-start tw:gap-2">
          <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
          <span>{{ t("workflow.node.conditionNoteCustom") }}</span>
        </div>
        <div class="tw:flex tw:items-start tw:gap-2">
          <OIcon name="filter-alt" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-[#4f6bed]" />
          <span>{{ t("workflow.node.conditionNoteFilter") }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { getUUID } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { ALERT_PAYLOAD_FIELDS } from "@/plugins/workflows/alertFields";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  updateGroup as updateGroupUtil,
  removeConditionGroup as removeConditionGroupUtil,
  ensureIds,
} from "@/utils/alerts/alertDataTransforms";

const { t } = useI18n();

const fields = ALERT_PAYLOAD_FIELDS;
const filterGroupKey = ref(0);

// Seed an empty V2 group with one blank condition.
const emptyGroup = () => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: getUUID(),
  conditions: [
    {
      filterType: "condition",
      column: "",
      operator: "=",
      value: "",
      values: [],
      logicalOperator: "AND",
      id: getUUID(),
    },
  ],
});

// Load the saved rule (edit) into V2 form, auto-converting V0/V1 like pipeline's
// Condition does; otherwise start from an empty group.
const initGroup = () => {
  const saved = workflowObj.currentSelectedNodeData?.data?.conditions;
  if (saved) {
    try {
      const clone = JSON.parse(JSON.stringify(saved));
      const version = detectConditionsVersion(clone);
      if (version === 0) return ensureIds(convertV0ToV2(clone));
      if (version === 1) {
        const converted =
          clone.and || clone.or ? convertV1BEToV2(clone) : convertV1ToV2(clone);
        return ensureIds(converted);
      }
      return ensureIds(clone);
    } catch (e) {
      console.error("Error loading workflow condition:", e);
    }
  }
  return emptyGroup();
};

const conditionGroup = ref<any>(initGroup());

// FilterGroup edits flow through the shared alert utilities, which expect a
// context shaped like { formData: { query_condition: { conditions } } }.
const updateGroup = (updatedGroup: any) => {
  const ctx = {
    formData: { query_condition: { conditions: conditionGroup.value } },
  };
  updateGroupUtil(updatedGroup, ctx as any);
  conditionGroup.value = ctx.formData.query_condition.conditions;
};

const removeGroup = (groupId: string) => {
  const ctx = {
    formData: { query_condition: { conditions: conditionGroup.value } },
  };
  removeConditionGroupUtil(groupId, conditionGroup.value, ctx as any);
  conditionGroup.value = ctx.formData.query_condition.conditions;
};

// Called by WorkflowNodeDrawer on Save. Returns the data payload to merge into
// the node, or null to abort (nothing configured).
const submit = () => {
  const conditions = conditionGroup.value?.conditions || [];
  const hasValid = conditions.some(
    (item: any) =>
      (item.filterType === "group" && item.conditions) ||
      (item.column && item.operator),
  );
  if (!hasValid) {
    toast({ variant: "error", message: t("workflow.node.conditionEmpty") });
    return null;
  }
  return { version: 2, conditions: conditionGroup.value };
};

defineExpose({ submit });
</script>

<style>
/* Match pipeline's FilterGroup overrides so the rule box fills the drawer. */
.workflow-filter-group-wrapper > .el-border {
  width: 100% !important;
}
.workflow-filter-group-wrapper .group-container {
  white-space: normal !important;
  overflow-x: visible !important;
  max-width: 100%;
}
.workflow-filter-group-wrapper .group-border {
  max-width: calc(100% - 20px);
}
</style>
