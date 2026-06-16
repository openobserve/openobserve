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
    class="tw:inline-flex tw:items-center tw:gap-1.25 tw:py-1 tw:px-3 tw:text-sm tw:font-medium tw:rounded-full tw:border tw:border-border-default tw:bg-surface-panel tw:text-text-secondary tw:no-underline tw:cursor-pointer tw:outline-none tw:transition-[border-color,color,background-color] tw:duration-150 tw:hover:border-primary-400 tw:hover:text-primary-600 tw:hover:bg-[color-mix(in_srgb,var(--color-primary-500)_6%,transparent)] tw:focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
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
