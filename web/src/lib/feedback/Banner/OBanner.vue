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
      return "bg-banner-info-bg border border-banner-info-border text-banner-info-text";
    case "success":
      return "bg-banner-success-bg border border-banner-success-border text-banner-success-text";
    case "warning":
      return "bg-banner-warning-bg border border-banner-warning-border border-l-4 border-l-banner-warning-border text-banner-warning-text";
    case "error":
      return "bg-banner-error-bg text-banner-error-text";
    // Tinted error for hints/insights — solid `error` stays for hard failures.
    case "error-soft":
      return "bg-banner-error-soft-bg border border-banner-error-soft-border border-l-4 border-l-banner-error-soft-border text-banner-error-soft-text";
    default:
      return "bg-banner-default-bg text-banner-default-text";
  }
});
</script>

<template>
  <div
    :role="ariaRole"
    :data-test="dataTest"
    :class="[
      'flex rounded-default',
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
