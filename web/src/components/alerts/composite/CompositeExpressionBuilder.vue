<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  nameResolvedExpression,
  removeExpressionOperand,
  validateExpression,
  type CompositeChildDisplay,
} from "./expression";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    selectedChildren?: CompositeChildDisplay[];
  }>(),
  {
    modelValue: "",
    selectedChildren: () => [],
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "validation", value: ReturnType<typeof validateExpression>): void;
  (event: "remove-child", id: string): void;
}>();

const { t } = useI18nTyped();
let autoExpressionApplied = false;

const effectiveExpression = computed(() =>
  props.modelValue.trim() || props.selectedChildren.length !== 2
    ? props.modelValue
    : props.selectedChildren.map((child) => `{${child.alert_id}}`).join(" && "),
);
const validation = computed(() =>
  validateExpression(effectiveExpression.value, props.selectedChildren),
);
const summary = computed(() =>
  nameResolvedExpression(effectiveExpression.value, props.selectedChildren),
);
const unusedChildren = computed(() =>
  props.selectedChildren.filter((child) =>
    validation.value.unused_child_ids.includes(child.alert_id),
  ),
);

const maybeApplyDefault = (): void => {
  if (
    autoExpressionApplied ||
    props.modelValue.trim() ||
    props.selectedChildren.length !== 2
  ) {
    return;
  }
  autoExpressionApplied = true;
  emit(
    "update:modelValue",
    props.selectedChildren.map((child) => `{${child.alert_id}}`).join(" && "),
  );
};

const appendToken = (token: string): void => {
  const separator = props.modelValue.trim() ? " " : "";
  emit("update:modelValue", `${props.modelValue}${separator}${token}`);
};

// Place an operand-tray child into the expression (submit IDs, present names).
const placeChild = (id: string): void => {
  appendToken(`{${id}}`);
};

const removeChild = (id: string): void => {
  emit("update:modelValue", removeExpressionOperand(props.modelValue, id));
  emit("remove-child", id);
};

watch(
  validation,
  (value) => emit("validation", value),
  { immediate: true },
);
watch(() => props.selectedChildren, maybeApplyDefault, { deep: true });
onMounted(maybeApplyDefault);
</script>

<template>
  <section class="flex flex-col gap-3" data-test="alerts-composite-expression-builder">
    <div class="flex flex-wrap items-center gap-2">
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-and"
        :aria-label="t('alerts.composite.addAnd')"
        @click="appendToken('&&')"
      >
        {{ t("alerts.composite.and") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-or"
        :aria-label="t('alerts.composite.addOr')"
        @click="appendToken('||')"
      >
        {{ t("alerts.composite.or") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="alerts-composite-expression-not"
        :aria-label="t('alerts.composite.addNot')"
        @click="appendToken('!')"
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

    <div class="flex flex-wrap gap-2">
      <OBadge
        v-for="child in selectedChildren"
        :key="child.alert_id"
        :variant="child.accessible ? 'primary-soft' : 'warning-soft'"
        shape="rounded"
        :data-test="`alerts-composite-expression-operand-${child.alert_id}`"
        :aria-label="
          child.accessible
            ? t('alerts.composite.operandLabel', { name: child.name ?? child.alert_id })
            : t('alerts.composite.inaccessibleOperandLabel', { id: child.alert_id })
        "
      >
        <span class="inline-flex min-w-0 items-center gap-1">
          <span class="max-w-48 truncate" :title="child.name ?? child.alert_id">
            {{ raw(child.accessible ? (child.name ?? child.alert_id) : child.alert_id) }}
          </span>
          <OButton
            variant="ghost-muted"
            size="icon-chip"
            icon-left="close"
            :aria-label="t('alerts.composite.removeOperand', { id: child.alert_id })"
            :data-test="`alerts-composite-expression-remove-${child.alert_id}`"
            @click="removeChild(child.alert_id)"
          />
        </span>
      </OBadge>
    </div>

    <OTextarea
      :model-value="modelValue"
      data-test="alerts-composite-expression-advanced"
      :label="t('alerts.composite.advancedExpression')"
      :help-text="t('alerts.composite.advancedExpressionHelp')"
      :rows="3"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <div
      class="border-border-default bg-surface-subtle rounded-default border p-3 text-sm"
      data-test="alerts-composite-expression-summary"
      aria-live="polite"
    >
      {{ raw(summary) }}
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
  </section>
</template>
