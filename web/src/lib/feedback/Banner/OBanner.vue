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
      return "tw:bg-(--color-banner-info-bg) tw:border tw:border-(--color-banner-info-border) tw:text-(--color-banner-info-text)";
    case "success":
      return "tw:bg-(--color-banner-success-bg) tw:border tw:border-(--color-banner-success-border) tw:text-(--color-banner-success-text)";
    case "warning":
      return "tw:bg-(--color-banner-warning-bg) tw:border tw:border-(--color-banner-warning-border) tw:border-l-4 tw:border-l-(--color-banner-warning-border) tw:text-(--color-banner-warning-text)";
    case "error":
      return "tw:bg-(--color-banner-error-bg) tw:text-(--color-banner-error-text)";
    // Tinted error for hints/insights — solid `error` stays for hard failures.
    case "error-soft":
      return "tw:bg-(--color-banner-error-soft-bg) tw:border tw:border-(--color-banner-error-soft-border) tw:border-l-4 tw:border-l-(--color-banner-error-soft-border) tw:text-(--color-banner-error-soft-text)";
    default:
      return "tw:bg-(--color-banner-default-bg) tw:text-(--color-banner-default-text)";
  }
});
</script>

<template>
  <div
    :role="ariaRole"
    :data-test="dataTest"
    :class="[
      'tw:flex tw:rounded-md',
      inlineActions ? 'tw:flex-row tw:items-center tw:gap-3' : 'tw:flex-col tw:gap-2',
      dense ? 'tw:p-2' : 'tw:p-4',
      variantClass,
    ]"
  >
    <div
      :class="[
        'tw:flex tw:flex-row tw:items-start tw:gap-3',
        inlineActions ? 'tw:flex-1' : '',
      ]"
    >
      <div v-if="showIconArea" class="tw:shrink-0 tw:flex tw:items-start">
        <slot name="icon">
          <OIcon :name="icon" size="sm" />
        </slot>
      </div>

      <div class="tw:flex-1 tw:text-sm">
        <slot />
        <template v-if="showContentProp">{{ content }}</template>
      </div>
    </div>

    <div v-if="hasActionsSlot">
      <slot name="actions" />
    </div>
  </div>
</template>
