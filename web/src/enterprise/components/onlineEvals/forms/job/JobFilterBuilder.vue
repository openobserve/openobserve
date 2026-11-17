<template>
  <!-- No outer margin: every parent spaces its children with `gap`, so an
       mb-* here stacked on top of that and left an oversized hole beneath the
       filter (worst in the Span Selector drawer, gap-5 + mb-4). -->
  <div>
    <div class="mb-2 flex flex-col gap-0.5">
      <span
        class="text-compact text-input-label-text leading-tight font-medium"
        data-test="job-condition-builder-title"
        >{{ t(`onlineEvals.job.${purpose}.title`) }}</span
      >
      <span
        class="text-input-help-text text-xs leading-none"
        data-test="job-condition-builder-hint"
        >{{ t(`onlineEvals.job.${purpose}.hint.${targetScope}`) }}</span
      >
    </div>
    <FilterBuilder
      profile="eval"
      :model-value="group"
      :fields="filterFields"
      :load-values="valueLoader"
      :data-test="`job-condition-builder-${purpose}`"
      @update:model-value="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { streamValuesLoader } from "@/components/filterBar/streamValues";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { V2Group } from "@/utils/alerts/alertDataTransforms";
import { toFilterFieldType, type FilterField } from "@/utils/query/filterBar";
import { DEFAULT_JOB_STREAM_FIELDS } from "../../utils/defaultStreamFields";
import { createEmptyJobFilterGroup } from "../../utils/jobFilter";
import type { EvalTargetScope } from "@/services/online-evals.service";

const props = withDefaults(
  defineProps<{
    targetScope: EvalTargetScope;
    group?: V2Group;
    namePrefix?: string;
    purpose?: "filter" | "endSignal" | "selector";
    streamFields?: Array<{ label: string; value: string; type: string }>;
    /** The traces stream the job reads; its recent values are suggested. */
    stream?: string;
  }>(),
  {
    purpose: "filter",
  },
);

const emit = defineEmits<{
  (e: "update:group", value: V2Group): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const form: any = inject(FORM_CONTEXT_KEY, null);

const valueLoader = computed(() =>
  streamValuesLoader({
    org: store?.state.selectedOrganization?.identifier,
    streamType: "traces",
    streamName: props.stream,
  }),
);

const filterFields = computed<FilterField[]>(() =>
  (props.streamFields?.length ? props.streamFields : DEFAULT_JOB_STREAM_FIELDS).map((field) => ({
    name: field.value,
    label: String(field.label ?? field.value),
    type: toFilterFieldType(field.type),
  })),
);

// Main job filters are form-owned; completion and span-selector filters are controlled by the parent.
const isFormMode = Boolean(form && props.namePrefix);
const formGroup = isFormMode
  ? form.useStore((s: any) => s.values?.[props.namePrefix as string])
  : computed(() => undefined);
const group = computed(() => (isFormMode ? formGroup.value : props.group));

function onChange(next: unknown) {
  const value = (next as V2Group | null) ?? createEmptyJobFilterGroup();
  if (isFormMode) form.setFieldValue(props.namePrefix, value);
  else emit("update:group", value);
}
</script>
