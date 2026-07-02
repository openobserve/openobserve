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

<template>
  <div
    class="o-field-row tw:group tw:h-6 tw:flex tw:items-center tw:gap-1 tw:w-full tw:relative tw:pl-1 tw:rounded-[0.25rem] tw:hover:bg-field-list-row-hover-bg"
    :class="[highlight && 'tw:bg-field-list-row-hover-bg!']"
  >
    <slot />
    <div
      v-if="$slots.actions"
      class="o-field-row__actions tw:absolute tw:right-0 tw:top-0 tw:bottom-0 tw:hidden tw:group-hover:flex tw:items-center tw:py-0 tw:px-1 tw:gap-[0.375rem] tw:bg-(--color-field-list-actions-bg) tw:rounded tw:overflow-hidden"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  highlight?: boolean
}>()
</script>

