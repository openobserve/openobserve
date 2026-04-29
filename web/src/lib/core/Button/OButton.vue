<script setup lang="ts">
import type { ButtonProps, ButtonEmits, ButtonSlots } from "./OButton.types";
import { Primitive } from "reka-ui";
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ButtonProps>(), {
  as: "button",
  variant: "primary",
  size: "md",
  type: "button",
  disabled: false,
  loading: false,
  active: false,
  block: false,
});

const emit = defineEmits<ButtonEmits>();

defineSlots<ButtonSlots>();

// Variant class map - every entry is a full token-based class string
const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: [
    "tw:bg-button-primary tw:text-button-primary-foreground",
    "tw:enabled:hover:bg-button-primary-hover",
    "tw:enabled:active:bg-button-primary-active",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-primary-hover",
    "tw:disabled:bg-button-primary-disabled tw:disabled:text-button-primary-foreground",
  ].join(" "),
  secondary: [
    "tw:bg-button-secondary tw:text-button-secondary-foreground",
    "tw:enabled:hover:bg-button-secondary-hover",
    "tw:enabled:active:bg-button-secondary-active",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-secondary-focus-ring",
    "tw:disabled:bg-button-secondary-disabled tw:disabled:text-text-disabled",
  ].join(" "),
  outline: [
    "tw:bg-transparent tw:text-button-outline-text tw:border tw:border-button-outline-border",
    "tw:enabled:hover:bg-button-outline-hover-bg tw:enabled:hover:border-button-outline-hover-border",
    "tw:enabled:active:bg-button-outline-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-outline-hover-border",
    "tw:disabled:opacity-50",
  ].join(" "),
  ghost: [
    "tw:bg-transparent tw:text-button-ghost-text tw:border-0",
    "tw:enabled:hover:bg-button-ghost-hover-bg",
    "tw:enabled:active:bg-button-ghost-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-focus-ring",
    "tw:disabled:text-text-disabled",
  ].join(" "),
  "ghost-primary": [
    "tw:bg-transparent tw:text-button-ghost-primary-text tw:border-0",
    "tw:enabled:hover:bg-button-ghost-primary-hover-bg",
    "tw:enabled:active:bg-button-ghost-primary-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-primary-focus-ring",
    "tw:disabled:text-text-disabled",
  ].join(" "),
  "ghost-muted": [
    "tw:bg-transparent tw:text-button-ghost-muted-text tw:border-0",
    "tw:enabled:hover:text-button-ghost-muted-hover-text tw:enabled:hover:bg-button-ghost-muted-hover-bg",
    "tw:enabled:active:bg-button-ghost-muted-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-muted-focus-ring",
    "tw:disabled:text-text-disabled",
  ].join(" "),
  "ghost-subtle": [
    "tw:bg-transparent tw:text-button-ghost-subtle-text tw:border-0 tw:opacity-60",
    "tw:enabled:hover:opacity-100 tw:enabled:hover:bg-button-ghost-subtle-hover-bg",
    "tw:enabled:active:bg-button-ghost-subtle-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-subtle-focus-ring",
    "tw:disabled:text-text-disabled tw:disabled:opacity-30",
  ].join(" "),
  "ghost-destructive": [
    "tw:bg-transparent tw:text-button-ghost-destructive-text tw:border-0",
    "tw:enabled:hover:bg-button-ghost-destructive-hover-bg",
    "tw:enabled:active:bg-button-ghost-destructive-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-destructive-focus-ring",
    "tw:disabled:opacity-60",
  ].join(" "),
  destructive: [
    "tw:bg-button-destructive tw:text-button-destructive-foreground",
    "tw:enabled:hover:bg-button-destructive-hover",
    "tw:enabled:active:bg-button-destructive-hover",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-destructive-hover",
    "tw:disabled:opacity-60",
  ].join(" "),
  "ghost-warning": [
    "tw:bg-transparent tw:text-[var(--q-warning)] tw:border-0",
    "tw:enabled:hover:bg-[color:var(--q-warning)]/10",
    "tw:enabled:active:bg-[color:var(--q-warning)]/20",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-[color:var(--q-warning)]/50",
    "tw:disabled:opacity-60",
  ].join(" "),
  // Neutral ghost: inherits parent text color — used for compact inline action buttons
  // where no color accent is desired (e.g. field adder buttons +X +Y +B +F)
  "ghost-neutral": [
    "tw:bg-transparent tw:text-inherit tw:border-0",
    "tw:enabled:hover:bg-button-ghost-hover-bg",
    "tw:enabled:active:bg-button-ghost-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-focus-ring",
    "tw:disabled:opacity-50",
  ].join(" "),
  // Outline destructive: transparent bg + red border + red text — use for destructive actions
  // that need visible affordance without the full filled destructive background
  "outline-destructive": [
    "tw:bg-transparent tw:text-button-ghost-destructive-text tw:border tw:border-button-ghost-destructive-text",
    "tw:enabled:hover:bg-button-ghost-destructive-hover-bg",
    "tw:enabled:active:bg-button-ghost-destructive-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-destructive-focus-ring",
    "tw:disabled:opacity-50",
  ].join(" "),
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  xs: "tw:h-7 tw:ps-2.5 tw:pe-2.5 tw:text-xs tw:gap-1.5 tw:rounded",
  sm: "tw:h-9 tw:ps-3 tw:pe-3 tw:text-sm tw:gap-2 tw:rounded-md",
  // Compact labeled size for inline field chips (axis items) — ~28px, matches Quasar dense button
  "sm-action":
    "tw:h-9 tw:ps-3 tw:pe-3 tw:min-w-[80px] tw:text-sm tw:gap-2 tw:rounded-md",
  md: "tw:h-10 tw:ps-4 tw:pe-4 tw:text-sm tw:gap-2 tw:rounded-lg",
  lg: "tw:h-12 tw:ps-6 tw:pe-6 tw:text-base tw:gap-3 tw:rounded-lg",
  icon: "tw:size-6 tw:p-0 tw:rounded-md tw:gap-x-0",
  "icon-xs": "tw:h-[30px] tw:px-2 tw:text-[18px] tw:rounded-md tw:gap-x-0",
  // 24px round circle — for small inline add/action icon buttons (e.g. + Joins, + Filters)
  "icon-xs-circle": "tw:size-6 tw:p-0 tw:rounded-full tw:gap-x-0",
  "icon-sm": "tw:h-9 tw:w-9 tw:p-0 tw:rounded-md tw:gap-x-0",
  "icon-md": "tw:h-10 tw:w-10 tw:p-0 tw:rounded-lg tw:gap-x-0",
  "icon-lg": "tw:h-12 tw:w-12 tw:p-0 tw:rounded-lg tw:gap-x-0",
  "icon-circle": "tw:size-8 tw:p-0 tw:rounded-full tw:gap-x-0",
  "icon-circle-sm": "tw:size-7 tw:p-0 tw:rounded-full tw:gap-x-0",
};

const activeClasses = [
  "tw:bg-button-primary tw:text-button-primary-foreground",
  "tw:enabled:hover:bg-button-primary-hover",
  "tw:enabled:active:bg-button-primary-active",
].join(" ");

const classes = computed<string[]>(() => [
  // Base - layout, typography, interaction
  props.block
    ? "tw:flex tw:w-full tw:items-center tw:justify-center"
    : "tw:inline-flex tw:items-center tw:justify-center",
  "tw:whitespace-nowrap",
  "tw:font-medium tw:transition-colors tw:duration-150",
  "tw:outline-none",
  "tw:disabled:cursor-not-allowed tw:enabled:cursor-pointer",
  // Variant + size (active overrides variant to primary appearance)
  props.active ? activeClasses : variantClasses[props.variant],
  sizeClasses[props.size],
]);

function handleClick(event: MouseEvent): void {
  if (props.disabled || props.loading) return;
  emit("click", event);
}
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="classes"
    :type="as === 'button' ? type : undefined"
    :disabled="as === 'button' ? disabled || loading : undefined"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    data-o2-btn
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot name="icon-left" />
    <slot />
    <slot name="icon-right" />
  </Primitive>
</template>
