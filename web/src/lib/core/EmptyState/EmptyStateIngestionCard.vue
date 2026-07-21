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
    class="es-ing-card group relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 py-2.5 pr-3.5 pl-3 rounded-default border border-border-default bg-surface-base text-left cursor-pointer outline-none transition-[color,background-color,border-color,box-shadow] duration-150 hover:shadow-md hover:border-primary-400 hover:bg-tabs-hover-bg focus-visible:ring-2 focus-visible:ring-primary-500/40"
    @click="emit('click')"
  >
    <span class="es-ing-card__icon inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-default bg-tabs-active-bg text-tabs-active-text transition-[background-color,color] duration-150" :class="iconClass">
      <OIcon :name="icon" size="md" />
    </span>
    <span class="es-ing-card__body flex-1 min-w-0 flex flex-col gap-0.5">
      <span class="text-compact font-semibold text-text-heading truncate">{{ label }}</span>
      <span v-if="sublabel" class="text-xs text-text-secondary leading-[1.4]">{{ sublabel }}</span>
    </span>
    <OIcon name="chevron-right" size="sm" class="es-ing-card__chevron shrink-0 text-text-disabled transition-[transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
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

<style scoped>
/* keep(brand): decorative icon accent tints — color-mix on palette tokens has
   no semantic equivalent; the parent-hover override must outrank the variant
   classes, so both live here rather than as utilities. */
.es-ing-card__icon--blue   { background: color-mix(in srgb, var(--color-blue-500) 12%, transparent); color: var(--color-blue-500); }
.es-ing-card__icon--teal   { background: color-mix(in srgb, var(--color-teal-600) 12%, transparent); color: var(--color-teal-600); }
.es-ing-card__icon--purple { background: color-mix(in srgb, var(--color-purple-500) 12%, transparent); color: var(--color-purple-500); }
.es-ing-card__icon--amber  { background: color-mix(in srgb, var(--color-amber-600) 12%, transparent); color: var(--color-amber-600); }
.es-ing-card__icon--orange { background: color-mix(in srgb, var(--color-orange-500) 12%, transparent); color: var(--color-orange-500); }

.es-ing-card:hover .es-ing-card__icon,
.es-ing-card:hover [class*="es-ing-card__icon--"] {
  background: var(--color-primary-600);
  color: var(--color-white);
}
</style>
