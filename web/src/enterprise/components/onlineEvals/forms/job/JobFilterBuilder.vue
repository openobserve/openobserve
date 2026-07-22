<template>
  <div class="mb-4">
    <div class="flex flex-col gap-0.5 mb-2">
      <span class="text-xs font-semibold text-text-heading">{{
        t("onlineEvals.job.filter.title")
      }}</span>
      <span class="text-2xs text-text-secondary">{{ t("onlineEvals.job.filter.hint") }}</span>
    </div>
    <div class="job-filter__group min-w-0">
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
} from "@/utils/alerts/alertDataTransforms";
import { cloneDeep } from "lodash-es";
import { DEFAULT_JOB_STREAM_FIELDS } from "../../utils/defaultStreamFields";

// FORM MODE (Rule ③): FilterGroup renders name-bound to the parent OForm's
// `${namePrefix}` tree. Leaf column/operator/value write straight into the form;
// structural changes (add/remove/toggle) are written here via setFieldValue on a
// CLONE of the form's current tree (the transform utils mutate in place and the
// form store is readonly) — mirrors alerts' useAlertForm / pipeline Condition.
const props = defineProps<{
  namePrefix: string;
}>();

const { t } = useI18n();
const form: any = inject(FORM_CONTEXT_KEY, null);

const streamFields = computed(() => DEFAULT_JOB_STREAM_FIELDS);
const streamFieldsMap = computed(() =>
  Object.fromEntries(streamFields.value.map((field) => [field.value, { type: field.type }])),
);

// Reactive READ-VIEW of the form-owned tree — drives FilterGroup's `:group`.
const group = form
  ? form.useStore((s: any) => s.values?.[props.namePrefix])
  : computed(() => undefined);

const clonedTree = () => cloneDeep(form.state.values?.[props.namePrefix]);

function handleUpdate(updatedGroup: any) {
  if (!form) return;
  const conditions = clonedTree();
  const ctx = { formData: { query_condition: { conditions } } };
  updateAlertConditionGroup(updatedGroup, ctx);
  form.setFieldValue(props.namePrefix, ctx.formData.query_condition.conditions);
}

function handleRemove(groupId: string) {
  if (!form) return;
  const conditions = clonedTree();
  const ctx = { formData: { query_condition: { conditions } } };
  removeAlertConditionGroup(groupId, conditions, ctx);
  form.setFieldValue(props.namePrefix, ctx.formData.query_condition.conditions);
}

function handleInputUpdate() {
  // Leaf values are name-bound in form mode; nothing to bridge here.
}
</script>

<style scoped>
/* keep(lib-override:alerts-filter-group): .filter-group-box / .group-container are
   FilterGroup's internal DOM, reachable only through :deep(); the width/margin
   overrides fit the shared builder into this narrow column. */
.job-filter__group :deep(.filter-group-box) {
  width: 100%;
  max-width: 100%;
  margin-left: 0 !important;
  border-color: var(--color-dialog-header-border, var(--color-border-default));
}

/* Only the root group sits flush under the label. Nested groups keep their
   top margin so the upward-shifted AND/OR toggle isn't clipped by the
   parent .group-container (overflow-x-auto also clips vertically). */
.job-filter__group > :deep(.filter-group-box) {
  margin-top: 0 !important;
}

.job-filter__group :deep(.group-container) {
  width: 100%;
}
</style>
