// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Btn — headless-first button replacing q-btn.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (same file, :root / .body--dark)
 * Layer 3 – Component  : CSS --o2-btn-* custom properties (this file, .o2-btn scope)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-variant="default|flat|outline|unelevated|push|glossy"
 *   data-size="xs|sm|md|lg|xl"
 *   data-shape="round|rounded|square"
 *   data-disabled     — present when disabled
 *   data-loading      — present when loading
 *   data-icon-only    — present when no label and no default slot content
 *
 * v-close-popup works automatically — Quasar traverses __vueParentComponent
 * from the root <button> element, so no special handling is needed.
 */

import { computed, useAttrs, useSlots } from "vue";
import { useRouter } from "vue-router";

defineOptions({ inheritAttrs: false });

export interface O2BtnProps {
  label?: string;
  icon?: string;
  iconRight?: string;
  type?: "button" | "submit" | "reset";
  color?: string;
  textColor?: string;
  flat?: boolean;
  outline?: boolean;
  unelevated?: boolean;
  push?: boolean;
  glossy?: boolean;
  round?: boolean;
  rounded?: boolean;
  square?: boolean;
  dense?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  padding?: string;
  loading?: boolean;
  disable?: boolean;
  noCaps?: boolean;
  noWrap?: boolean;
  stack?: boolean;
  stretch?: boolean;
  tabindex?: number | string;
  ripple?: boolean | Record<string, unknown>;
  href?: string;
  to?: string | Record<string, unknown>;
  target?: string;
}

const props = withDefaults(defineProps<O2BtnProps>(), {
  type: "button",
  size: "md",
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const attrs = useAttrs();
const slots = useSlots();
const router = useRouter();

// ─── Attr splitting ───────────────────────────────────────────────────────────

const rootBindings = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});

// ─── Variant resolution ───────────────────────────────────────────────────────

const dataVariant = computed(() => {
  if (props.flat) return "flat";
  if (props.outline) return "outline";
  if (props.push) return "push";
  if (props.glossy) return "glossy";
  if (props.unelevated) return "unelevated";
  return "default";
});

const dataShape = computed(() => {
  if (props.round) return "round";
  if (props.rounded) return "rounded";
  if (props.square) return "square";
  return undefined;
});

// ─── Color resolution ─────────────────────────────────────────────────────────

const colorMap: Record<string, string> = {
  primary: "var(--o2-primary-btn-bg)",
  secondary: "var(--o2-secondary-background)",
  negative: "var(--o2-status-error-text)",
  positive: "var(--o2-status-success-text)",
  warning: "var(--o2-status-warning-text, #b45309)",
};

const textColorMap: Record<string, string> = {
  primary: "var(--o2-primary-color)",
  negative: "var(--o2-status-error-text)",
  positive: "var(--o2-status-success-text)",
  white: "#fff",
};

const resolvedBg = computed(() => {
  if (!props.color) return undefined;
  return colorMap[props.color] ?? props.color;
});

const resolvedText = computed(() => {
  if (props.textColor) return textColorMap[props.textColor] ?? props.textColor;
  if (props.flat || props.outline) {
    if (!props.color) return undefined;
    return colorMap[props.color] ?? props.color;
  }
  if (props.color) return "var(--o2-primary-btn-text)";
  return undefined;
});

// ─── Inline style overrides ───────────────────────────────────────────────────

const inlineStyle = computed(() => {
  const s: Record<string, string> = {};
  if (resolvedBg.value) s["--o2-btn-bg"] = resolvedBg.value;
  if (resolvedText.value) s["--o2-btn-text"] = resolvedText.value;
  if (props.padding) s["--o2-btn-pad-x"] = props.padding;
  return s;
});

// ─── Navigation ───────────────────────────────────────────────────────────────

const handleClick = (event: MouseEvent) => {
  if (props.disable || props.loading) return;
  if (props.to) {
    router.push(props.to as string);
  }
  emit("click", event);
};

// ─── Tag resolution ───────────────────────────────────────────────────────────

const tag = computed(() => (props.href ? "a" : "button"));

const isIconOnly = computed(() => !props.label && !slots.default);
</script>

<template>
  <component
    :is="tag"
    class="o2-btn"
    :class="[
      {
        'o2-btn--no-caps': noCaps,
        'o2-btn--no-wrap': noWrap,
        'o2-btn--stack': stack,
        'o2-btn--stretch': stretch,
        'o2-btn--dense': dense,
      },
      rootBindings.class,
    ]"
    :style="[inlineStyle, rootBindings.style as string]"
    :data-test="rootBindings['data-test'] as string"
    :data-variant="dataVariant"
    :data-size="size"
    :data-shape="dataShape"
    :data-disabled="disable || undefined"
    :data-loading="loading || undefined"
    :data-icon-only="isIconOnly || undefined"
    :type="tag === 'button' ? type : undefined"
    :href="href"
    :target="target"
    :tabindex="disable ? -1 : tabindex"
    :disabled="disable || undefined"
    :aria-disabled="disable ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    @click="handleClick"
  >
    <!-- Loading spinner overlay -->
    <span v-if="loading" class="o2-btn__spinner"
aria-hidden="true" />

    <!-- Content row (hidden during loading to preserve dimensions) -->
    <span
      class="o2-btn__content"
      :class="{ 'o2-btn__content--hidden': loading }"
    >
      <span
        v-if="icon"
        class="o2-btn__icon o2-btn__icon--left material-icons"
        aria-hidden="true"
        >{{ icon }}</span
      >

      <span v-if="label" class="o2-btn__label">{{ label }}</span>
      <slot />

      <span
        v-if="iconRight"
        class="o2-btn__icon o2-btn__icon--right material-icons"
        aria-hidden="true"
        >{{ iconRight }}</span
      >
    </span>
  </component>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Btn styles — global (non-scoped) using BEM under .o2-btn namespace.
// State is exposed as data attributes for CSS targeting.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────

.o2-btn {
  // Geometry
  --o2-btn-height: 1.75rem;
  --o2-btn-font-size: 0.8125rem;
  --o2-btn-font-family: inherit;
  --o2-btn-font-weight: 500;
  --o2-btn-pad-x: 0.625rem;
  --o2-btn-pad-y: 0;
  --o2-btn-radius: 0.25rem;
  --o2-btn-gap: 0.3125rem;
  --o2-btn-icon-size: 1rem;

  // Colors
  --o2-btn-bg: var(--o2-primary-btn-bg);
  --o2-btn-text: var(--o2-primary-btn-text);
  --o2-btn-border: transparent;
  --o2-btn-hover-bg: color-mix(in srgb, var(--o2-btn-bg) 88%, black);
  --o2-btn-active-bg: color-mix(in srgb, var(--o2-btn-bg) 78%, black);

  // ─── Base ─────────────────────────────────────────────────────────────────
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: var(--o2-btn-height);
  padding: var(--o2-btn-pad-y) var(--o2-btn-pad-x);
  font-size: var(--o2-btn-font-size);
  font-family: var(--o2-btn-font-family);
  font-weight: var(--o2-btn-font-weight);
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--o2-btn-text);
  background: var(--o2-btn-bg);
  border: 1px solid var(--o2-btn-border);
  border-radius: var(--o2-btn-radius);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  vertical-align: middle;
  text-decoration: none;
  outline: none;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease,
    box-shadow 0.15s ease;

  &:hover:not([data-disabled]):not([data-loading]) {
    background: var(--o2-btn-hover-bg);
  }

  &:active:not([data-disabled]):not([data-loading]) {
    background: var(--o2-btn-active-bg);
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--o2-primary-color);
  }

  // ─── Content ──────────────────────────────────────────────────────────────
  &__content {
    display: inline-flex;
    align-items: center;
    gap: var(--o2-btn-gap);
    pointer-events: none;

    &--hidden {
      visibility: hidden;
    }
  }

  &__label {
    line-height: 1;
  }

  // ─── Icons ────────────────────────────────────────────────────────────────
  &__icon {
    font-size: var(--o2-btn-icon-size);
    line-height: 1;
    flex-shrink: 0;
  }

  // ─── Loading spinner ──────────────────────────────────────────────────────
  &__spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0.875rem;
    height: 0.875rem;
    border: 1.5px solid rgba(255, 255, 255, 0.35);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: o2-btn-spin 0.7s linear infinite;
  }

  @keyframes o2-btn-spin {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }

  // ─── Sizes ────────────────────────────────────────────────────────────────
  &[data-size="xs"] {
    --o2-btn-height: 1.25rem;
    --o2-btn-font-size: 0.6875rem;
    --o2-btn-pad-x: 0.375rem;
    --o2-btn-icon-size: 0.75rem;
  }

  &[data-size="sm"] {
    --o2-btn-height: 1.5rem;
    --o2-btn-font-size: 0.75rem;
    --o2-btn-pad-x: 0.5rem;
    --o2-btn-icon-size: 0.875rem;
  }

  &[data-size="lg"] {
    --o2-btn-height: 2rem;
    --o2-btn-font-size: 0.875rem;
    --o2-btn-pad-x: 0.75rem;
    --o2-btn-icon-size: 1.125rem;
  }

  &[data-size="xl"] {
    --o2-btn-height: 2.25rem;
    --o2-btn-font-size: 1rem;
    --o2-btn-pad-x: 0.875rem;
    --o2-btn-icon-size: 1.25rem;
  }

  // ─── Dense ────────────────────────────────────────────────────────────────
  &.o2-btn--dense {
    --o2-btn-height: 1.5rem;
    --o2-btn-pad-x: 0.5rem;
  }

  // ─── Variant: flat ────────────────────────────────────────────────────────
  &[data-variant="flat"] {
    --o2-btn-bg: transparent;
    --o2-btn-text: var(--o2-text-primary);
    --o2-btn-border: transparent;
    --o2-btn-hover-bg: var(--o2-hover-gray);
    --o2-btn-active-bg: color-mix(in srgb, var(--o2-hover-gray) 80%, black);
  }

  // ─── Variant: outline ─────────────────────────────────────────────────────
  &[data-variant="outline"] {
    --o2-btn-bg: transparent;
    --o2-btn-text: var(--o2-primary-color);
    --o2-btn-border: var(--o2-primary-color);
    --o2-btn-hover-bg: color-mix(
      in srgb,
      var(--o2-primary-color) 8%,
      transparent
    );
    --o2-btn-active-bg: color-mix(
      in srgb,
      var(--o2-primary-color) 15%,
      transparent
    );
  }

  // ─── Variant: unelevated ──────────────────────────────────────────────────
  &[data-variant="unelevated"] {
    box-shadow: none;
  }

  // ─── Variant: push ────────────────────────────────────────────────────────
  &[data-variant="push"] {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);

    &:hover:not([data-disabled]) {
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
    }
  }

  // ─── Variant: glossy ──────────────────────────────────────────────────────
  &[data-variant="glossy"] {
    background-image: linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0) 50%,
      rgba(0, 0, 0, 0.05) 100%
    );
  }

  // ─── Shape: round ─────────────────────────────────────────────────────────
  &[data-shape="round"] {
    --o2-btn-pad-x: 0;
    width: var(--o2-btn-height);
    border-radius: 50%;
    flex-shrink: 0;
  }

  // ─── Shape: rounded (pill) ────────────────────────────────────────────────
  &[data-shape="rounded"] {
    border-radius: calc(var(--o2-btn-height) / 2);
  }

  // ─── Shape: square ────────────────────────────────────────────────────────
  &[data-shape="square"] {
    border-radius: 0;
  }

  // ─── Stack (icon above label) ─────────────────────────────────────────────
  &.o2-btn--stack &__content {
    flex-direction: column;
    gap: 0.125rem;
  }

  // ─── Stretch ──────────────────────────────────────────────────────────────
  &.o2-btn--stretch {
    height: 100%;
    border-radius: 0;
  }

  // ─── No caps ──────────────────────────────────────────────────────────────
  &.o2-btn--no-caps {
    text-transform: none;
    letter-spacing: 0;
  }

  // ─── No wrap ──────────────────────────────────────────────────────────────
  &.o2-btn--no-wrap &__content {
    white-space: nowrap;
  }

  // ─── State: disabled ──────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── State: loading ───────────────────────────────────────────────────────
  &[data-loading] {
    cursor: wait;
    pointer-events: none;
  }
}
</style>
