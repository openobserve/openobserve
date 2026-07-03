<template>
  <div class="mb-4">
    <div class="flex flex-col gap-0.5 mb-2">
      <span class="text-xs font-semibold text-text-primary">{{ t("onlineEvals.job.filter.title") }}</span>
      <span class="text-[11.5px] text-text-secondary">{{ t("onlineEvals.job.filter.hint") }}</span>
    </div>
    <div class="job-filter__group min-w-0">
      <FilterGroup
        :group="group"
        :depth="0"
        :stream-fields="streamFields"
        :stream-fields-map="streamFieldsMap"
        :show-sql-preview="true"
        condition-input-width="w-[150px]"
        :allow-custom-columns="true"
        module="alerts"
        @add-condition="handleUpdate"
        @add-group="handleUpdate"
        @remove-group="handleRemove"
        @input:update="handleInputUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import {
  removeConditionGroup as removeAlertConditionGroup,
  updateGroup as updateAlertConditionGroup,
  type V2Group,
} from "@/utils/alerts/alertDataTransforms";
import { DEFAULT_JOB_STREAM_FIELDS } from "../../utils/defaultStreamFields";

const props = defineProps<{
  group: V2Group;
}>();

const emit = defineEmits<{
  (e: "update:group", value: V2Group): void;
}>();

const { t } = useI18n();

const streamFields = computed(() => DEFAULT_JOB_STREAM_FIELDS);
const streamFieldsMap = computed(() =>
  Object.fromEntries(streamFields.value.map((field) => [field.value, { type: field.type }])),
);

function handleUpdate(updatedGroup: any) {
  const formData = { query_condition: { conditions: props.group } };
  updateAlertConditionGroup(updatedGroup, { formData });
  emit("update:group", formData.query_condition.conditions);
}

function handleRemove(groupId: string) {
  const formData = { query_condition: { conditions: props.group } };
  removeAlertConditionGroup(groupId, props.group, { formData });
  emit("update:group", formData.query_condition.conditions);
}

function handleInputUpdate() {
  emit("update:group", { ...props.group });
}
</script>

<style>
.job-filter__group  .el-border {
  width: 100%;
  max-width: 100%;
  margin-left: 0 !important;
  border-color: var(--color-dialog-header-border, var(--o2-border));
}

/* Only the root group sits flush under the label. Nested groups keep their
   top margin so the upward-shifted AND/OR toggle isn't clipped by the
   parent .group-container (overflow-x-auto also clips vertically). */
.job-filter__group > .el-border {
  margin-top: 0 !important;
}

.job-filter__group .group-container {
  width: 100%;
}
</style>
