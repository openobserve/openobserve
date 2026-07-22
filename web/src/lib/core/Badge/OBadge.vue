<script setup lang="ts">
import type { BadgeProps, BadgeEmits, BadgeSlots } from "./OBadge.types";
import { computed, useSlots } from "vue";
import OIcon from "../Icon/OIcon.vue";
import { iconRegistry } from "../Icon/OIcon.icons";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<BadgeProps>(), {
  variant: "default",
  size: "md",
  shape: "pill",
  dot: false,
  clickable: false,
  disabled: false,
});

const emit = defineEmits<BadgeEmits>();

defineSlots<BadgeSlots>();

const slots = useSlots();

/** True when the left icon area should render (slot OR icon prop). */
const hasIcon = computed(() => !!slots.icon || !!props.icon);

/** True when the icon name is registered in the OIcon SVG registry (kebab-case) */
const isOIcon = computed<boolean>(() =>
  Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry),
);

/** True when the right trailing area should render (slot OR count prop).
 *  When hideZeroCount is set and count is 0, the trailing area is suppressed
 *  (matches the previous badge behavior). */
const hasTrailing = computed(() => {
  if (slots.trailing) return true;
  if (props.count === undefined) return false;
  if (props.hideZeroCount && props.count === 0) return false;
  return true;
});

/** Render as <button> when interactive so keyboard + disabled work natively. */
const tag = computed(() => (props.clickable ? "button" : "span"));

// ── Variant class map ─────────────────────────────────────────────────────
// Each entry is a complete token-based class string. No inline colours.
const variantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  // Solid
  default:
    "bg-badge-default-soft-bg text-badge-default-soft-text ring-1 ring-inset ring-badge-default-ol-border/30",
  primary:
    "bg-badge-primary-soft-bg text-badge-primary-soft-text ring-1 ring-inset ring-badge-primary-ol-border/30",
  success:
    "bg-badge-success-soft-bg text-badge-success-soft-text ring-1 ring-inset ring-badge-success-ol-border/30",
  warning:
    "bg-badge-warning-soft-bg text-badge-warning-soft-text ring-1 ring-inset ring-badge-warning-ol-border/30",
  error:
    "bg-badge-error-soft-bg text-badge-error-soft-text ring-1 ring-inset ring-badge-error-ol-border/30",
  // Outline (transparent bg + inset ring)
  "default-outline": [
    "bg-transparent",
    "text-badge-default-ol-text",
    "ring-1 ring-inset ring-badge-default-ol-border",
  ].join(" "),
  "primary-outline": [
    "bg-transparent",
    "text-badge-primary-ol-text",
    "ring-1 ring-inset ring-badge-primary-ol-border",
  ].join(" "),
  "success-outline": [
    "bg-transparent",
    "text-badge-success-ol-text",
    "ring-1 ring-inset ring-badge-success-ol-border",
  ].join(" "),
  "warning-outline": [
    "bg-transparent",
    "text-badge-warning-ol-text",
    "ring-1 ring-inset ring-badge-warning-ol-border",
  ].join(" "),
  "error-outline": [
    "bg-transparent",
    "text-badge-error-ol-text",
    "ring-1 ring-inset ring-badge-error-ol-border",
  ].join(" "),
  "info-outline": [
    "bg-transparent",
    "text-badge-info-ol-text",
    "ring-1 ring-inset ring-badge-info-ol-border",
  ].join(" "),
  "purple-outline": [
    "bg-transparent",
    "text-badge-purple-ol-text",
    "ring-1 ring-inset ring-badge-purple-ol-border",
  ].join(" "),
  // Soft (light tinted bg, dark text, subtle matching inset border)
  "default-soft":
    "bg-badge-default-soft-bg text-badge-default-soft-text ring-1 ring-inset ring-badge-default-ol-border/30",
  "primary-soft":
    "bg-badge-primary-soft-bg text-badge-primary-soft-text ring-1 ring-inset ring-badge-primary-ol-border/30",
  "success-soft":
    "bg-badge-success-soft-bg text-badge-success-soft-text ring-1 ring-inset ring-badge-success-ol-border/30",
  "warning-soft":
    "bg-badge-warning-soft-bg text-badge-warning-soft-text ring-1 ring-inset ring-badge-warning-ol-border/30",
  "error-soft":
    "bg-badge-error-soft-bg text-badge-error-soft-text ring-1 ring-inset ring-badge-error-ol-border/30",

  // NEW: Extended color families for correlation dimensions
  // Teal
  teal: "bg-badge-teal-soft-bg text-badge-teal-soft-text ring-1 ring-inset ring-badge-teal-ol-border/30",
  "teal-outline": [
    "bg-transparent",
    "text-badge-teal-ol-text",
    "ring-1 ring-inset ring-badge-teal-ol-border",
  ].join(" "),
  "teal-soft":
    "bg-badge-teal-soft-bg text-badge-teal-soft-text ring-1 ring-inset ring-badge-teal-ol-border/30",

  // Orange
  orange:
    "bg-badge-orange-soft-bg text-badge-orange-soft-text ring-1 ring-inset ring-badge-orange-ol-border/30",
  "orange-outline": [
    "bg-transparent",
    "text-badge-orange-ol-text",
    "ring-1 ring-inset ring-badge-orange-ol-border",
  ].join(" "),
  "orange-soft":
    "bg-badge-orange-soft-bg text-badge-orange-soft-text ring-1 ring-inset ring-badge-orange-ol-border/30",

  // Lime
  lime: "bg-badge-lime-soft-bg text-badge-lime-soft-text ring-1 ring-inset ring-badge-lime-ol-border/30",
  "lime-outline": [
    "bg-transparent",
    "text-badge-lime-ol-text",
    "ring-1 ring-inset ring-badge-lime-ol-border",
  ].join(" "),
  "lime-soft":
    "bg-badge-lime-soft-bg text-badge-lime-soft-text ring-1 ring-inset ring-badge-lime-ol-border/30",

  // Amber
  amber:
    "bg-badge-amber-soft-bg text-badge-amber-soft-text ring-1 ring-inset ring-badge-amber-ol-border/30",
  "amber-outline": [
    "bg-transparent",
    "text-badge-amber-ol-text",
    "ring-1 ring-inset ring-badge-amber-ol-border",
  ].join(" "),
  "amber-soft":
    "bg-badge-amber-soft-bg text-badge-amber-soft-text ring-1 ring-inset ring-badge-amber-ol-border/30",

  // Cyan
  cyan: "bg-badge-cyan-soft-bg text-badge-cyan-soft-text ring-1 ring-inset ring-badge-cyan-ol-border/30",
  "cyan-outline": [
    "bg-transparent",
    "text-badge-cyan-ol-text",
    "ring-1 ring-inset ring-badge-cyan-ol-border",
  ].join(" "),
  "cyan-soft":
    "bg-badge-cyan-soft-bg text-badge-cyan-soft-text ring-1 ring-inset ring-badge-cyan-ol-border/30",

  // Blue
  blue: "bg-badge-blue-soft-bg text-badge-blue-soft-text ring-1 ring-inset ring-badge-blue-ol-border/30",
  "blue-outline": [
    "bg-transparent",
    "text-badge-blue-ol-text",
    "ring-1 ring-inset ring-badge-blue-ol-border",
  ].join(" "),
  "blue-soft":
    "bg-badge-blue-soft-bg text-badge-blue-soft-text ring-1 ring-inset ring-badge-blue-ol-border/30",

  // Purple (solid/soft variants for correlation)
  purple:
    "bg-badge-purple-soft-bg text-badge-purple-soft-text ring-1 ring-inset ring-badge-purple-ol-border/30",
  "purple-soft":
    "bg-badge-purple-soft-bg text-badge-purple-soft-text ring-1 ring-inset ring-badge-purple-ol-border/30",

  // Indigo
  indigo:
    "bg-badge-indigo-soft-bg text-badge-indigo-soft-text ring-1 ring-inset ring-badge-indigo-ol-border/30",
  "indigo-outline": [
    "bg-transparent",
    "text-badge-indigo-ol-text",
    "ring-1 ring-inset ring-badge-indigo-ol-border",
  ].join(" "),
  "indigo-soft":
    "bg-badge-indigo-soft-bg text-badge-indigo-soft-text ring-1 ring-inset ring-badge-indigo-ol-border/30",
};

// ── Size class map ────────────────────────────────────────────────────────
const sizeClasses: Record<NonNullable<BadgeProps["size"]>, string> = {
  xs: "px-1.5 py-0.5 text-3xs gap-0.5",
  sm: "px-2.5 py-1.5 text-2xs gap-1",
  md: "px-2.5 py-2 text-xs gap-1.5",
};

// ── Shape (corner radius) class map ───────────────────────────────────────
const shapeClasses: Record<NonNullable<BadgeProps["shape"]>, string> = {
  pill: "rounded-full",
  rounded: "rounded-default",
  square: "rounded-none",
};

// ── Trailing segment padding per size ────────────────────────────────────
const trailingSizeClasses = computed(() => (props.size === "md" ? "ps-1.5 ms-1" : "ps-1 ms-0.5"));

// ── Root element classes ──────────────────────────────────────────────────
const classes = computed(() => [
  // Base — layout + typography + shape.
  "inline-flex items-center whitespace-nowrap",
  "font-medium leading-none",
  "transition-colors duration-150",
  // Variant + size + shape
  variantClasses[props.variant],
  sizeClasses[props.size],
  shapeClasses[props.shape],
  // Clickable — interaction states (button element handles :disabled natively)
  props.clickable &&
    [
      "cursor-pointer",
      "enabled:hover:opacity-80",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-badge-focus-ring",
      "focus-visible:ring-offset-1",
    ].join(" "),
  // Disabled — always mutes regardless of clickable
  props.disabled && "opacity-40 pointer-events-none",
]);

// ── Event handlers ────────────────────────────────────────────────────────
function handleClick(e: MouseEvent): void {
  if (!props.clickable || props.disabled) return;
  emit("click", e);
}

function handleKeydown(e: KeyboardEvent): void {
  if (!props.clickable || props.disabled) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("click", e);
  }
}
</script>

<template>
  <component
    :is="tag"
    :type="clickable ? 'button' : undefined"
    :disabled="clickable && disabled ? true : undefined"
    :aria-disabled="disabled || undefined"
    :tabindex="clickable && !disabled && tag !== 'button' ? 0 : undefined"
    :class="classes"
    v-bind="$attrs"
    @click="handleClick"
    @keydown="handleKeydown"
  >
    <!-- Leading status dot (7px solid, inherits the badge's foreground colour). -->
    <span
      v-if="dot"
      :class="[
        'inline-block shrink-0 rounded-full size-1.75 bg-current',
        size === 'sm' ? 'me-0' : 'me-0',
      ]"
      aria-hidden="true"
    />

    <!--
      Left icon area — rendered when either the #icon slot or icon prop is set.
      The slot takes priority; the prop renders a Material Icon as fallback.
    -->
    <template v-if="hasIcon">
      <slot name="icon">
        <!-- OIcon registry name (kebab-case SVG icon) -->
        <OIcon v-if="icon && isOIcon" :name="icon as any" size="xs" class="shrink-0" />
        <!-- Fallback: Material icon font glyph (legacy underscore names) -->
        <span
          v-else
          class="material-icons-outlined text-[1em] leading-none shrink-0"
          aria-hidden="true"
          >{{ icon }}</span
        >
      </slot>
    </template>

    <!-- Badge label -->
    <slot />

    <!--
      Trailing segment — rendered when either the #trailing slot or count prop is set.
      Separated from the label by a thin currentColor divider.
    -->
    <span
      v-if="hasTrailing"
      :class="['border-s border-current/25 opacity-75 leading-none shrink-0', trailingSizeClasses]"
    >
      <slot name="trailing">{{ count }}</slot>
    </span>
  </component>
</template>
