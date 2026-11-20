<script setup lang="ts">
import type { TextProps, TextSlots } from "./OText.types";
import { Primitive } from "reka-ui";
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(defineProps<TextProps>(), {
  variant: "body",
  truncate: false,
  nowrap: false,
  wrap: false,
  tooltip: undefined,
});

defineSlots<TextSlots>();

// Default HTML element per variant.
// Chosen to produce correct semantic HTML out-of-the-box while
// remaining overrideable via the `as` prop.
const variantDefaultAs: Record<NonNullable<TextProps["variant"]>, string> = {
  // <span> intentionally — pages must not accidentally emit multiple <h1> tags.
  // Consumers that need an <h1> pass `as="h1"` explicitly.
  "page-title": "span",
  // <h2> for section group labels ("Web Vitals", "Key Fields").
  section: "h2",
  // <h3> for card and panel titles.
  "panel-title": "h3",
  // <h3> for the heading of a section pane on a detail page.
  "card-title": "h3",
  // <p> for block-level body paragraphs.
  body: "p",
  // <strong> carries semantic emphasis for screen readers.
  "body-strong": "strong",
  // <span> — labels are not standalone headings.
  label: "span",
  // <span> — inline metadata.
  meta: "span",
  // <span> — inline monospace (not <code>, which implies executable syntax).
  // Use OCode for actual code/query content.
  mono: "span",
};

const resolvedAs = computed(() => props.as ?? variantDefaultAs[props.variant ?? "body"]);

// All classes reference design tokens via  prefix.
// Color tokens (--color-typography-*) are defined in component.css and
// registered in the @theme inline block so `text-typography-*` works.
// Font sizes use Tailwind's built-in scale (text-sm = 14px, text-xs = 12px).
const variantClasses: Record<NonNullable<TextProps["variant"]>, string> = {
  // Page title (h1).
  "page-title": [
    "text-lg font-semibold tracking-[-0.01em]",
    "text-typography-page-title",
    "leading-tight",
  ].join(" "),

  // Group label (sidebar, field list): recedes by colour, not weight.
  section: ["text-xs font-medium", "text-typography-section", "leading-none"].join(" "),

  // Card or panel title (h3).
  "panel-title": [
    "text-compact font-semibold",
    "text-typography-panel-title",
    "leading-tight",
  ].join(" "),

  // Section title (h2) on a detail page; no 15px token yet, so text-sm is the nearest.
  "card-title": ["text-sm font-semibold", "text-typography-panel-title", "leading-tight"].join(" "),

  // Default body text. Most table cells, descriptions, and paragraphs.
  body: ["text-sm font-normal", "text-typography-body"].join(" "),

  // Emphasized body: same size as body but medium. Names, totals, values.
  "body-strong": ["text-sm font-medium", "text-typography-body"].join(" "),

  // Form label: body colour, so it sits below the headings.
  label: ["text-compact font-medium", "text-typography-body", "leading-none"].join(" "),

  // Helper text and metadata: timestamps, counts, last-updated info.
  meta: ["text-xs font-normal", "text-typography-meta", "leading-none"].join(" "),

  // Monospace: cron expressions, stream names (non-linked), field paths, IDs.
  // Uses Geist Mono via the --font-mono CSS custom property.
  // For actual executable code / query content, prefer OCode instead.
  mono: [
    "text-xs font-mono",
    // tabular figures + tight tracking for IDs/counts/timestamps.
    "[font-feature-settings:'tnum'] tracking-[-0.0125rem]",
    "text-typography-mono",
    "leading-none",
  ].join(" "),
};

const classes = computed(() => [
  props.wrap
    ? variantClasses[props.variant ?? "body"].replace(/\bleading-(none|tight)\b/, "leading-normal")
    : variantClasses[props.variant ?? "body"],
  props.truncate ? "truncate max-w-full overflow-hidden" : "",
  props.nowrap ? "whitespace-nowrap" : "",
]);
</script>

<template>
  <Primitive
    :as="resolvedAs"
    :class="classes"
    :data-o-tooltip-off="truncate && tooltip === false ? '' : undefined"
  >
    <OTooltip v-if="truncate && tooltip !== false" overflow-only :content="tooltip || undefined" />
    <slot />
  </Primitive>
</template>
