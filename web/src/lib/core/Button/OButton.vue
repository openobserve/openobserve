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
    "bg-button-primary text-button-primary-foreground",
    "enabled:hover:bg-button-primary-hover",
    "enabled:active:bg-button-primary-active",
    "focus-visible:ring-[3px] focus-visible:ring-button-primary-hover",
    "disabled:bg-button-primary-disabled disabled:text-button-primary-foreground",
  ].join(" "),
  secondary: [
    "bg-button-secondary text-button-secondary-foreground",
    "enabled:hover:bg-button-secondary-hover",
    "enabled:active:bg-button-secondary-active",
    "focus-visible:ring-[3px] focus-visible:ring-button-secondary-focus-ring",
    "disabled:bg-button-secondary-disabled disabled:text-text-disabled",
  ].join(" "),
  outline: [
    "bg-transparent text-button-outline-text border border-button-outline-border",
    "enabled:hover:bg-button-outline-hover-bg enabled:hover:border-button-outline-hover-border",
    "enabled:active:bg-button-outline-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-outline-hover-border",
    "disabled:opacity-50",
  ].join(" "),
  ghost: [
    "bg-transparent text-button-ghost-text border-0",
    "enabled:hover:bg-button-ghost-hover-bg",
    "enabled:active:bg-button-ghost-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-focus-ring",
    "disabled:text-text-disabled",
  ].join(" "),
  "ghost-primary": [
    "bg-transparent text-button-ghost-primary-text border-0",
    "enabled:hover:bg-button-ghost-primary-hover-bg",
    "enabled:active:bg-button-ghost-primary-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-primary-focus-ring",
    "disabled:text-text-disabled",
  ].join(" "),
  "ghost-muted": [
    "bg-transparent text-button-ghost-muted-text border-0",
    "enabled:hover:text-button-ghost-muted-hover-text enabled:hover:bg-button-ghost-muted-hover-bg",
    "enabled:active:bg-button-ghost-muted-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-muted-focus-ring",
    "disabled:text-text-disabled",
  ].join(" "),
  "ghost-subtle": [
    "bg-transparent text-button-ghost-subtle-text border-0 opacity-60",
    "enabled:hover:opacity-100 enabled:hover:bg-button-ghost-subtle-hover-bg",
    "enabled:active:bg-button-ghost-subtle-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-subtle-focus-ring",
    "disabled:text-text-disabled disabled:opacity-30",
  ].join(" "),
  "ghost-destructive": [
    "bg-transparent text-button-ghost-destructive-text border-0",
    "enabled:hover:bg-button-ghost-destructive-hover-bg",
    "enabled:active:bg-button-ghost-destructive-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-destructive-focus-ring",
    "disabled:opacity-60",
  ].join(" "),
  "ghost-success": [
    "bg-transparent text-button-ghost-success-text border-0",
    "enabled:hover:bg-button-ghost-success-hover-bg",
    "enabled:active:bg-button-ghost-success-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-success-focus-ring",
    "disabled:opacity-60",
  ].join(" "),
  destructive: [
    "bg-button-destructive text-button-destructive-foreground",
    "enabled:hover:bg-button-destructive-hover",
    "enabled:active:bg-button-destructive-hover",
    "focus-visible:ring-[3px] focus-visible:ring-button-destructive-hover",
    "disabled:opacity-60",
  ].join(" "),
  "ghost-warning": [
    "bg-transparent text-button-ghost-warning-text border-0",
    "enabled:hover:bg-button-ghost-warning-hover-bg",
    "enabled:active:bg-button-ghost-warning-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-warning-focus-ring",
    "disabled:opacity-60",
  ].join(" "),
  warning: [
    "bg-button-warning text-button-warning-foreground border border-button-warning-border",
    "enabled:hover:bg-button-warning-hover",
    "enabled:active:bg-button-warning-active",
    "focus-visible:ring-[3px] focus-visible:ring-button-warning-focus-ring",
    "disabled:opacity-60",
  ].join(" "),
  // Neutral ghost: inherits parent text color — used for compact inline action buttons
  // where no color accent is desired (e.g. field adder buttons +X +Y +B +F)
  "ghost-neutral": [
    "bg-transparent text-inherit border-0",
    "enabled:hover:bg-button-ghost-hover-bg",
    "enabled:active:bg-button-ghost-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-focus-ring",
    "disabled:opacity-50",
  ].join(" "),
  // Outline destructive: transparent bg + red border + red text — use for destructive actions
  // that need visible affordance without the full filled destructive background
  "outline-destructive": [
    "bg-transparent text-button-ghost-destructive-text border border-button-ghost-destructive-text",
    "enabled:hover:bg-button-ghost-destructive-hover-bg",
    "enabled:active:bg-button-ghost-destructive-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-destructive-focus-ring",
    "disabled:opacity-50",
  ].join(" "),
  // Panel collapse: ghost muted — for sidebar panel header collapse/expand.
  // Transparent bg, muted icon color, subtle hover. Blends into header without visual weight.
  "panel-collapse": [
    "bg-transparent text-button-ghost-muted-text border-0",
    "enabled:hover:text-button-ghost-muted-hover-text enabled:hover:bg-button-ghost-muted-hover-bg",
    "enabled:active:bg-button-ghost-muted-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-muted-focus-ring",
    "disabled:opacity-50",
  ].join(" "),
  // Primary-colored tall-narrow vertical rectangle — for splitter collapse/expand buttons
  "sidebar-button": [
    "bg-button-primary text-button-primary-foreground",
    "enabled:hover:bg-button-primary-hover",
    "enabled:active:bg-button-primary-active",
    "focus-visible:ring-[3px] focus-visible:ring-button-primary-hover",
    "disabled:bg-button-primary-disabled disabled:text-button-primary-foreground",
  ].join(" "),
  // Sidebar toggle: bg-surface border shadow — for persistent panel collapse/expand buttons
  "sidebar-toggle": [
    "bg-surface-panel text-button-ghost-text border border-border-default",
    "enabled:hover:bg-button-ghost-hover-bg enabled:hover:border-button-border-hover",
    "enabled:active:bg-button-ghost-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-focus-ring",
    "disabled:opacity-50",
  ].join(" "),
  // AI-themed gradient — purple→pink gradient background, white text
  "ai-gradient": [
    "bg-[image:var(--color-gradient-ai)] text-white border-0",
    "enabled:hover:shadow-[0_4px_12px_rgba(139,92,246,0.4)]",
    "enabled:active:opacity-90",
    "focus-visible:ring-[3px] focus-visible:ring-ai-accent",
    "disabled:opacity-40",
  ].join(" "),
  // On-dark primary — white background with primary color text, for use on dark gradient panels
  "on-dark-primary": [
    "bg-white text-button-on-dark-primary-text font-bold border-0 shadow-md",
    "enabled:hover:shadow-lg",
    "enabled:active:opacity-90",
    "focus-visible:ring-[3px] focus-visible:ring-white/50",
    "disabled:opacity-50",
  ].join(" "),
  // On-dark ghost — transparent with white border/text, for use on dark gradient panels
  "on-dark-ghost": [
    "bg-transparent text-white border-2 border-white/30",
    "enabled:hover:bg-white/10 enabled:hover:border-white/50",
    "enabled:active:opacity-90",
    "focus-visible:ring-[3px] focus-visible:ring-white/50",
    "disabled:opacity-50",
  ].join(" "),
  // Destination preview buttons — brand-colored CTAs inside alert destination preview cards
  // preview-slack: Slack green (#007a5a)
  "preview-slack": [
    "bg-brand-slack text-text-inverse border-0 !rounded !text-sm !h-auto !py-2 !px-3",
    "enabled:hover:bg-brand-slack-hover",
    "disabled:opacity-60",
  ].join(" "),
  // preview-teams: Microsoft Teams purple (#6264a7)
  "preview-teams": [
    "bg-brand-teams text-text-inverse border-0 !rounded !h-auto !py-2 !px-4",
    "enabled:hover:bg-brand-teams-hover",
    "disabled:opacity-60",
  ].join(" "),
  // preview-email: Email blue (#007bff)
  "preview-email": [
    "bg-brand-email text-text-inverse border-0 !rounded !h-auto !py-3 !px-6",
    "enabled:hover:bg-brand-email-hover",
    "disabled:opacity-60",
  ].join(" "),
  // preview-action: Generic action button for destination previews with no brand color
  "preview-action": [
    "bg-transparent text-button-outline-text border border-button-outline-border !rounded !h-auto !py-2 !px-3 !text-sm",
    "enabled:hover:bg-button-outline-hover-bg",
    "disabled:opacity-60",
  ].join(" "),
  // webinar-dismiss: Inline text-link style for the webinar top bar banner dismiss button
  "webinar-dismiss": [
    "bg-transparent border-0 text-promo-webinar-link underline font-bold text-compact whitespace-nowrap",
    "!h-auto !p-0",
    "enabled:hover:text-promo-webinar-link-hover",
    "disabled:opacity-60",
  ].join(" "),
  // outline-primary: Subtle primary bg + primary text + primary border — always visually highlighted.
  // Use for edition/tier badges that must stand out without being a heavy CTA.
  "outline-primary": [
    "bg-button-ghost-primary-active-bg text-button-ghost-primary-text border border-button-outline-hover-border",
    "enabled:hover:bg-button-ghost-primary-active-bg enabled:hover:border-button-outline-hover-border",
    "enabled:active:bg-button-ghost-primary-active-bg",
    "focus-visible:ring-[3px] focus-visible:ring-button-ghost-primary-focus-ring",
    "disabled:opacity-50",
  ].join(" "),
  // pricing-chip: Pill-shaped toggle chip for model pricing quick-setup template selection
  "pricing-chip": [
    "bg-transparent text-inherit border border-border-default",
    "!rounded-full !text-xs !font-medium !h-auto !py-1.25 !px-3.5 !gap-1.5",
    "transition-colors duration-150",
    "enabled:hover:border-accent enabled:hover:text-accent enabled:hover:bg-button-ghost-hover-bg",
    "disabled:opacity-60",
  ].join(" "),
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  xs: "h-7 ps-2.5 pe-2.5 text-xs gap-1.5 rounded-default",
  // 34px control height — the workhorse compact button that pairs with 34px
  // inputs in toolbars/headers. (radius 8 = rounded-default.)
  sm: "h-[2.125rem] ps-3 pe-3 text-sm gap-2 rounded-default",
  // 30px labeled — matches icon-toolbar height for labeled outline buttons in toolbars
  "sm-toolbar": "h-[1.875rem] ps-2 pe-2 text-xs gap-1.5 rounded-default",
  // Compact labeled size for inline field chips (axis items) — ~28px, matches the dense button size
  // Extra-compact chip size — 24px height for axis field chips in query builder
  chip: "h-6 ps-2 pe-1.5 text-xs gap-1 rounded-default leading-none",
  // Same as chip but with fixed 12px font — for dashboard query builder axis field chips
  // (needed because the html font-size is 14px, making text-xs = 10.5px instead of 12px)
  "chip-12": "h-6 ps-2 pe-1.5 !text-xs gap-1 rounded-default leading-none",
  "sm-action": "h-[2.125rem] ps-3 pe-3 min-w-20 text-sm gap-2 rounded-default",
  md: "h-10 ps-4 pe-4 text-sm gap-2 rounded-default",
  lg: "h-12 ps-6 pe-6 text-base gap-3 rounded-default",
  icon: "size-6 p-0 rounded-default gap-x-0",
  "icon-xs": "h-7.5 px-2 text-lg rounded-default gap-x-0",
  // 24px round circle — for small inline add/action icon buttons (e.g. + Joins, + Filters)
  "icon-xs-circle": "size-6 p-0 rounded-full gap-x-0",
  // 28px square — matches xs chip height for paired close/remove buttons
  "icon-xs-sq": "h-7 w-7 p-0 rounded-default gap-x-0",
  // 24px square — matches chip size for paired close/remove buttons
  "icon-chip": "h-6 w-6 p-0 rounded-default gap-x-0",
  "icon-sm": "h-8 w-8 p-0 rounded-default gap-x-0",
  "icon-md": "h-10 w-10 p-0 rounded-default gap-x-0",
  "icon-lg": "h-12 w-12 p-0 rounded-default gap-x-0",
  "icon-circle": "size-8 p-0 rounded-full gap-x-0",
  "icon-circle-sm": "size-7 p-0 rounded-full gap-x-0",
  // 30×30px square — for toolbar icon buttons (auto-refresh, share, hamburger)
  "icon-toolbar": "size-[1.875rem] p-0 rounded-default gap-x-0",
  // 26px rounded-default — compact modern icon button for panel header collapse/expand
  "icon-panel": "size-[1.625rem] p-0 rounded-default gap-x-0",
  // Tall narrow vertical rectangle — 32px × 20px for splitter collapse/expand buttons
  "sidebar-button": "h-8 w-3 p-0 rounded-default overflow-hidden gap-x-0",
};

const activeClasses = [
  "bg-button-primary text-button-primary-foreground",
  "enabled:hover:bg-button-primary-hover",
  "enabled:active:bg-button-primary-active",
].join(" ");

const classes = computed<string[]>(() => [
  // Base - layout, typography, interaction
  props.block
    ? "flex w-full items-center justify-center"
    : "inline-flex items-center justify-center",
  // box-border so a variant's 1px border is drawn INSIDE the fixed size box
  // (outline/secondary/etc.) — otherwise a bordered icon button renders 2px
  // taller than a borderless ghost one of the same size.
  "relative box-border",
  "whitespace-nowrap",
  // Medium (500) keeps button labels calm/simple — heavier weights read as shouty.
  "font-medium transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow] duration-150",
  "outline-none",
  /* Unified focus glow — identical to OInput/OSelect: a 2px translucent primary
     halo hugging the control (no ring-offset gap). The trailing `!` overrides
     each variant's own ring width/color below, so every button focuses with the
     exact same soft glow regardless of variant. */
  "focus-visible:ring-[0.125rem]! focus-visible:ring-accent/25!",
  "disabled:cursor-not-allowed enabled:cursor-pointer",
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
    <!-- Loading spinner overlay — centered, absolute, shown only when loading -->
    <span
      v-if="loading"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <OIcon name="progress-activity" size="sm" class="animate-spin" />
    </span>

    <!-- Original content — invisible (not hidden) when loading to preserve button dimensions -->
    <span
      :class="loading ? 'invisible inline-flex items-center' : 'contents'"
      :style="loading ? { gap: 'inherit' } : undefined"
    >
      <slot name="icon-left">
        <OIcon v-if="iconLeft" :name="iconLeft" size="sm" />
      </slot>
      <slot />
      <slot name="icon-right">
        <OIcon v-if="iconRight" :name="iconRight" size="sm" />
      </slot>
    </span>
  </Primitive>
</template>
