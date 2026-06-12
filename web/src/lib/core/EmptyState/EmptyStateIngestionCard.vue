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
    class="es-ing-card"
    @click="emit('click')"
  >
    <span class="es-ing-card__icon" :class="iconClass">
      <OIcon :name="icon" size="md" />
    </span>
    <span class="es-ing-card__body">
      <span class="es-ing-card__label">{{ label }}</span>
      <span v-if="sublabel" class="es-ing-card__sublabel">{{ sublabel }}</span>
    </span>
    <OIcon name="chevron-right" size="sm" class="es-ing-card__chevron" />
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
.es-ing-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 18rem;
  max-width: 100%;
  min-height: 4rem;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-base);
  box-shadow: var(--shadow-sm);
  text-align: left;
  cursor: pointer;
  transition: color 150ms, background-color 150ms, border-color 150ms, box-shadow 150ms;
  outline: none;
}
.es-ing-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.es-ing-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.es-ing-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  background: var(--color-tabs-active-bg);
  color: var(--color-tabs-active-text);
  transition: background-color 150ms, color 150ms;
}
.es-ing-card__icon--blue   { background: color-mix(in srgb, #3b82f6 12%, transparent); color: #3b82f6; }
.es-ing-card__icon--teal   { background: color-mix(in srgb, #0d9488 12%, transparent); color: #0d9488; }
.es-ing-card__icon--purple { background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
.es-ing-card__icon--amber  { background: color-mix(in srgb, #d97706 12%, transparent); color: #d97706; }
.es-ing-card__icon--orange { background: color-mix(in srgb, #f97316 12%, transparent); color: #f97316; }

.es-ing-card:hover .es-ing-card__icon,
.es-ing-card:hover [class*="es-ing-card__icon--"] {
  background: var(--color-primary-600);
  color: #fff;
}

.es-ing-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.es-ing-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.es-ing-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.es-ing-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.es-ing-card:hover .es-ing-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}
</style>
