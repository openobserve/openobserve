<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import { computed, useSlots } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
interface Props {
  variant?: "default" | "info" | "success" | "warning" | "error" | "error-soft" | "promo";
  content?: I18nText;
  icon?: string;
  dense?: boolean;
  inlineActions?: boolean;
  /**
   * Full-bleed strip instead of an inset block — square corners, no border, the
   * message on the left and its actions pinned right. For an app-wide bar spanning
   * the whole viewport, where an inset card with soft corners would read as
   * floating debris, and where centering each row independently leaves a stack of
   * banners visibly ragged.
   */
  bar?: boolean;
  /**
   * Bar mode: centre the message and its actions as one group rather than
   * pinning actions to the right edge. For a short promotional line, where a
   * left-aligned message with the action stranded across the viewport reads as
   * two unrelated things.
   */
  center?: boolean;
  /**
   * Overrides the role derived from `variant`. Only for a bar that is part of
   * the page's furniture rather than a notification.
   */
  role?: "status" | "alert" | "banner";
  dataTest?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
  dense: false,
  inlineActions: false,
  bar: false,
  center: false,
});

const slots = useSlots();

const ariaRole = computed(
  () =>
    props.role ?? (props.variant === "error" || props.variant === "warning" ? "alert" : "status"),
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
    // Marketing gold, shared with the standalone webinar bar so the two match.
    case "promo":
      return "bg-promo-webinar-accent text-promo-webinar-text";
    // Tinted error for hints/insights — solid `error` stays for hard failures.
    case "error-soft":
      return "bg-banner-error-soft-bg border border-banner-error-soft-border border-l-4 border-l-banner-error-soft-border text-banner-error-soft-text";
    default:
      return "bg-banner-default-bg text-banner-default-text";
  }
});

/**
 * Bar mode carries the fill and the text colour but none of the borders.
 * An inset card's 1px box and 4px left accent become a hairline down the
 * viewport edge and a stub in the corner once the banner spans the screen —
 * and, because only some variants carry them, a stack of bars ends up with
 * rows of different heights.
 */
const barVariantClass = computed(() => {
  switch (props.variant) {
    case "info":
      return "bg-banner-info-bg text-banner-info-text";
    case "success":
      return "bg-banner-success-bg text-banner-success-text";
    case "warning":
      return "bg-banner-warning-bg text-banner-warning-text";
    case "error":
      return "bg-banner-error-bg text-banner-error-text";
    case "error-soft":
      return "bg-banner-error-soft-bg text-banner-error-soft-text";
    case "promo":
      return "bg-promo-webinar-accent text-promo-webinar-text";
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
      'flex',
      bar ? 'w-full flex-row flex-wrap items-center gap-3 px-4' : '',
      bar ? (dense ? 'py-1' : 'py-2') : '',
      bar ? (center ? 'justify-center' : 'justify-between') : '',
      bar ? '' : 'rounded-default',
      bar ? '' : inlineActions ? 'flex-row items-center gap-3' : 'flex-col gap-2',
      bar ? '' : dense ? 'p-2' : 'p-4',
      bar ? barVariantClass : variantClass,
    ]"
  >
    <div
      :class="[
        'flex flex-row gap-3',
        bar ? (center ? 'min-w-0 items-center' : 'min-w-0 flex-1 items-center') : 'items-start',
        inlineActions && !bar ? 'flex-1' : '',
      ]"
    >
      <div v-if="showIconArea" :class="['flex shrink-0', bar ? 'items-center' : 'items-start']">
        <slot name="icon">
          <OIcon :name="icon" size="sm" />
        </slot>
      </div>

      <div :class="bar ? 'text-compact' : 'flex-1 text-sm'">
        <slot />
        <template v-if="showContentProp">{{ content }}</template>
      </div>
    </div>

    <div v-if="hasActionsSlot" :class="bar ? 'shrink-0' : ''">
      <slot name="actions" />
    </div>
  </div>
</template>
