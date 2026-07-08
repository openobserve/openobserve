<script setup lang="ts">
import { computed, useSlots } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
interface Props {
  variant?: "default" | "info" | "success" | "warning" | "error" | "error-soft";
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

const variantClass = computed(() => {
  switch (props.variant) {
    case "info":
      return "bg-(--color-banner-info-bg) border border-(--color-banner-info-border) text-(--color-banner-info-text)";
    case "success":
      return "bg-(--color-banner-success-bg) border border-(--color-banner-success-border) text-(--color-banner-success-text)";
    case "warning":
      return "bg-(--color-banner-warning-bg) border border-(--color-banner-warning-border) border-l-4 border-l-(--color-banner-warning-border) text-(--color-banner-warning-text)";
    case "error":
      return "bg-(--color-banner-error-bg) text-(--color-banner-error-text)";
    // Tinted error for hints/insights — solid `error` stays for hard failures.
    case "error-soft":
      return "bg-(--color-banner-error-soft-bg) border border-(--color-banner-error-soft-border) border-l-4 border-l-(--color-banner-error-soft-border) text-(--color-banner-error-soft-text)";
    default:
      return "bg-(--color-banner-default-bg) text-(--color-banner-default-text)";
  }
});
</script>

<template>
  <div
    :role="ariaRole"
    :data-test="dataTest"
    :class="[
      'flex rounded-md',
      inlineActions ? 'flex-row items-center gap-3' : 'flex-col gap-2',
      dense ? 'p-2' : 'p-4',
      variantClass,
    ]"
  >
    <div
      :class="[
        'flex flex-row items-start gap-3',
        inlineActions ? 'flex-1' : '',
      ]"
    >
      <div v-if="showIconArea" class="shrink-0 flex items-start">
        <slot name="icon">
          <OIcon :name="icon" size="sm" />
        </slot>
      </div>

      <div class="flex-1 text-sm">
        <slot />
        <template v-if="showContentProp">{{ content }}</template>
      </div>
    </div>

    <div v-if="hasActionsSlot">
      <slot name="actions" />
    </div>
  </div>
</template>
