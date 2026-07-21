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
    class="o-field-row group h-6 flex items-center gap-1 w-full relative pl-1 rounded-default hover:bg-field-list-row-hover-bg"
    :class="[highlight && 'bg-field-list-row-hover-bg!']"
  >
    <slot />
    <div
      v-if="$slots.actions"
      class="o-field-row__actions absolute right-0 top-0 bottom-0 hidden group-hover:flex items-center py-0 px-1 gap-1.5 bg-field-list-actions-bg rounded-default overflow-hidden"
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

