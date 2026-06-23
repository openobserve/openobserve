<script setup lang="ts">
import type { TextProps, TextSlots } from "./OText.types";
import { Primitive } from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<TextProps>(), {
  variant: "body",
  truncate: false,
  nowrap: false,
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
  "section": "h2",
  // <h3> for card and panel titles.
  "panel-title": "h3",
  // <p> for block-level body paragraphs.
  "body": "p",
  // <strong> carries semantic emphasis for screen readers.
  "body-strong": "strong",
  // <span> — labels are not standalone headings.
  "label": "span",
  // <span> — inline metadata.
  "meta": "span",
  // <span> — inline monospace (not <code>, which implies executable syntax).
  // Use OCode for actual code/query content.
  "mono": "span",
};

const resolvedAs = computed(
  () => props.as ?? variantDefaultAs[props.variant ?? "body"],
);

// All classes reference design tokens via tw: prefix.
// Color tokens (--color-typography-*) are defined in component.css and
// registered in the @theme inline block so `tw:text-typography-*` works.
// Font sizes use Tailwind's built-in scale (text-sm = 14px, text-xs = 12px).
const variantClasses: Record<NonNullable<TextProps["variant"]>, string> = {
  // Page title: compact, authoritative. Designed for the page header rail.
  // Target: same visual weight as Datadog / Grafana page titles — quiet but clear.
  "page-title": [
    "tw:text-sm tw:font-medium",
    "tw:text-typography-page-title",
    "tw:leading-tight",
  ].join(" "),

  // Section group label (gray eyebrow). Recedes via color + size, not weight.
  "section": [
    "tw:text-[11.5px] tw:font-medium",
    "tw:text-typography-section",
    "tw:leading-none",
  ].join(" "),

  // Panel / card title: mixed-case, slightly heavier than body, primary color.
  // For collapsible triggers, sidebar group headings, widget card headers.
  "panel-title": [
    "tw:text-xs tw:font-medium",
    "tw:text-typography-panel-title",
    "tw:leading-tight",
  ].join(" "),

  // Default body text. Most table cells, descriptions, and paragraphs.
  "body": [
    "tw:text-sm tw:font-normal",
    "tw:text-typography-body",
  ].join(" "),

  // Emphasized body: same size as body but medium. Names, totals, values.
  "body-strong": [
    "tw:text-sm tw:font-medium",
    "tw:text-typography-body",
  ].join(" "),

  // Compact label: 12px medium. Filter labels, column sub-labels, pill text.
  "label": [
    "tw:text-xs tw:font-medium",
    "tw:text-typography-label",
    "tw:leading-none",
  ].join(" "),

  // Metadata: timestamps, record counts, helper text, last-updated info.
  // Visually recessive — secondary color, no emphasis.
  "meta": [
    "tw:text-xs tw:font-normal",
    "tw:text-typography-meta",
    "tw:leading-none",
  ].join(" "),

  // Monospace: cron expressions, stream names (non-linked), field paths, IDs.
  // Uses IBM Plex Mono via the --font-mono CSS custom property.
  // For actual executable code / query content, prefer OCode instead.
  "mono": [
    "tw:text-xs tw:[font-family:var(--font-mono)]",
    // HANDOFF §2.1: tabular figures + tight tracking for IDs/counts/timestamps.
    "tw:[font-feature-settings:'tnum'] tw:tracking-[-0.2px]",
    "tw:text-typography-mono",
    "tw:leading-none",
  ].join(" "),
};

const classes = computed(() => [
  variantClasses[props.variant ?? "body"],
  props.truncate ? "tw:truncate tw:max-w-full tw:overflow-hidden" : "",
  props.nowrap ? "tw:whitespace-nowrap" : "",
]);
</script>

<template>
  <Primitive :as="resolvedAs" :class="classes">
    <slot />
  </Primitive>
</template>
