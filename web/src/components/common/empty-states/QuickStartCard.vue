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
  QuickStartCard — an actionable next-step card used in empty states. Every card
  shares ONE look (a light, bordered surface that lifts on hover) so the options
  read as equal, clearly-clickable actions — none is styled as a louder "primary"
  button. Interactivity is signalled by the hover lift + sliding chevron, not by
  any flashing animation. Tailwind-only, token-based.
-->
<template>
  <button
    type="button"
    class="tw:group tw:relative tw:flex tw:items-center tw:gap-3 tw:w-64 tw:max-w-full tw:h-16 tw:ps-3 tw:pe-3.5 tw:rounded-xl tw:border tw:border-border-default tw:bg-surface-base tw:shadow-sm tw:text-left tw:cursor-pointer tw:transition-[color,background-color,border-color,box-shadow,transform] tw:duration-150 tw:outline-none tw:hover:shadow-md tw:hover:border-primary-400 tw:hover:bg-tabs-hover-bg tw:focus-visible:ring-[0.125rem] tw:focus-visible:ring-primary-500/40"
  >
    <span
      class="tw:relative tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:h-10 tw:rounded-lg tw:bg-tabs-active-bg tw:text-tabs-active-text tw:transition-colors tw:group-hover:bg-primary-600 tw:group-hover:text-white"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="tw:relative tw:flex-1 tw:min-w-0">
      <span class="tw:block tw:text-sm tw:font-semibold tw:truncate tw:text-text-primary">{{
        label
      }}</span>
      <span
        v-if="sublabel"
        class="tw:block tw:text-xs tw:truncate tw:text-text-secondary"
        >{{ sublabel }}</span
      >
    </span>

    <OIcon
      name="chevron-right"
      size="sm"
      class="tw:relative tw:shrink-0 tw:text-text-disabled tw:transition-transform tw:group-hover:translate-x-0.5 tw:group-hover:text-primary-600"
    />
  </button>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  icon: IconName;
  label: string;
  sublabel?: string;
}>();
</script>
