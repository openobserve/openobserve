<script setup lang="ts">
import { computed, useSlots } from "vue";

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
    <div v-if="showIconArea" class="obanner__icon">
      <slot name="icon">
        <q-icon :name="icon" />
      </slot>
    </div>

    <div class="obanner__content">
      <slot />
      <template v-if="showContentProp">{{ content }}</template>
    </div>

    <div v-if="hasActionsSlot" class="obanner__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.obanner {
  display: flex;
  border-radius: 0.375rem;
}

.obanner:not(.obanner--inline-actions) {
  flex-direction: column;
  gap: 0.5rem;
}

.obanner--inline-actions {
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}

.obanner:not(.obanner--dense) {
  padding: 1rem;
}

.obanner--dense {
  padding: 0.5rem;
}

/* variant: default */
.obanner--default {
  background-color: var(--color-gray-100, #f3f4f6);
  color: var(--color-gray-800, #1f2937);
}
:root.dark .obanner--default {
  background-color: var(--color-gray-800, #1f2937);
  color: var(--color-gray-200, #e5e7eb);
}

/* variant: info */
.obanner--info {
  background-color: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e3a5f;
}
:root.dark .obanner--info {
  background-color: rgba(30, 58, 138, 0.2);
  border-color: #1d4ed8;
  color: #dbeafe;
}

/* variant: success */
.obanner--success {
  background-color: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #14532d;
}
:root.dark .obanner--success {
  background-color: rgba(20, 83, 45, 0.2);
  border-color: #15803d;
  color: #dcfce7;
}

/* variant: warning */
.obanner--warning {
  background-color: #fffbeb;
  border: 1px solid #fcd34d;
  border-left-width: 4px;
  color: #78350f;
}
:root.dark .obanner--warning {
  background-color: rgba(120, 53, 15, 0.2);
  border-color: #b45309;
  color: #fef3c7;
}

/* variant: error */
.obanner--error {
  background-color: #dc2626;
  color: #ffffff;
}
:root.dark .obanner--error {
  background-color: #b91c1c;
  color: #ffffff;
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
