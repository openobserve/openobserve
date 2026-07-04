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
 *  (q-badge-compatible behavior). */
const hasTrailing = computed(() => {
  if (slots.trailing) return true;
  if (props.count === undefined) return false;
  if (props.hideZeroCount && props.count === 0) return false;
  return true;
});

/** Render as <button> when interactive so keyboard + disabled work natively. */
const tag = computed(() => (props.clickable ? "button" : "span"));

// ── Variant class map ─────────────────────────────────────────────────────
// Each entry is a complete token-based class string. No tw:inline colours.
const variantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  // Solid
  default:
    "tw:bg-badge-default-soft-bg tw:text-badge-default-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-default-ol-border/30",
  primary:
    "tw:bg-badge-primary-soft-bg tw:text-badge-primary-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-primary-ol-border/30",
  success:
    "tw:bg-badge-success-soft-bg tw:text-badge-success-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-success-ol-border/30",
  warning:
    "tw:bg-badge-warning-soft-bg tw:text-badge-warning-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-warning-ol-border/30",
  error:
    "tw:bg-badge-error-soft-bg tw:text-badge-error-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-error-ol-border/30",
  // Outline (transparent bg + inset ring)
  "default-outline": [
    "tw:bg-transparent",
    "tw:text-badge-default-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-default-ol-border",
  ].join(" "),
  "primary-outline": [
    "tw:bg-transparent",
    "tw:text-badge-primary-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-primary-ol-border",
  ].join(" "),
  "success-outline": [
    "tw:bg-transparent",
    "tw:text-badge-success-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-success-ol-border",
  ].join(" "),
  "warning-outline": [
    "tw:bg-transparent",
    "tw:text-badge-warning-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-warning-ol-border",
  ].join(" "),
  "error-outline": [
    "tw:bg-transparent",
    "tw:text-badge-error-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-error-ol-border",
  ].join(" "),
  "info-outline": [
    "tw:bg-transparent",
    "tw:text-badge-info-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-info-ol-border",
  ].join(" "),
  "purple-outline": [
    "tw:bg-transparent",
    "tw:text-badge-purple-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-purple-ol-border",
  ].join(" "),
  // Soft (light tinted bg, dark text, subtle matching inset border)
  "default-soft":
    "tw:bg-badge-default-soft-bg tw:text-badge-default-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-default-ol-border/30",
  "primary-soft":
    "tw:bg-badge-primary-soft-bg tw:text-badge-primary-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-primary-ol-border/30",
  "success-soft":
    "tw:bg-badge-success-soft-bg tw:text-badge-success-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-success-ol-border/30",
  "warning-soft":
    "tw:bg-badge-warning-soft-bg tw:text-badge-warning-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-warning-ol-border/30",
  "error-soft":
    "tw:bg-badge-error-soft-bg tw:text-badge-error-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-error-ol-border/30",

  // NEW: Extended color families for correlation dimensions
  // Teal
  teal:
    "tw:bg-badge-teal-soft-bg tw:text-badge-teal-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-teal-ol-border/30",
  "teal-outline": [
    "tw:bg-transparent",
    "tw:text-badge-teal-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-teal-ol-border",
  ].join(" "),
  "teal-soft":
    "tw:bg-badge-teal-soft-bg tw:text-badge-teal-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-teal-ol-border/30",

  // Orange
  orange:
    "tw:bg-badge-orange-soft-bg tw:text-badge-orange-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-orange-ol-border/30",
  "orange-outline": [
    "tw:bg-transparent",
    "tw:text-badge-orange-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-orange-ol-border",
  ].join(" "),
  "orange-soft":
    "tw:bg-badge-orange-soft-bg tw:text-badge-orange-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-orange-ol-border/30",

  // Lime
  lime:
    "tw:bg-badge-lime-soft-bg tw:text-badge-lime-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-lime-ol-border/30",
  "lime-outline": [
    "tw:bg-transparent",
    "tw:text-badge-lime-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-lime-ol-border",
  ].join(" "),
  "lime-soft":
    "tw:bg-badge-lime-soft-bg tw:text-badge-lime-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-lime-ol-border/30",

  // Amber
  amber:
    "tw:bg-badge-amber-soft-bg tw:text-badge-amber-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-amber-ol-border/30",
  "amber-outline": [
    "tw:bg-transparent",
    "tw:text-badge-amber-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-amber-ol-border",
  ].join(" "),
  "amber-soft":
    "tw:bg-badge-amber-soft-bg tw:text-badge-amber-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-amber-ol-border/30",

  // Cyan
  cyan:
    "tw:bg-badge-cyan-soft-bg tw:text-badge-cyan-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-cyan-ol-border/30",
  "cyan-outline": [
    "tw:bg-transparent",
    "tw:text-badge-cyan-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-cyan-ol-border",
  ].join(" "),
  "cyan-soft":
    "tw:bg-badge-cyan-soft-bg tw:text-badge-cyan-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-cyan-ol-border/30",

  // Blue
  blue:
    "tw:bg-badge-blue-soft-bg tw:text-badge-blue-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-blue-ol-border/30",
  "blue-outline": [
    "tw:bg-transparent",
    "tw:text-badge-blue-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-blue-ol-border",
  ].join(" "),
  "blue-soft":
    "tw:bg-badge-blue-soft-bg tw:text-badge-blue-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-blue-ol-border/30",

  // Purple (solid/soft variants for correlation)
  purple:
    "tw:bg-badge-purple-soft-bg tw:text-badge-purple-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-purple-ol-border/30",
  "purple-soft":
    "tw:bg-badge-purple-soft-bg tw:text-badge-purple-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-purple-ol-border/30",

  // Indigo
  indigo:
    "tw:bg-badge-indigo-soft-bg tw:text-badge-indigo-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-indigo-ol-border/30",
  "indigo-outline": [
    "tw:bg-transparent",
    "tw:text-badge-indigo-ol-text",
    "tw:ring-1 tw:ring-inset tw:ring-badge-indigo-ol-border",
  ].join(" "),
  "indigo-soft":
    "tw:bg-badge-indigo-soft-bg tw:text-badge-indigo-soft-text tw:ring-1 tw:ring-inset tw:ring-badge-indigo-ol-border/30",
};

// ── Size class map ────────────────────────────────────────────────────────
const sizeClasses: Record<NonNullable<BadgeProps["size"]>, string> = {
  xs: "tw:px-1.5 tw:py-0.5 tw:text-[10px] tw:gap-0.5",
  sm: "tw:px-2.5 tw:py-1.5 tw:text-[11px] tw:gap-1",
  md: "tw:px-2.5 tw:py-2 tw:text-xs tw:gap-1.5",
};

// ── Shape (corner radius) class map ───────────────────────────────────────
const shapeClasses: Record<NonNullable<BadgeProps["shape"]>, string> = {
  pill: "tw:rounded-full",
  rounded: "tw:rounded-md",
  square: "tw:rounded-none",
};

// ── Trailing segment padding per size ────────────────────────────────────
const trailingSizeClasses = computed(() =>
  props.size === "md" ? "tw:ps-1.5 tw:ms-1" : "tw:ps-1 tw:ms-0.5",
);

// ── Root element classes ──────────────────────────────────────────────────
const classes = computed(() => [
  // Base — layout + typography + shape.
  // Weight 600 per the design-system weight scale (HANDOFF §2.2: badges = 600).
  // Pill shape (rounded-full) per HANDOFF §11 + this component's own contract.
  "tw:inline-flex tw:items-center tw:whitespace-nowrap",
  "tw:font-medium tw:leading-none",
  "tw:transition-colors tw:duration-150",
  // Variant + size + shape
  variantClasses[props.variant],
  sizeClasses[props.size],
  shapeClasses[props.shape],
  // Clickable — interaction states (button element handles :disabled natively)
  props.clickable && [
    "tw:cursor-pointer",
    "tw:enabled:hover:opacity-80",
    "tw:focus-visible:outline-none",
    "tw:focus-visible:ring-2",
    "tw:focus-visible:ring-badge-focus-ring",
    "tw:focus-visible:ring-offset-1",
  ].join(" "),
  // Disabled — always mutes regardless of clickable
  props.disabled && "tw:opacity-40 tw:pointer-events-none",
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
        'tw:inline-block tw:shrink-0 tw:rounded-full tw:size-1.75 tw:bg-current',
        size === 'sm' ? 'tw:me-0' : 'tw:me-0',
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
        <OIcon
          v-if="icon && isOIcon"
          :name="(icon as any)"
          size="xs"
          class="tw:shrink-0"
        />
        <!-- Fallback: Material icon font glyph (legacy underscore names) -->
        <span
          v-else
          class="material-icons-outlined tw:text-[1em] tw:leading-none tw:shrink-0"
          aria-hidden="true"
        >{{ icon }}</span>
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
      :class="[
        'tw:border-s tw:border-current/25 tw:opacity-75 tw:leading-none tw:shrink-0',
        trailingSizeClasses,
      ]"
    >
      <slot name="trailing">{{ count }}</slot>
    </span>
  </component>
</template>
