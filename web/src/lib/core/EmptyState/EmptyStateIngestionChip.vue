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
    class="es-ing-chip inline-flex items-center gap-1.25 py-1 px-3 text-compact font-medium rounded-full border border-border-default bg-surface-panel no-underline! text-text-secondary! cursor-pointer outline-none transition-[border-color,color,background-color] duration-150 hover:border-accent hover:text-accent! hover:bg-[color-mix(in_srgb,var(--color-primary-500)_6%,transparent)] focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
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

<style scoped>
/* keep(complex-state): `.ai-hover-btn` is this chip's public modifier API — the
   four ingestion empty states (logs/traces NoData + NoEvents) pass it onto the
   chip's OWN root to turn it into the "Ask AI" pill. It needs a hover-state
   gradient swap plus a filter on the SLOTTED <img> (hence `:deep`), so it
   cannot be expressed as template utilities on the call sites. `!important`
   preserves the previous global rule's win over the chip's own
   `bg-surface-panel` / `text-text-secondary!` / `hover:text-accent!`
   utilities. Dark mode rides the `--color-gradient-ai-subtle` token flip. */
.ai-hover-btn {
  background: var(--color-gradient-ai-subtle) !important;
  color: var(--color-ai-accent) !important;
  transition:
    background 0.3s ease,
    box-shadow 0.3s ease,
    color 0.3s ease;
}

.dark .ai-hover-btn {
  box-shadow: 0 0.25rem 0.75rem 0
    color-mix(in srgb, var(--color-ai-accent) 20%, transparent);
  color: white !important;
}

.ai-hover-btn:hover {
  background: var(--color-gradient-ai) !important;
  box-shadow: 0 0.25rem 0.75rem 0
    color-mix(in srgb, var(--color-ai-accent) 35%, transparent);
  color: white !important;
}

.ai-hover-btn:hover :deep(img) {
  filter: brightness(0) invert(1);
  transition: filter 0.3s ease;
}
</style>
