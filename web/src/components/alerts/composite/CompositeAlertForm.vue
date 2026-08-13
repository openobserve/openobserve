<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import CompositeAlertPreview from "./CompositeAlertPreview.vue";
import CompositeChildSelector from "./CompositeChildSelector.vue";
import CompositeExpressionBuilder from "./CompositeExpressionBuilder.vue";
import alertsService from "@/services/alerts";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type {
  CompositeAlertChild,
  CompositeAlertDraft,
  CompositeAlertValidationRequest,
  CompositeAlertValidationResponse,
  StaleChildPolicy,
} from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  type CompositeChildOption,
  rawToLettered,
  removeExpressionOperand,
  validateExpression,
} from "./expression";

const props = withDefaults(
  defineProps<{
    modelValue: CompositeAlertDraft | Record<string, unknown>;
    orgIdentifier?: string;
    folderId?: string;
    availableChildren?: CompositeChildOption[];
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
const selectedChildren = computed<CompositeChildOption[]>(() => {
  const children = draft.value.children ?? [];
  return children.map((child) => child as CompositeChildOption);
});
const selectedIds = computed(() => selectedChildren.value.map((child) => child.alert_id));
const summaryExpression = computed(() => {
  const lettered = rawToLettered(
    draft.value.composite_condition.expression,
    selectedChildren.value,
  );
  return lettered || "—";
});
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

const updateCondition = (patch: Partial<CompositeAlertDraft["composite_condition"]>): void => {
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
    .filter((child): child is CompositeChildOption => child !== undefined);
  // A removed child must also leave the expression, or the dangling `{id}` makes
  // the draft unparseable until the user notices and edits it by hand.
  const removed = selectedIds.value.filter((id) => !ids.includes(id));
  let expression = draft.value.composite_condition.expression;
  for (const id of removed) {
    expression = removeExpressionOperand(expression, id);
  }
  // Removing an operand from the backend's canonical nested form can leave a
  // dangling operator (`( && B)`); in that case rebuild a flat AND join so the
  // draft stays valid instead of blocking Save. The flat-case removal above is
  // left untouched so OR/NOT structures survive.
  if (removed.length && !validateExpression(expression, children).valid) {
    expression = ids.map((id) => `{${id}}`).join(" && ");
  }
  emit("update:modelValue", {
    ...draft.value,
    composite_condition: {
      ...draft.value.composite_condition,
      expression,
    },
    children: children as CompositeAlertChild[],
  });
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
  <section
    class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,6.5fr)_minmax(0,3.5fr)]"
    data-test="alerts-composite-form"
  >
    <!-- Left column: sub-alerts, expression, settings -->
    <div class="flex min-w-0 flex-col gap-4">
      <div class="bg-card-glass-bg rounded-default border-border-default border">
        <div class="border-border-default flex items-center border-b px-3 py-2.5">
          <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
          <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
            {{ t("alerts.composite.subAlerts") }} <span class="text-text-body">*</span>
          </span>
        </div>
        <div class="px-3 py-2">
          <CompositeChildSelector
            :model-value="selectedIds"
            :options="availableChildren"
            :max="10"
            @update:model-value="updateSelectedIds"
          />
        </div>
      </div>

      <div class="bg-card-glass-bg rounded-default border-border-default border">
        <div class="border-border-default flex items-center border-b px-3 py-2.5">
          <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
          <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
            {{ t("alerts.composite.triggerExpression") }} <span class="text-text-body">*</span>
          </span>
        </div>
        <div class="flex flex-col gap-3 px-3 py-2">
          <OBanner variant="info" dense :content="t('alerts.composite.banner')" />
          <CompositeExpressionBuilder
            :model-value="draft.composite_condition.expression"
            :selected-children="selectedChildren"
            @update:model-value="updateCondition({ expression: $event })"
          />
        </div>
      </div>

      <div class="bg-card-glass-bg rounded-default border-border-default border">
        <div class="border-border-default flex items-center border-b px-3 py-2.5">
          <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
          <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
            {{ t("alerts.composite.settings") }}
          </span>
        </div>
        <div class="flex flex-col gap-3 px-3 py-2">
          <OSwitch
            :model-value="draft.composite_condition.warning_counts_as_firing"
            :label="t('alerts.composite.warningCountsAsFiring')"
            data-test="alerts-composite-warning-counts-as-firing"
            :aria-checked="draft.composite_condition.warning_counts_as_firing"
            @update:model-value="updateCondition({ warning_counts_as_firing: Boolean($event) })"
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
      </div>
    </div>

    <!-- Right column: live preview + summary -->
    <div class="flex min-w-0 flex-col gap-4">
      <div class="bg-card-glass-bg rounded-default border-border-default border">
        <div class="border-border-default flex items-center border-b px-3 py-2.5">
          <span class="text-text-heading text-sm font-medium">{{ t("alerts.preview") }}</span>
        </div>
        <div class="min-h-0 overflow-auto px-3 py-2">
          <CompositeAlertPreview
            v-if="preview"
            :preview="preview"
            :expression="draft.composite_condition.expression"
            :selected-children="selectedChildren"
          />
          <div
            v-else
            class="text-text-secondary flex items-center justify-center gap-2 py-6 text-sm"
          >
            {{ t("alerts.composite.invalidExpression") }}
          </div>
        </div>
      </div>

      <div class="bg-card-glass-bg rounded-default border-border-default border">
        <div class="border-border-default flex items-center border-b px-3 py-2.5">
          <span class="text-text-heading text-sm font-medium">{{ t("alerts.summary.title") }}</span>
        </div>
        <div class="px-3 py-2">
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-text-secondary whitespace-nowrap">{{ t("alerts.composite.name") }}</dt>
            <dd class="text-text-heading min-w-0 break-words">
              {{ raw(draft.name) || raw("—") }}
            </dd>
            <dt class="text-text-secondary whitespace-nowrap">{{ t("alerts.composite.type") }}</dt>
            <dd class="text-text-heading">{{ t("alerts.compositeAlert") }}</dd>
            <dt class="text-text-secondary whitespace-nowrap">
              {{ t("alerts.composite.expression") }}
            </dt>
            <dd class="text-text-heading min-w-0 font-mono text-xs break-all">
              {{ raw(summaryExpression) }}
            </dd>
            <dt class="text-text-secondary whitespace-nowrap">
              {{ t("alerts.composite.subAlerts") }}
            </dt>
            <dd class="text-text-heading">{{ raw(String(selectedIds.length)) }}</dd>
            <dt class="text-text-secondary whitespace-nowrap">
              {{ t("alerts.composite.warningCountsAsFiring") }}
            </dt>
            <dd class="text-text-heading">
              {{
                draft.composite_condition.warning_counts_as_firing
                  ? t("alerts.composite.yes")
                  : t("alerts.composite.no")
              }}
            </dd>
            <dt class="text-text-secondary whitespace-nowrap">
              {{ t("alerts.composite.stalePolicy") }}
            </dt>
            <dd class="text-text-heading">
              {{
                draft.composite_condition.stale_child_policy === "use_last_state"
                  ? t("alerts.composite.useLastState")
                  : raw(draft.composite_condition.stale_child_policy)
              }}
            </dd>
            <dt class="text-text-secondary whitespace-nowrap">
              {{ t("alerts.composite.levelWhenFiring") }}
            </dt>
            <dd class="text-text-heading">{{ t("alerts.composite.levelWhenFiringValue") }}</dd>
          </dl>
        </div>
      </div>
    </div>
  </section>
</template>
