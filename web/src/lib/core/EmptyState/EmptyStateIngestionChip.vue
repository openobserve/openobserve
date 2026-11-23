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
  EmptyStateIngestionChip — shared pill-style chip used in the "Or:" row of
  ingestion empty states. Renders as <a> when `href` is provided, else <button>.

  `variant="ai"` is the "Ask AI" pill. It used to be a bare `ai-hover-btn` class
  the four call sites passed in, styled by scoped CSS that reached for raw
  gradient/accent tokens; it is a real prop now, so the chip owns its own looks
  and the colours come from registered utilities.
-->
<template>
  <component
    :is="href && !unavailable ? 'a' : 'button'"
    :class="chipClass"
    :aria-disabled="unavailable || undefined"
    v-bind="
      href && !unavailable
        ? { href, target: '_blank', rel: 'noopener noreferrer' }
        : { type: 'button' }
    "
    @click="onClick"
  >
    <OIcon v-if="icon" :name="icon" size="xs" class="shrink-0" />
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

// Shape, spacing and focus ring — identical in both variants.
const CHIP_BASE =
  "es-ing-chip text-compact border-border-default inline-flex items-center gap-1.25 rounded-full border px-3 py-1 font-medium no-underline! outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

// The two colour sets are mutually exclusive so no two `!` utilities ever
// compete for the same property — which class wins would otherwise depend on
// Tailwind's emit order rather than on intent.
const CHIP_DEFAULT =
  "hover:border-accent bg-surface-panel text-text-secondary! hover:text-accent! cursor-pointer transition-[border-color,color,background-color] duration-150 hover:bg-accent/6";

// `ai-hover-btn` survives only as the hook for the two rules the utility layer
// cannot express: the color-mix() glow and the filter on the slotted <img>.
const CHIP_AI =
  "hover:border-accent ai-hover-btn bg-gradient-ai-subtle! text-ai-accent! hover:bg-gradient-ai! hover:text-white! dark:text-white! cursor-pointer transition-[background,box-shadow,color] duration-300";

// No hover utilities and no `ai-hover-btn` hook, whose scoped rules would otherwise still glow.
const CHIP_UNAVAILABLE_DEFAULT = "bg-surface-panel text-text-secondary!";
const CHIP_UNAVAILABLE_AI = "bg-gradient-ai-subtle! text-ai-accent! dark:text-white!";

const props = defineProps<{
  icon?: IconName;
  href?: string;
  variant?: "default" | "ai";
  /** Dims the chip and blocks the action while keeping it focusable for its reason. */
  unavailable?: boolean;
}>();

const emit = defineEmits<{ click: [] }>();

const chipClass = computed(() => {
  const ai = props.variant === "ai";
  if (props.unavailable) {
    return [
      CHIP_BASE,
      "cursor-not-allowed opacity-60",
      ai ? CHIP_UNAVAILABLE_AI : CHIP_UNAVAILABLE_DEFAULT,
    ];
  }
  return [CHIP_BASE, ai ? CHIP_AI : CHIP_DEFAULT];
});

function onClick(event: MouseEvent) {
  if (props.unavailable) {
    event.preventDefault();
    return;
  }
  if (!props.href) emit("click");
}
</script>

<style scoped>
/* keep(complex-state): what is left of the "Ask AI" variant after its colours
   moved to utilities (see CHIP_AI above) — a color-mix() glow, which cannot be a
   utility because a utility can't be a mix input, and a filter on the SLOTTED
   <img>, which only :deep() reaches.

   The glow is the accent at two strengths (dark rest / hover), on the same
   `0 4px 12px` geometry the other AI affordances use. It must be written as
   geometry-token + colour, NOT as `--glow-color` + a :root shadow token: a
   :root token substitutes its var()s against :root, where --glow-color is
   unset, so the override would be discarded and the fallback would ship. */
.dark .ai-hover-btn {
  box-shadow: var(--shadow-glow-md-geom) color-mix(in srgb, var(--color-ai-accent) 20%, transparent);
}

.ai-hover-btn:hover {
  box-shadow: var(--shadow-glow-md-geom) color-mix(in srgb, var(--color-ai-accent) 35%, transparent);
}

.ai-hover-btn:hover :deep(img) {
  filter: brightness(0) invert(1);
  transition: filter 0.3s ease;
}
</style>
