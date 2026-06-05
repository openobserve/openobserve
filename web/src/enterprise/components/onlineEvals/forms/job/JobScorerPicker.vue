<template>
  <div class="job-scorer-picker">
    <div class="job-scorer-picker__head">
      <span class="job-scorer-picker__title">{{ t("onlineEvals.job.scorerPicker.title") }}</span>
      <span class="job-scorer-picker__hint">{{ t("onlineEvals.job.scorerPicker.hint") }}</span>
    </div>
    <OSelect
      :model-value="modelValue"
      :options="options"
      multiple
      searchable
      :placeholder="t('onlineEvals.job.scorerPicker.placeholder')"
      :search-placeholder="t('onlineEvals.job.scorerPicker.searchPlaceholder')"
      size="md"
      :disabled="!scorers.length"
      data-test="job-form-scorer-select"
      @update:model-value="onChange"
    />
    <div v-if="!scorers.length" class="job-scorer-picker__empty">
      {{ t("onlineEvals.job.scorerPicker.empty") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { Scorer } from "@/services/online-evals.service";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";

const props = defineProps<{
  scorers: Scorer[];
  modelValue: string[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();

const { t } = useI18n();

const options = computed(() =>
  props.scorers.map((scorer) => ({
    label: scorer.name,
    value: entityId(scorer),
    badge: `${scorerTypeOf(scorer).replace("_", " ")} · v${scorer.version}`,
  })),
);

function onChange(value: unknown) {
  if (Array.isArray(value)) {
    emit("update:modelValue", value.map((v) => String(v)));
  }
}
</script>

<style lang="scss" scoped>
.job-scorer-picker {
  margin-bottom: 16px;
}

.job-scorer-picker__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.job-scorer-picker__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-scorer-picker__hint {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-scorer-picker__empty {
  margin-top: 8px;
  padding: 12px 14px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  text-align: center;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}
</style>
