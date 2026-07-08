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
    class="es-ing-card relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 py-2.5 pr-3.5 pl-3 rounded-xl border border-border-default bg-surface-base shadow-sm text-left cursor-pointer outline-none transition-[color,background-color,border-color,box-shadow] duration-150"
    @click="emit('click')"
  >
    <span class="es-ing-card__icon inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-lg bg-tabs-active-bg text-tabs-active-text transition-[background-color,color] duration-150" :class="iconClass">
      <OIcon :name="icon" size="md" />
    </span>
    <span class="es-ing-card__body flex-1 min-w-0 flex flex-col gap-0.5">
      <span class="text-[length:var(--text-sm)] font-semibold text-text-primary truncate">{{ label }}</span>
      <span v-if="sublabel" class="text-[length:var(--text-xs)] text-text-secondary leading-[1.4]">{{ sublabel }}</span>
    </span>
    <OIcon name="chevron-right" size="sm" class="es-ing-card__chevron shrink-0 text-text-disabled transition-[transform,color] duration-150" />
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
