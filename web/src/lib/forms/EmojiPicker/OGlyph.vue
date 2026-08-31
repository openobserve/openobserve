<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Renders one icon token — a Unicode emoji as text, or a full-colour service
// glyph as an inline SVG / <img>. Everything that displays a chosen icon goes
// through here, so the rest of the app never has to know which kind it holds.

import { computed } from "vue";
import { resolveGlyph, isGlyphToken, isImageGlyph } from "./glyphRegistry";
import type { GlyphProps } from "./OGlyph.types";

const props = withDefaults(defineProps<GlyphProps>(), {
  token: null,
  size: "md",
  alt: "",
});

const glyph = computed(() => resolveGlyph(props.token));
const imageSrc = computed(() => (isImageGlyph(glyph.value) ? glyph.value : null));
const glyphComponent = computed(() => (isImageGlyph(glyph.value) ? null : glyph.value));

// An `o2:` token with no registry entry renders nothing rather than leaking the
// raw string — that happens when a glyph is retired but a folder still points
// at it.
const showEmoji = computed(() => !!props.token && !isGlyphToken(props.token));

// Emoji are sized by font-size, glyphs by box — a single scale drives both so
// the two kinds line up on the same row.
const emojiSize: Record<NonNullable<GlyphProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-xl",
};
const glyphSize: Record<NonNullable<GlyphProps["size"]>, string> = {
  sm: "size-3.5",
  md: "size-4.5",
  lg: "size-5",
};

// Brand logos keep their own colours, so unlike an OIcon they can't adapt to the
// surface. `bg-glyph-plate` is transparent on light and a light chip on dark,
// which is what keeps near-black marks (GitHub, Kafka, Helm) visible there.
const plateClasses = "bg-glyph-plate rounded-default box-content p-px";
</script>

<template>
  <span
    v-if="glyphComponent"
    :class="['inline-flex shrink-0 items-center justify-center', plateClasses]"
    data-test="glyph-plate"
  >
    <component
      :is="glyphComponent"
      :class="glyphSize[size]"
      aria-hidden="true"
      data-test="glyph-svg"
    />
  </span>
  <span
    v-else-if="imageSrc"
    :class="['inline-flex shrink-0 items-center justify-center', plateClasses]"
    data-test="glyph-plate"
  >
    <img
      :src="imageSrc"
      :alt="alt"
      loading="lazy"
      decoding="async"
      :class="['object-contain', glyphSize[size]]"
      data-test="glyph-img"
    />
  </span>
  <span
    v-else-if="showEmoji"
    :class="['shrink-0 leading-none', emojiSize[size]]"
    aria-hidden="true"
    data-test="glyph-emoji"
    >{{ token }}</span
  >
</template>
