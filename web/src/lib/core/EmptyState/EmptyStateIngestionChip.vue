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
    class="es-ing-chip inline-flex items-center gap-1.25 py-1 px-3 text-[length:var(--text-sm)] font-medium rounded-full border border-border-default bg-surface-panel no-underline cursor-pointer outline-none transition-[border-color,color,background-color] duration-150 hover:border-primary-400 hover:bg-[color-mix(in_srgb,var(--color-primary-500)_6%,transparent)] focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
    v-bind="href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button' }"
    @click="!href && emit('click')"
  >
    <OIcon v-if="icon" :name="icon" size="xs" class="shrink-0" />
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

<style>
/* Color can't be inlined: as an <a> the chip inherits the global unlayered
   `a { color: var(--o2-text-link) }`, which beats any layered  utility.
   A class selector outranks the bare `a` selector without needing `!`. */
.es-ing-chip { color: var(--color-text-secondary); }
.es-ing-chip:hover { color: var(--color-primary-600); text-decoration: none; }
</style>
