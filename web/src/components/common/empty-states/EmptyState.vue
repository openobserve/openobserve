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
  <div
    class="relative h-full w-full overflow-hidden [--empty-dot:var(--color-grey-300)] dark:[--empty-dot:var(--color-grey-800)]"
  >
    <!--
      Decorative backdrop — subtle dot texture only (no color gradient).
      The dot colour comes from `--empty-dot` (set theme-aware on the parent).
      Sparse 1.875rem spacing keeps the texture subtle, and the ellipse mask
      concentrates it behind the illustration/text, dissolving well before the
      edges so it reads as a soft backdrop rather than an all-over grid.
    -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--empty-dot)_1.25px,transparent_1.25px)] mask-[radial-gradient(ellipse_60%_62%_at_50%_44%,var(--color-black)_0%,transparent_70%)] bg-size-[1.875rem_1.875rem] [-webkit-mask-image:radial-gradient(ellipse_60%_62%_at_50%_44%,var(--color-black)_0%,transparent_70%)]"
    />

    <!-- content -->
    <div
      class="relative flex h-full w-full flex-col items-center justify-center gap-7 px-6 py-12 text-center"
    >
      <div v-if="$slots.illustration" class="shrink-0">
        <slot name="illustration" />
      </div>

      <div class="flex max-w-xl flex-col gap-2.5">
        <h2 class="text-text-heading text-2xl! font-semibold! tracking-[-0.01em]">
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="description || $slots.description"
          class="text-text-secondary text-base leading-relaxed"
        >
          <slot name="description">{{ description }}</slot>
        </p>
      </div>

      <!-- Actions presented as a distinct, labelled section so the empty state
           reads as multiple structured elements (hero + "quick start" group)
           rather than one sparse centered block. -->
      <div v-if="$slots.actions" class="flex w-full max-w-3xl flex-col items-center gap-4">
        <div v-if="actionsLabel" class="flex w-full max-w-md items-center gap-3">
          <span class="bg-border-default h-px flex-1" />
          <span class="text-2xs text-text-secondary font-semibold whitespace-nowrap">{{
            actionsLabel
          }}</span>
          <span class="bg-border-default h-px flex-1" />
        </div>
        <div class="flex flex-wrap items-stretch justify-center gap-3">
          <slot name="actions" />
        </div>
      </div>

      <div v-if="$slots.extra" class="flex w-full flex-col items-center gap-3 pt-2">
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
</script>
