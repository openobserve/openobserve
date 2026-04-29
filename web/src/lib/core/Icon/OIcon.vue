<script setup lang="ts">
import type { IconProps, IconSlots } from "./OIcon.types";
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<IconProps>();
defineSlots<IconSlots>();

/**
 * Named sizes map to Tailwind token utilities generated from component.css.
 * Never hardcode px values here — every entry must reference a component token
 * so dark-mode overrides and future token changes propagate automatically.
 */
const NAMED_SIZE_CLASSES: Record<string, string> = {
  xs: "tw:text-icon-xs",
  sm: "tw:text-icon-sm",
  md: "tw:text-icon-md",
  lg: "tw:text-icon-lg",
  xl: "tw:text-icon-xl",
};

const isImgIcon = computed<boolean>(() =>
  Boolean(props.name?.startsWith("img:")),
);

/** Path/URL with the `img:` prefix stripped. */
const imgSrc = computed<string>(() =>
  isImgIcon.value ? (props.name as string).slice(4) : "",
);

/** True when the icon should be rendered as a Material Icons font glyph. */
const isFontIcon = computed<boolean>(
  () => Boolean(props.name) && !isImgIcon.value,
);

const classes = computed<string[]>(
  () =>
    [
      // Layout — flex center so SVG slot content is centered in its box
      "tw:inline-flex tw:items-center tw:justify-center",
      // Prevent the icon from shrinking inside a flex parent
      "tw:shrink-0",
      // Reset line height so the font glyph is not taller than its em-box
      "tw:leading-none",
      // Prevent text selection on the font glyph
      "tw:select-none",
      // Add the Material Icons font class when rendering a named glyph
      isFontIcon.value ? "material-icons" : "",
      // Named size token class (only set when a named size alias is provided)
      props.size ? (NAMED_SIZE_CLASSES[props.size] ?? "") : "",
    ].filter(Boolean) as string[],
);
</script>

<template>
  <!--
    A single root <span> covers all three rendering modes:

    1. Font icon  — `name` is a Material Icons ligature (e.g. "search").
       The `material-icons` class is added so the browser picks up the icon
       font. The text node IS the glyph; we render it inline.

    2. Image icon — `name` is prefixed with "img:" (Quasar compat).
       Renders an <img> with a blank alt (decorative by default).

    3. Slot icon  — no `name` given; consumer provides custom SVG via the
       default slot.

    `aria-hidden` / `aria-label` should be passed by the consumer as HTML
    attributes (they flow through via v-bind="$attrs").
    For purely decorative icons add `aria-hidden="true"`.
    For semantic icons add `aria-label="…"` and `role="img"`.
  -->
  <span :class="classes" v-bind="$attrs">
    <!-- Mode 1: Material Icons glyph -->
    <template v-if="isFontIcon">{{ name }}</template>

    <!-- Mode 2: Image (img: prefix) -->
    <img
      v-else-if="isImgIcon"
      :src="imgSrc"
      alt=""
      class="tw:w-full tw:h-full tw:object-contain"
    />

    <!-- Mode 3: Custom SVG / slot content -->
    <slot v-else />
  </span>
</template>
