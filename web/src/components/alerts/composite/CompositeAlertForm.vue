<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import CompositeAlertPreview from "./CompositeAlertPreview.vue";
import CompositeChildSelector from "./CompositeChildSelector.vue";
import CompositeExpressionBuilder from "./CompositeExpressionBuilder.vue";
import alertsService from "@/services/alerts";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type {
  CompositeAlertChild,
  CompositeAlertDraft,
  CompositeAlertValidationRequest,
  CompositeAlertValidationResponse,
  StaleChildPolicy,
} from "@/ts/interfaces/alert";
import { useI18nTyped } from "@/types/i18n";
import { validateExpression } from "./expression";

interface ChildOption {
  alert_id: string;
  name?: string;
  alert_type?: string;
  folder_id?: string;
  folder_name?: string;
  enabled?: boolean;
  level?: string | null;
  stale?: boolean;
  accessible: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: CompositeAlertDraft | Record<string, unknown>;
    orgIdentifier?: string;
    folderId?: string;
    availableChildren?: ChildOption[];
  }>(),
  {
    folderId: "default",
    orgIdentifier: undefined,
    availableChildren: () => [],
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: CompositeAlertDraft): void;
  (event: "validation", value: CompositeAlertValidationResponse | { valid: false }): void;
}>();

const { t } = useI18nTyped();
const preview = ref<CompositeAlertValidationResponse | null>(null);
let validationSequence = 0;

const draft = computed(() => props.modelValue as unknown as CompositeAlertDraft);
const selectedChildren = computed<ChildOption[]>(() => {
  const children = draft.value.children ?? [];
  return children.map((child) => child as ChildOption);
});
const selectedIds = computed(() => selectedChildren.value.map((child) => child.alert_id));
const stalePolicyOptions = computed(() => [
  { label: t("alerts.composite.useLastState"), value: "use_last_state" },
  { label: t("alerts.composite.treatStaleFalse"), value: "treat_as_false" },
  { label: t("alerts.composite.treatStaleTrue"), value: "treat_as_true" },
]);
const stalePolicyHelp = computed(() => {
  switch (draft.value.composite_condition.stale_child_policy) {
    case "treat_as_false":
      return t("alerts.composite.treatStaleFalseHelp");
    case "treat_as_true":
      return t("alerts.composite.treatStaleTrueHelp");
    default:
      return t("alerts.composite.useLastStateHelp");
  }
});

const updateCondition = (
  patch: Partial<CompositeAlertDraft["composite_condition"]>,
): void => {
  emit("update:modelValue", {
    ...draft.value,
    composite_condition: {
      ...draft.value.composite_condition,
      ...patch,
    },
  });
};

const updateSelectedIds = (ids: string[]): void => {
  const known = [...selectedChildren.value, ...props.availableChildren];
  const children = ids
    .map((id) => known.find((child) => child.alert_id === id))
    .filter((child): child is ChildOption => child !== undefined);
  emit("update:modelValue", {
    ...draft.value,
    children: children as CompositeAlertChild[],
  });
};

const removeChild = (id: string): void => {
  updateSelectedIds(selectedIds.value.filter((childId) => childId !== id));
};

const validateDraft = async (): Promise<void> => {
  const local = validateExpression(
    draft.value.composite_condition.expression,
    selectedChildren.value,
  );
  if (!local.valid) {
    preview.value = null;
    emit("validation", { valid: false });
    return;
  }

  const sequence = ++validationSequence;
  const request: CompositeAlertValidationRequest = {
    composite_condition: draft.value.composite_condition,
    ...(draft.value.id ? { composite_id: draft.value.id } : {}),
    folder_id: props.folderId,
  };
  try {
    const response = await alertsService.validateComposite(
      props.orgIdentifier ?? props.folderId,
      request,
    );
    if (sequence !== validationSequence) return;
    preview.value = response.data;
    emit("validation", response.data);
  } catch {
    if (sequence !== validationSequence) return;
    preview.value = {
      valid: false,
      canonical_expression: draft.value.composite_condition.expression,
      children: [],
      warnings: [],
      errors: [{ code: "validation_unavailable" }],
      result: null,
      result_level: null,
    };
    emit("validation", preview.value);
  }
};

watch(
  () => [
    draft.value.id,
    draft.value.composite_condition.expression,
    draft.value.composite_condition.warning_counts_as_firing,
    draft.value.composite_condition.stale_child_policy,
    selectedIds.value.join(","),
    props.folderId,
  ],
  validateDraft,
  { immediate: true },
);
</script>

<template>
  <section class="flex flex-col gap-5" data-test="alerts-composite-form">
    <CompositeChildSelector
      :model-value="selectedIds"
      :options="availableChildren"
      :max="10"
      @update:model-value="updateSelectedIds"
    />

    <CompositeExpressionBuilder
      :model-value="draft.composite_condition.expression"
      :selected-children="selectedChildren"
      @update:model-value="updateCondition({ expression: $event })"
      @remove-child="removeChild"
    />

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <OSwitch
        :model-value="draft.composite_condition.warning_counts_as_firing"
        :label="t('alerts.composite.warningCountsAsFiring')"
        data-test="alerts-composite-warning-counts-as-firing"
        :aria-checked="draft.composite_condition.warning_counts_as_firing"
        @update:model-value="
          updateCondition({ warning_counts_as_firing: Boolean($event) })
        "
      />
      <div class="flex flex-col gap-1">
        <OSelect
          :model-value="draft.composite_condition.stale_child_policy"
          :options="stalePolicyOptions"
          :label="t('alerts.composite.stalePolicy')"
          :searchable="false"
          data-test="alerts-composite-stale-policy"
          :data-value="draft.composite_condition.stale_child_policy"
          @update:model-value="
            updateCondition({ stale_child_policy: $event as StaleChildPolicy })
          "
        />
        <span
          class="text-text-secondary text-xs"
          data-test="alerts-composite-stale-policy-help"
        >
          {{ stalePolicyHelp }}
        </span>
      </div>
    </div>

    <CompositeAlertPreview v-if="preview" :preview="preview" />
  </section>
</template>
