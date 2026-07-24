<template>
  <div class="mb-4">
    <OSelect
      :model-value="modelValue"
      :label="t('onlineEvals.job.scorerPicker.title')"
      :options="options"
      multiple
      searchable
      :placeholder="t('onlineEvals.job.scorerPicker.placeholder')"
      :search-placeholder="t('onlineEvals.job.scorerPicker.searchPlaceholder')"
      :help-text="t(`onlineEvals.job.scorerPicker.hint.${targetScope}`)"
      size="md"
      :disabled="!scorers.length"
      data-test="job-form-scorer-select"
      @update:model-value="onChange"
    />
    <div
      v-if="!scorers.length"
      class="border-dialog-header-border rounded-default text-text-secondary mt-2 border border-dashed px-3.5 py-3 text-center text-xs"
    >
      {{ t("onlineEvals.job.scorerPicker.empty") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { EvalTargetScope, Scorer } from "@/services/online-evals.service";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";

const props = defineProps<{
  targetScope: EvalTargetScope;
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
    emit(
      "update:modelValue",
      value.map((v) => String(v)),
    );
  }
}
</script>
