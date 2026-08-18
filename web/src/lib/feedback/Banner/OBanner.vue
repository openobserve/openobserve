<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import { computed, useSlots } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
interface Props {
  variant?: "default" | "info" | "success" | "warning" | "error" | "error-soft";
  content?: I18nText;
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
  props.variant === "error" || props.variant === "warning" ? "alert" : "status",
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
      'rounded-default flex',
      inlineActions ? 'flex-row items-center gap-3' : 'flex-col gap-2',
      dense ? 'p-2' : 'p-4',
      variantClass,
    ]"
  >
    <!-- `inlineActions` is the one-line layout — the outer row already centres,
         so the icon centres against the whole content block with it. Stacked
         banners keep `items-start`, where the icon belongs beside the first
         line of a paragraph rather than halfway down it. -->
    <div
      :class="[
        'flex flex-row gap-3',
        inlineActions ? 'flex-1 items-center' : 'items-start',
      ]"
    >
      <!-- Aligned to the FIRST LINE of the content, not the top of the box:
           `items-start` anchored a 1rem icon to the top of a 1.25rem line box,
           which reads as the icon sitting a hair high beside its own label.
           `min-h-5` is that line box, so a taller slotted icon still grows the
           wrapper and keeps its old top alignment instead of overflowing. -->
      <div v-if="showIconArea" class="flex min-h-5 shrink-0 items-center">
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
