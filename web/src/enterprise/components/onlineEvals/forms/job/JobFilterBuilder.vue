<template>
  <div class="job-filter">
    <div class="job-filter__head">
      <span class="job-filter__title">{{ t("onlineEvals.job.filter.title") }}</span>
      <span class="job-filter__hint">{{ t("onlineEvals.job.filter.hint") }}</span>
    </div>
    <div class="job-filter__group">
      <FilterGroup
        :group="group"
        :depth="0"
        :stream-fields="streamFields"
        :stream-fields-map="streamFieldsMap"
        :show-sql-preview="true"
        condition-input-width="tw:w-[220px]"
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

<style lang="scss" scoped>
.job-filter {
  margin-bottom: 16px;
}

.job-filter__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.job-filter__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-filter__hint {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-filter__group {
  min-width: 0;
}

.job-filter__group :deep(.el-border) {
  width: 100%;
  max-width: 100%;
  margin-top: 0 !important;
  margin-left: 0 !important;
  border-color: var(--color-dialog-header-border, var(--o2-border));
}

.job-filter__group :deep(.group-container) {
  width: 100%;
}
</style>
