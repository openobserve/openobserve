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
  EmptyStateActionCard — an actionable next-step card for empty states: icon +
  title + description, lifting on hover with a sliding chevron. Every card shares
  one look so options read as equal, clearly-clickable actions. Tailwind-only,
  token-based. (Self-contained copy for the EmptyState lib.)
-->
<template>
  <button
    type="button"
    class="group rounded-default border-border-default bg-surface-base hover:border-primary-400 hover:bg-tabs-hover-bg focus-visible:ring-primary-500/40 relative flex min-h-16 max-w-72 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-3 border py-2.5 ps-3 pe-3.5 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none hover:shadow-md focus-visible:ring-[0.125rem]"
  >
    <span
      class="rounded-default bg-tabs-active-bg text-tabs-active-text group-hover:bg-primary-600 relative inline-flex h-10 w-10 shrink-0 items-center justify-center transition-colors group-hover:text-white"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="relative min-w-0 flex-1">
      <span :title="label" class="text-text-heading block text-sm font-medium wrap-break-word">{{
        label
      }}</span>
      <span v-if="sublabel" class="text-text-secondary block text-xs leading-snug">{{
        sublabel
      }}</span>
    </span>

    <OIcon
      v-if="!hideChevron"
      name="chevron-right"
      size="sm"
      class="text-text-disabled group-hover:text-primary-600 relative shrink-0 transition-transform group-hover:translate-x-0.5"
    />
  </button>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  icon: IconName | (string & {});
  label: string;
  sublabel?: string;
  hideChevron?: boolean;
}>();
</script>
