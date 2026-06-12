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
-->
<template>
  <component
    :is="href ? 'a' : 'button'"
    class="es-ing-chip"
    v-bind="href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button' }"
    @click="!href && emit('click')"
  >
    <OIcon v-if="icon" :name="icon" size="xs" class="tw:shrink-0" />
    <slot />
  </component>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  icon?: IconName;
  href?: string;
}>();

const emit = defineEmits<{ click: [] }>();
</script>

<style scoped>
.es-ing-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.25rem 0.75rem;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-panel);
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 150ms, color 150ms, background-color 150ms;
  outline: none;
}
.es-ing-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.es-ing-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
