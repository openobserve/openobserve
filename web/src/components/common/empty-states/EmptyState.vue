<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  EmptyState — generic centered empty-state scaffold (illustration, title,
  description, actions, extra). Fills the surrounding space with subtle
  background graphics: a radially-masked dot grid + a soft brand glow, so the
  empty area reads as an intentional backdrop rather than blank whitespace.
  Tailwind + inline gradients only (no SCSS). Home for all empty states.

  Slots: illustration | title | description | actions | extra
-->
<template>
  <div class="relative w-full h-full overflow-hidden [--empty-dot:var(--color-grey-300)] dark:[--empty-dot:var(--color-grey-800)]">
    <!-- decorative backdrop — subtle dot texture only (no color gradient) -->
    <div
      aria-hidden="true"
      class="absolute inset-0 pointer-events-none"
      :style="dotGridStyle"
    />

    <!-- content -->
    <div
      class="relative w-full h-full flex flex-col items-center justify-center gap-7 px-6 py-12 text-center"
    >
      <div v-if="$slots.illustration" class="shrink-0">
        <slot name="illustration" />
      </div>

      <div class="flex flex-col gap-2.5 max-w-xl">
        <h2
          class="text-2xl! font-semibold! text-text-primary tracking-[-0.01em]"
        >
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="description || $slots.description"
          class="text-base text-text-secondary leading-relaxed"
        >
          <slot name="description">{{ description }}</slot>
        </p>
      </div>

      <!-- Actions presented as a distinct, labelled section so the empty state
           reads as multiple structured elements (hero + "quick start" group)
           rather than one sparse centered block. -->
      <div
        v-if="$slots.actions"
        class="w-full max-w-3xl flex flex-col items-center gap-4"
      >
        <div
          v-if="actionsLabel"
          class="flex items-center gap-3 w-full max-w-md"
        >
          <span class="h-px flex-1 bg-border-default" />
          <span
            class="text-[0.6875rem] font-semibold text-text-secondary whitespace-nowrap"
            >{{ actionsLabel }}</span
          >
          <span class="h-px flex-1 bg-border-default" />
        </div>
        <div
          class="flex flex-wrap items-stretch justify-center gap-3"
        >
          <slot name="actions" />
        </div>
      </div>

      <div
        v-if="$slots.extra"
        class="w-full flex flex-col items-center gap-3 pt-2"
      >
        <slot name="extra" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    /** Optional eyebrow label rendered above the actions (e.g. "Quick start"). */
    actionsLabel?: string;
  }>(),
  { title: "", description: "", actionsLabel: "" },
);

// Faded dot-grid, masked to a soft ellipse so it concentrates behind the
// content and dissolves toward the edges.
const dotGridStyle =
  // `--empty-dot` is theme-aware (see <style> below): grey-300 in light so the
  // dots read clearly on white, ~grey-800 in dark.
  "background-image: radial-gradient(var(--empty-dot) 1.25px, transparent 1.25px);" +
  // sparse spacing so the texture stays subtle, not busy.
  "background-size: 30px 30px;" +
  // concentrated behind the illustration/text and faded to clean space well
  // before the edges — a soft backdrop, not an all-over grid.
  "-webkit-mask-image: radial-gradient(ellipse 60% 62% at 50% 44%, #000 0%, transparent 70%);" +
  "mask-image: radial-gradient(ellipse 60% 62% at 50% 44%, #000 0%, transparent 70%);";
</script>

