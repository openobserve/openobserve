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
  EmptyStateIngestionCard — shared action card used across ingestion / onboarding
  empty states (LogsNoDataState, TracesNoDataState, HomeNoDataState, etc.).
  Consolidates the repeated .nd-card / .ns-card / .tnd-card / .hnd-card CSS.
-->
<template>
  <button
    type="button"
    class="es-ing-card tw:relative tw:flex tw:items-center tw:gap-3 tw:w-[18rem] tw:max-w-full tw:min-h-16 tw:py-2.5 tw:pr-3.5 tw:pl-3 tw:rounded-xl tw:border tw:border-border-default tw:bg-surface-base tw:shadow-sm tw:text-left tw:cursor-pointer tw:outline-none tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150"
    @click="emit('click')"
  >
    <span class="es-ing-card__icon tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:h-10 tw:rounded-lg tw:bg-tabs-active-bg tw:text-tabs-active-text tw:transition-[background-color,color] tw:duration-150" :class="iconClass">
      <OIcon :name="icon" size="md" />
    </span>
    <span class="es-ing-card__body tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-0.5">
      <span class="tw:text-sm tw:font-semibold tw:text-text-primary tw:truncate">{{ label }}</span>
      <span v-if="sublabel" class="tw:text-xs tw:text-text-secondary tw:leading-snug">{{ sublabel }}</span>
    </span>
    <OIcon name="chevron-right" size="sm" class="es-ing-card__chevron tw:shrink-0 tw:text-text-disabled tw:transition-[transform,color] tw:duration-150" />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

type IconVariant = "default" | "blue" | "teal" | "purple" | "amber" | "orange";

const props = withDefaults(
  defineProps<{
    icon: IconName;
    label: string;
    sublabel?: string;
    iconVariant?: IconVariant;
  }>(),
  { iconVariant: "default" },
);

const emit = defineEmits<{ click: [] }>();

const iconClass = computed(() =>
  props.iconVariant === "default" ? "" : `es-ing-card__icon--${props.iconVariant}`,
);
</script>

<style>
/* hover / focus-visible states (compound selectors — can't be inlined) */
.es-ing-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.es-ing-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

/* icon color variants (color-mix not expressible in Tailwind arbitrary) */
.es-ing-card__icon--blue   { background: color-mix(in srgb, #3b82f6 12%, transparent); color: #3b82f6; }
.es-ing-card__icon--teal   { background: color-mix(in srgb, #0d9488 12%, transparent); color: #0d9488; }
.es-ing-card__icon--purple { background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
.es-ing-card__icon--amber  { background: color-mix(in srgb, #d97706 12%, transparent); color: #d97706; }
.es-ing-card__icon--orange { background: color-mix(in srgb, #f97316 12%, transparent); color: #f97316; }

/* parent-context compound: icon highlight on card hover */
.es-ing-card:hover .es-ing-card__icon,
.es-ing-card:hover [class*="es-ing-card__icon--"] {
  background: var(--color-primary-600);
  color: #fff;
}

/* chevron nudge on card hover */
.es-ing-card:hover .es-ing-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}
</style>
