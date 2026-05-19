<script setup lang="ts">
import { computed, useSlots } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
interface Props {
  variant?: "default" | "info" | "success" | "warning" | "error";
  content?: string;
  icon?: string;
  dense?: boolean;
  inlineActions?: boolean;
  dataTest?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
  dense: false,
  inlineActions: false,
});

const slots = useSlots();

const ariaRole = computed(() =>
  props.variant === "error" || props.variant === "warning" ? "alert" : "status"
);

const hasDefaultSlot = computed(() => !!slots.default);
const hasIconSlot = computed(() => !!slots.icon);
const hasActionsSlot = computed(() => !!slots.actions);
const showContentProp = computed(() => !hasDefaultSlot.value && !!props.content);
const showIconArea = computed(() => !!props.icon || hasIconSlot.value);
</script>

<template>
  <div
    :role="ariaRole"
    :data-test="dataTest"
    :class="[
      'obanner',
      `obanner--${variant}`,
      dense && 'obanner--dense',
      inlineActions && 'obanner--inline-actions',
    ]"
  >
    <div class="obanner__body">
      <div v-if="showIconArea" class="obanner__icon">
        <slot name="icon">
          <OIcon :name="icon" size="sm" />
        </slot>
      </div>

      <div class="obanner__content">
        <slot />
        <template v-if="showContentProp">{{ content }}</template>
      </div>
    </div>

    <div v-if="hasActionsSlot" class="obanner__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.obanner {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-radius: 0.375rem;
}

.obanner__body {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.75rem;
}

.obanner--inline-actions {
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}

.obanner--inline-actions .obanner__body {
  flex: 1;
}

.obanner:not(.obanner--dense) {
  padding: 1rem;
}

.obanner--dense {
  padding: 0.5rem;
}

/* variant: default */
.obanner--default {
  background-color: var(--color-banner-default-bg);
  color: var(--color-banner-default-text);
}

/* variant: info */
.obanner--info {
  background-color: var(--color-banner-info-bg);
  border: 1px solid var(--color-banner-info-border);
  color: var(--color-banner-info-text);
}

/* variant: success */
.obanner--success {
  background-color: var(--color-banner-success-bg);
  border: 1px solid var(--color-banner-success-border);
  color: var(--color-banner-success-text);
}

/* variant: warning */
.obanner--warning {
  background-color: var(--color-banner-warning-bg);
  border: 1px solid var(--color-banner-warning-border);
  border-left-width: 4px;
  color: var(--color-banner-warning-text);
}

/* variant: error */
.obanner--error {
  background-color: var(--color-banner-error-bg);
  color: var(--color-banner-error-text);
}

.obanner__icon {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
}

.obanner__content {
  flex: 1;
  font-size: 0.875rem;
}
</style>
