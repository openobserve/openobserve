<template>
  <!-- No outer margin: every parent spaces its children with `gap`, so an
       mb-* here stacked on top of that and left an oversized hole beneath the
       filter (worst in the Span Selector drawer, gap-5 + mb-4). -->
  <div>
    <div class="flex flex-col gap-0.5 mb-2">
      <span
        class="text-compact leading-tight font-medium text-input-label-text"
        data-test="job-condition-builder-title"
        >{{ t(`onlineEvals.job.${purpose}.title`) }}</span
      >
      <span
        class="text-xs text-input-help-text leading-none"
        data-test="job-condition-builder-hint"
        >{{ t(`onlineEvals.job.${purpose}.hint.${targetScope}`) }}</span
      >
    </div>
    <div
      class="min-w-0 [&_.el-border]:ml-0! [&_.el-border]:w-full [&_.el-border]:max-w-full [&_.el-border]:border-border-default [&_.group-container]:w-full [&>.el-border]:mt-0!"
    >
      <FilterGroup
        :group="group"
        :name-prefix="namePrefix"
        :depth="0"
        :stream-fields="streamFields"
        :stream-fields-map="streamFieldsMap"
        :show-sql-preview="true"
        condition-input-width="w-37.5"
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
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  removeConditionGroup as removeAlertConditionGroup,
  updateGroup as updateAlertConditionGroup,
  type V2Group,
} from "@/utils/alerts/alertDataTransforms";
import { cloneDeep } from "lodash-es";
import { DEFAULT_JOB_STREAM_FIELDS } from "../../utils/defaultStreamFields";
import type { EvalTargetScope } from "@/services/online-evals.service";

const props = withDefaults(
  defineProps<{
    targetScope: EvalTargetScope;
    group?: V2Group;
    namePrefix?: string;
    purpose?: "filter" | "endSignal" | "selector";
    streamFields?: Array<{ label: string; value: string; type: string }>;
  }>(),
  {
    purpose: "filter",
  },
);

const emit = defineEmits<{
  (e: "update:group", value: V2Group): void;
}>();

const { t } = useI18n();
const form: any = inject(FORM_CONTEXT_KEY, null);

const streamFields = computed(() =>
  props.streamFields?.length ? props.streamFields : DEFAULT_JOB_STREAM_FIELDS,
);
const streamFieldsMap = computed(() =>
  Object.fromEntries(streamFields.value.map((field) => [field.value, { type: field.type }])),
);

// Main job filters are form-owned. Completion and span-selector filters remain
// controlled composites, so this adapter supports both modes.
const formGroup =
  form && props.namePrefix
    ? form.useStore((s: any) => s.values?.[props.namePrefix as string])
    : computed(() => undefined);
const group = computed(() => (props.namePrefix ? formGroup.value : props.group));

const clonedFormTree = () => cloneDeep(form.state.values?.[props.namePrefix as string]);

function handleUpdate(updatedGroup: any) {
  const isFormMode = Boolean(form && props.namePrefix);
  const conditions = isFormMode ? clonedFormTree() : cloneDeep(props.group);
  if (!conditions) return;
  const ctx = { formData: { query_condition: { conditions } } };
  updateAlertConditionGroup(updatedGroup, ctx);
  if (isFormMode) {
    form.setFieldValue(props.namePrefix, ctx.formData.query_condition.conditions);
  } else {
    emit("update:group", ctx.formData.query_condition.conditions);
  }
}

function handleRemove(groupId: string) {
  const isFormMode = Boolean(form && props.namePrefix);
  const conditions = isFormMode ? clonedFormTree() : cloneDeep(props.group);
  if (!conditions) return;
  const ctx = { formData: { query_condition: { conditions } } };
  removeAlertConditionGroup(groupId, conditions, ctx);
  if (isFormMode) {
    form.setFieldValue(props.namePrefix, ctx.formData.query_condition.conditions);
  } else {
    emit("update:group", ctx.formData.query_condition.conditions);
  }
}

function handleInputUpdate() {
  // Leaf values are name-bound in form mode. Controlled composites still need
  // to notify their parent after FilterGroup mutates a leaf.
  if (!props.namePrefix && props.group) {
    emit("update:group", { ...props.group });
  }
}
</script>
