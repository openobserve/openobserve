<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import CompositeExpressionPills from "./CompositeExpressionPills.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  type CompositeChildOption,
  letterFor,
  letteredToRaw,
  rawToLettered,
  validateExpression,
} from "./expression";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    selectedChildren?: CompositeChildOption[];
  }>(),
  {
    modelValue: "",
    selectedChildren: () => [],
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "validation", value: ReturnType<typeof validateExpression>): void;
}>();

const { t } = useI18nTyped();
let autoExpressionApplied = false;
const advancedOpen = ref(false);

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

// The editable expression is lettered ("A && B"); the raw `{id}` form lives
// behind the Advanced toggle. The input mirrors the stored form via a watcher so
// stray keystrokes are normalised instead of corrupting the raw expression.
const letteredInput = ref("");
watch(
  () => effectiveExpression.value,
  (expr) => {
    letteredInput.value = rawToLettered(expr, props.selectedChildren);
  },
  { immediate: true },
);

const onLetteredInput = (value: string | number): void => {
  const next = String(value ?? "");
  letteredInput.value = next;
  emit("update:modelValue", letteredToRaw(next, props.selectedChildren));
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
  <section class="flex flex-col gap-3" data-test="alerts-composite-expression-builder">
    <!-- Live render: operands as level-coloured pills, operators as muted text. -->
    <div
      class="border-border-default bg-surface-subtle rounded-default flex min-h-12 flex-wrap items-center gap-1.5 border p-3"
      data-test="alerts-composite-expression-live"
      aria-live="polite"
    >
      <CompositeExpressionPills
        v-if="effectiveExpression.trim()"
        :expression="effectiveExpression"
        :children="selectedChildren"
      />
      <span v-else class="text-text-secondary">{{ t("alerts.composite.expressionEmpty") }}</span>
    </div>

    <!-- Lettered expression — the editable, human-readable form. -->
    <OInput
      :model-value="letteredInput"
      :label="t('alerts.composite.expression')"
      :placeholder="t('alerts.composite.expressionPlaceholder')"
      data-test="alerts-composite-expression-input"
      @update:model-value="onLetteredInput"
    />

    <!-- Operator palette + operand letter chips. -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-text-secondary text-xs">{{ t("alerts.composite.insert") }}</span>
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

    <!-- Unused children — offered as one-click place chips. -->
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
      v-if="!validation.valid"
      class="text-status-error-text text-xs"
      data-test="alerts-composite-expression-error"
    >
      {{ t("alerts.composite.invalidExpression") }}
    </div>

    <!-- Advanced: the raw `{id}` form, hidden behind a toggle. -->
    <div class="border-border-default flex flex-col gap-2 border-t pt-2">
      <OButton
        variant="ghost-muted"
        size="xs"
        icon-left="code"
        data-test="alerts-composite-expression-advanced-toggle"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        {{ t("alerts.composite.advancedExpression") }}
      </OButton>
      <OTextarea
        v-if="advancedOpen"
        :model-value="modelValue"
        data-test="alerts-composite-expression-advanced"
        :help-text="t('alerts.composite.advancedExpressionHelp')"
        :rows="3"
        class="font-mono"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </section>
</template>
