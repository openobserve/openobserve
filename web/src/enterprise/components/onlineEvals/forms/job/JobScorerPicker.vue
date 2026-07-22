<template>
  <div class="mb-4">
    <div class="flex flex-col gap-0.5 mb-2">
      <span class="text-xs font-semibold text-text-heading">{{
        t("onlineEvals.job.scorerPicker.title")
      }}</span>
      <span class="text-2xs text-text-secondary">{{ t("onlineEvals.job.scorerPicker.hint") }}</span>
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
      class="mt-2 py-3 px-3.5 border border-dashed border-dialog-header-border rounded-default text-center text-text-secondary text-xs"
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
    emit(
      "update:modelValue",
      value.map((v) => String(v)),
    );
  }
}
</script>
