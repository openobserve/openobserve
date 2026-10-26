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

<template>
  <span
    class="relative inline-flex size-7.5 shrink-0 items-center justify-center rounded-full"
    tabindex="0"
    :aria-label="tooltip"
    :data-state="state"
    :data-progress="Math.round(clamped * 100)"
  >
    <svg
      viewBox="0 0 28 28"
      class="absolute inset-0 size-full -rotate-90"
      :class="state === 'spinning' ? 'motion-safe:animate-spin' : undefined"
      aria-hidden="true"
    >
      <circle
        cx="14"
        cy="14"
        r="11"
        class="stroke-border-default fill-none"
        stroke-width="2.2"
        :stroke-dasharray="state === 'off' ? '3 4' : undefined"
      />
      <circle
        v-if="state !== 'off'"
        cx="14"
        cy="14"
        r="11"
        class="fill-none transition-[stroke-dashoffset] duration-1000 ease-linear"
        :class="state === 'paused' ? 'stroke-text-secondary opacity-60' : 'stroke-accent'"
        stroke-width="2.6"
        stroke-linecap="round"
        :stroke-dasharray="state === 'spinning' ? '22 70' : CIRCUMFERENCE"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <span class="text-text-secondary relative inline-flex items-center">
      <slot />
    </span>
    <OTooltip :content="tooltip" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

const CIRCUMFERENCE = 2 * Math.PI * 11;

const props = withDefaults(
  defineProps<{
    /** Share of the wait already elapsed, 0 to 1. */
    progress?: number;
    state?: "running" | "spinning" | "paused" | "off";
    tooltip: I18nText;
  }>(),
  { progress: 0, state: "running" },
);

const clamped = computed(() => Math.min(1, Math.max(0, props.progress)));

const dashOffset = computed(() => {
  if (props.state === "spinning" || props.state === "paused") return 0;
  return CIRCUMFERENCE * (1 - clamped.value);
});
</script>
