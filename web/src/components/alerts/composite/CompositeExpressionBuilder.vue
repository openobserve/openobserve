<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import CompositeExpressionPills from "./CompositeExpressionPills.vue";
import {
  ALERT_SETTING_TIERS_KEY,
  useTierVisibility,
} from "@/composables/alerts/useAlertSettingTiers";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  type CompositeChildOption,
  letterFor,
  letteredToRaw,
  operatorsToWords,
  rawToLettered,
  validateExpression,
} from "./expression";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    selectedChildren?: CompositeChildOption[];
    /** False until the caller has input or a Save attempt, so a fresh form opens without an error. */
    showErrors?: boolean;
  }>(),
  {
    modelValue: "",
    selectedChildren: () => [],
    showErrors: true,
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "validation", value: ReturnType<typeof validateExpression>): void;
}>();

// The form scroller can leave a focused field below its edge, so bring it back.
const revealFocused = async (event: FocusEvent) => {
  await nextTick();
  (event.target as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
};

const { t } = useI18nTyped();
let autoExpressionApplied = false;
const tierShows = useTierVisibility();
const tiers = inject(ALERT_SETTING_TIERS_KEY, null);

const effectiveExpression = computed(() =>
  props.modelValue.trim() || props.selectedChildren.length !== 2
    ? props.modelValue
    : props.selectedChildren.map((child) => `{${child.alert_id}}`).join(" && "),
);
const validation = computed(() =>
  validateExpression(effectiveExpression.value, props.selectedChildren),
);
const unusedChildren = computed(() =>
  props.selectedChildren.filter((child) =>
    validation.value.unused_child_ids.includes(child.alert_id),
  ),
);

// The editable expression is lettered in words ("A AND B"); the raw `{id}` form lives
// behind the Advanced toggle. Re-sync only when the stored form moved under the text being typed.
const letteredInput = ref("");
watch(
  () => effectiveExpression.value,
  (expr) => {
    if (letteredToRaw(letteredInput.value, props.selectedChildren) === expr) return;
    letteredInput.value = rawToLettered(expr, props.selectedChildren);
  },
  { immediate: true },
);

const onLetteredInput = (value: string | number): void => {
  const next = String(value ?? "");
  letteredInput.value = next;
  emit("update:modelValue", letteredToRaw(next, props.selectedChildren));
};

// Display only: the stored form keeps the symbols the user typed.
const showOperatorsAsWords = (): void => {
  letteredInput.value = operatorsToWords(letteredInput.value);
};

const appendToken = (token: string): void => {
  const separator = letteredInput.value.trim() ? " " : "";
  onLetteredInput(`${letteredInput.value}${separator}${token}`);
};

const placeChild = (id: string): void => {
  const index = props.selectedChildren.findIndex((child) => child.alert_id === id);
  if (index >= 0) appendToken(letterFor(index));
};

const maybeApplyDefault = (): void => {
  if (autoExpressionApplied || props.modelValue.trim() || props.selectedChildren.length !== 2) {
    return;
  }
  autoExpressionApplied = true;
  emit(
    "update:modelValue",
    props.selectedChildren.map((child) => `{${child.alert_id}}`).join(" && "),
  );
};

watch(validation, (value) => emit("validation", value), { immediate: true });
watch(() => props.selectedChildren, maybeApplyDefault, { deep: true });
onMounted(maybeApplyDefault);
</script>

<template>
  <section class="flex flex-col gap-2" data-test="alerts-composite-expression-builder">
    <OInput
      :model-value="letteredInput"
      :aria-label="t('alerts.composite.expression')"
      :placeholder="t('alerts.composite.expressionExample', { example: raw('A AND (B OR C)') })"
      data-test="alerts-composite-expression-input"
      @update:model-value="onLetteredInput"
      @blur="showOperatorsAsWords"
    />

    <div
      v-if="effectiveExpression.trim()"
      class="flex flex-wrap items-center gap-1.5"
      data-test="alerts-composite-expression-live"
      aria-live="polite"
    >
      <CompositeExpressionPills :expression="effectiveExpression" :children="selectedChildren" />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-text-secondary text-xs">{{ t("alerts.form.composite.insert") }}</span>
      <OButton
        v-for="(child, index) in selectedChildren"
        :key="child.alert_id"
        variant="outline"
        size="xs"
        :data-test="`alerts-composite-expression-insert-${child.alert_id}`"
        :aria-label="t('alerts.composite.placeOperand', { name: child.name ?? child.alert_id })"
        @click="appendToken(letterFor(index))"
      >
        {{ raw(letterFor(index)) }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-and"
        :aria-label="t('alerts.composite.addAnd')"
        @click="appendToken('AND')"
      >
        {{ t("alerts.composite.and") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-or"
        :aria-label="t('alerts.composite.addOr')"
        @click="appendToken('OR')"
      >
        {{ t("alerts.composite.or") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-not"
        :aria-label="t('alerts.composite.addNot')"
        @click="appendToken('NOT')"
      >
        {{ t("alerts.composite.not") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-open-group"
        :aria-label="t('alerts.composite.openGroup')"
        @click="appendToken('(')"
      >
        {{ raw("(") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-close-group"
        :aria-label="t('alerts.composite.closeGroup')"
        @click="appendToken(')')"
      >
        {{ raw(")") }}
      </OButton>
    </div>

    <div
      v-if="unusedChildren.length"
      class="flex flex-wrap items-center gap-2"
      data-test="alerts-composite-expression-unused"
    >
      <span class="text-text-secondary text-xs">{{ t("alerts.composite.unusedChildren") }}</span>
      <OButton
        v-for="child in unusedChildren"
        :key="child.alert_id"
        variant="ghost-primary"
        size="xs"
        :data-test="`alerts-composite-operand-tray-${child.alert_id}`"
        :aria-label="t('alerts.composite.placeOperand', { name: child.name ?? child.alert_id })"
        @click="placeChild(child.alert_id)"
      >
        {{ raw(child.name ?? child.alert_id) }}
      </OButton>
    </div>

    <div
      v-if="showErrors && !validation.valid"
      class="text-status-error-text text-xs"
      data-test="alerts-composite-expression-error"
    >
      {{ t("alerts.composite.invalidExpression") }}
    </div>

    <OButton
      v-if="!tierShows('compositeExpression')"
      variant="ghost-primary"
      size="sm"
      icon-left="add"
      class="-ms-3.5 self-start max-[85.5rem]:-ms-3"
      data-test="add-alert-add-compositeExpression"
      @click="tiers?.reveal('compositeExpression')"
    >
      {{ t("alerts.tiers.add.compositeExpression") }}
    </OButton>
    <div v-else class="flex flex-col gap-2">
      <OTextarea
        :model-value="modelValue"
        :aria-label="t('alerts.composite.advancedExpression')"
        data-test="alerts-composite-expression-advanced"
        :rows="3"
        class="font-mono"
        @focusin="revealFocused"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </section>
</template>
