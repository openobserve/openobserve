<template>
  <div class="tw:mb-4">
    <div class="tw:flex tw:flex-col tw:gap-0.5 tw:mb-2">
      <span class="tw:text-xs tw:font-semibold tw:text-text-primary">{{ t("onlineEvals.job.scorerPicker.title") }}</span>
      <span class="tw:text-[11.5px] tw:text-text-secondary">{{ t("onlineEvals.job.scorerPicker.hint") }}</span>
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
    <div
      v-if="!scorers.length"
      class="tw:mt-2 tw:py-3 tw:px-3.5 tw:border tw:border-dashed tw:border-dialog-header-border tw:rounded-[6px] tw:text-center tw:text-text-secondary tw:text-xs"
    >
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
