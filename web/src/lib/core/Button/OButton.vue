<script setup lang="ts">
import type { ButtonProps, ButtonEmits, ButtonSlots } from "./OButton.types";
import { Primitive } from "reka-ui";
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
    "tw:bg-transparent tw:text-button-ghost-warning-text tw:border-0",
    "tw:enabled:hover:bg-button-ghost-warning-hover-bg",
    "tw:enabled:active:bg-button-ghost-warning-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-warning-focus-ring",
    "tw:disabled:opacity-60",
  ].join(" "),
  warning: [
    "tw:bg-button-warning tw:text-button-warning-foreground tw:border tw:border-button-warning-border",
    "tw:enabled:hover:bg-button-warning-hover",
    "tw:enabled:active:bg-button-warning-active",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-warning-focus-ring",
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
  // Panel collapse: ghost muted — for sidebar panel header collapse/expand.
  // Transparent bg, muted icon color, subtle hover. Blends into header without visual weight.
  "panel-collapse": [
    "tw:bg-transparent tw:text-button-ghost-muted-text tw:border-0",
    "tw:enabled:hover:text-button-ghost-muted-hover-text tw:enabled:hover:bg-button-ghost-muted-hover-bg",
    "tw:enabled:active:bg-button-ghost-muted-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-muted-focus-ring",
    "tw:disabled:opacity-50",
  ].join(" "),
  // Primary-colored tall-narrow vertical rectangle — for splitter collapse/expand buttons
  "sidebar-button": [
    "tw:bg-button-primary tw:text-button-primary-foreground",
    "tw:enabled:hover:bg-button-primary-hover",
    "tw:enabled:active:bg-button-primary-active",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-primary-hover",
    "tw:disabled:bg-button-primary-disabled tw:disabled:text-button-primary-foreground",
  ].join(" "),
  // Sidebar toggle: bg-surface border shadow — for persistent panel collapse/expand buttons
  "sidebar-toggle": [
    "tw:bg-surface-panel tw:text-button-ghost-text tw:border tw:border-border-default tw:shadow-sm",
    "tw:enabled:hover:bg-button-ghost-hover-bg tw:enabled:hover:border-button-border-hover",
    "tw:enabled:active:bg-button-ghost-active-bg",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-button-ghost-focus-ring",
    "tw:disabled:opacity-50",
  ].join(" "),
  // AI-themed gradient — purple→pink gradient background, white text
  "ai-gradient": [
    "tw:bg-[linear-gradient(135deg,#8B5CF6_0%,#EC4899_100%)] tw:text-white tw:border-0",
    "tw:enabled:hover:shadow-[0_4px_12px_rgba(139,92,246,0.4)]",
    "tw:enabled:active:opacity-90",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-[#8B5CF6]",
    "tw:disabled:opacity-40",
  ].join(" "),
  // On-dark primary — white background with primary color text, for use on dark gradient panels
  "on-dark-primary": [
    "tw:bg-white tw:text-primary-600 tw:font-bold tw:border-0 tw:shadow-md",
    "tw:enabled:hover:shadow-xl",
    "tw:enabled:active:opacity-90",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-white/50",
    "tw:disabled:opacity-50",
  ].join(" "),
  // On-dark ghost — transparent with white border/text, for use on dark gradient panels
  "on-dark-ghost": [
    "tw:bg-transparent tw:text-white tw:border-2 tw:border-white/30",
    "tw:enabled:hover:bg-white/10 tw:enabled:hover:border-white/50",
    "tw:enabled:active:opacity-90",
    "tw:focus-visible:ring-2 tw:focus-visible:ring-white/50",
    "tw:disabled:opacity-50",
  ].join(" "),
  // Destination preview buttons — brand-colored CTAs inside alert destination preview cards
  // preview-slack: Slack green (#007a5a)
  "preview-slack": [
    "tw:bg-[#007a5a] tw:text-white tw:border-0 tw:!rounded tw:!text-sm tw:!h-auto tw:!py-2 tw:!px-3",
    "tw:enabled:hover:bg-[#005a42]",
    "tw:disabled:opacity-60",
  ].join(" "),
  // preview-teams: Microsoft Teams purple (#6264a7)
  "preview-teams": [
    "tw:bg-[#6264a7] tw:text-white tw:border-0 tw:!rounded tw:!h-auto tw:!py-2 tw:!px-4",
    "tw:enabled:hover:bg-[#464775]",
    "tw:disabled:opacity-60",
  ].join(" "),
  // preview-email: Email blue (#007bff)
  "preview-email": [
    "tw:bg-[#007bff] tw:text-white tw:border-0 tw:!rounded tw:!h-auto tw:!py-3 tw:!px-6",
    "tw:enabled:hover:bg-[#0056b3]",
    "tw:disabled:opacity-60",
  ].join(" "),
  // preview-action: Generic action button for destination previews with no brand color
  "preview-action": [
    "tw:bg-transparent tw:text-button-outline-text tw:border tw:border-button-outline-border tw:!rounded tw:!h-auto tw:!py-2 tw:!px-3 tw:!text-sm",
    "tw:enabled:hover:bg-button-outline-hover-bg",
    "tw:disabled:opacity-60",
  ].join(" "),
  // webinar-dismiss: Inline text-link style for the webinar top bar banner dismiss button
  "webinar-dismiss": [
    "tw:bg-transparent tw:border-0 tw:text-[#1e3a8a] tw:underline tw:font-bold tw:text-[0.8125rem] tw:whitespace-nowrap",
    "tw:!h-auto tw:!p-0",
    "tw:enabled:hover:text-[#1e40af]",
    "tw:disabled:opacity-60",
  ].join(" "),
  // pricing-chip: Pill-shaped toggle chip for model pricing quick-setup template selection
  "pricing-chip": [
    "tw:bg-transparent tw:text-inherit tw:border tw:border-border-default",
    "tw:!rounded-[20px] tw:!text-xs tw:!font-medium tw:!h-auto tw:!py-[5px] tw:!px-[14px] tw:!gap-[6px]",
    "tw:transition-colors tw:duration-150",
    "tw:enabled:hover:border-primary-600 tw:enabled:hover:text-primary-600 tw:enabled:hover:bg-button-ghost-hover-bg",
    "tw:disabled:opacity-60",
  ].join(" "),
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  xs: "tw:h-7 tw:ps-2.5 tw:pe-2.5 tw:text-xs tw:gap-1.5 tw:rounded",
  sm: "tw:h-9 tw:ps-3 tw:pe-3 tw:text-sm tw:gap-2 tw:rounded-md",
  // 30px labeled — matches icon-toolbar height for labeled outline buttons in toolbars
  "sm-toolbar":
    "tw:h-[1.875rem] tw:ps-2 tw:pe-2 tw:text-xs tw:gap-1.5 tw:rounded-md",
  // Compact labeled size for inline field chips (axis items) — ~28px, matches Quasar dense button
  // Extra-compact chip size — 24px height for axis field chips in query builder
  chip: "tw:h-6 tw:ps-2 tw:pe-1.5 tw:text-xs tw:gap-1 tw:rounded tw:leading-none",
  // Same as chip but with fixed 12px font — for dashboard query builder axis field chips
  // (needed because Quasar sets html font-size to 14px, making text-xs = 10.5px instead of 12px)
  "chip-12": "tw:h-6 tw:ps-2 tw:pe-1.5 tw:!text-[12px] tw:gap-1 tw:rounded tw:leading-none",
  "sm-action":
    "tw:h-9 tw:ps-3 tw:pe-3 tw:min-w-[80px] tw:text-sm tw:gap-2 tw:rounded-md",
  md: "tw:h-10 tw:ps-4 tw:pe-4 tw:text-sm tw:gap-2 tw:rounded-lg",
  lg: "tw:h-12 tw:ps-6 tw:pe-6 tw:text-base tw:gap-3 tw:rounded-lg",
  icon: "tw:size-6 tw:p-0 tw:rounded-md tw:gap-x-0",
  "icon-xs": "tw:h-[30px] tw:px-2 tw:text-[18px] tw:rounded-md tw:gap-x-0",
  // 24px round circle — for small inline add/action icon buttons (e.g. + Joins, + Filters)
  "icon-xs-circle": "tw:size-6 tw:p-0 tw:rounded-full tw:gap-x-0",
  // 28px square — matches xs chip height for paired close/remove buttons
  "icon-xs-sq": "tw:h-7 tw:w-7 tw:p-0 tw:rounded-md tw:gap-x-0",
  // 24px square — matches chip size for paired close/remove buttons
  "icon-chip": "tw:h-6 tw:w-6 tw:p-0 tw:rounded tw:gap-x-0",
  "icon-sm": "tw:h-9 tw:w-9 tw:p-0 tw:rounded-md tw:gap-x-0",
  "icon-md": "tw:h-10 tw:w-10 tw:p-0 tw:rounded-lg tw:gap-x-0",
  "icon-lg": "tw:h-12 tw:w-12 tw:p-0 tw:rounded-lg tw:gap-x-0",
  "icon-circle": "tw:size-8 tw:p-0 tw:rounded-full tw:gap-x-0",
  "icon-circle-sm": "tw:size-7 tw:p-0 tw:rounded-full tw:gap-x-0",
  // 30×30px square — for toolbar icon buttons (auto-refresh, share, hamburger)
  "icon-toolbar": "tw:size-[1.875rem] tw:p-0 tw:rounded-md tw:gap-x-0",
  // 26px rounded-lg — compact modern icon button for panel header collapse/expand
  "icon-panel": "tw:size-[1.625rem] tw:p-0 tw:rounded-lg tw:gap-x-0",
  // Tall narrow vertical rectangle — 32px × 20px for splitter collapse/expand buttons
  "sidebar-button":
    "tw:h-8 tw:w-3 tw:p-0 tw:rounded-sm tw:overflow-hidden tw:gap-x-0",
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
  "tw:font-medium tw:transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow] tw:duration-150",
  "tw:outline-none",
  "tw:ring-offset-1 tw:ring-offset-surface-base",
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
    :data-o2-variant="variant"
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot name="icon-left">
      <OIcon v-if="iconLeft" :name="iconLeft" size="sm" />
    </slot>
    <slot />
    <slot name="icon-right">
      <OIcon v-if="iconRight" :name="iconRight" size="sm" />
    </slot>
  </Primitive>
</template>
