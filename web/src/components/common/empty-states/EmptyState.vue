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
  <div class="empty-state-root tw:relative tw:w-full tw:h-full tw:overflow-hidden">
    <!-- decorative backdrop — subtle dot texture only (no color gradient) -->
    <div
      aria-hidden="true"
      class="tw:absolute tw:inset-0 tw:pointer-events-none"
      :style="dotGridStyle"
    />

    <!-- content -->
    <div
      class="tw:relative tw:w-full tw:h-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-7 tw:px-6 tw:py-12 tw:text-center"
    >
      <div v-if="$slots.illustration" class="tw:shrink-0">
        <slot name="illustration" />
      </div>

      <div class="tw:flex tw:flex-col tw:gap-2.5 tw:max-w-xl">
        <h2
          class="tw:text-2xl! tw:font-semibold! tw:text-text-primary tw:tracking-[-0.01em]"
        >
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="description || $slots.description"
          class="tw:text-base tw:text-text-secondary tw:leading-relaxed"
        >
          <slot name="description">{{ description }}</slot>
        </p>
      </div>

      <!-- Actions presented as a distinct, labelled section so the empty state
           reads as multiple structured elements (hero + "quick start" group)
           rather than one sparse centered block. -->
      <div
        v-if="$slots.actions"
        class="tw:w-full tw:max-w-3xl tw:flex tw:flex-col tw:items-center tw:gap-4"
      >
        <div
          v-if="actionsLabel"
          class="tw:flex tw:items-center tw:gap-3 tw:w-full tw:max-w-md"
        >
          <span class="tw:h-px tw:flex-1 tw:bg-border-default" />
          <span
            class="tw:text-[0.6875rem] tw:font-semibold tw:text-text-secondary tw:whitespace-nowrap"
            >{{ actionsLabel }}</span
          >
          <span class="tw:h-px tw:flex-1 tw:bg-border-default" />
        </div>
        <div
          class="tw:flex tw:flex-wrap tw:items-stretch tw:justify-center tw:gap-3"
        >
          <slot name="actions" />
        </div>
      </div>

      <div
        v-if="$slots.extra"
        class="tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-3 tw:pt-2"
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

<!--
  Plain CSS (not SCSS) for the one thing Tailwind can't express here: a
  theme-aware color for the decorative dot grid. There is no `dark:` variant
  configured, so the dot color is set per theme via the `.dark` class.
-->
<style scoped>
.empty-state-root {
  --empty-dot: var(--color-grey-300);
}
:global(.dark) .empty-state-root {
  --empty-dot: var(--color-grey-800);
}
</style>
