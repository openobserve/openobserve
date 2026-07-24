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
    class="o-field-row group rounded-default hover:bg-field-list-row-hover-bg relative flex h-6 w-full items-center gap-1 pl-1"
    :class="[highlight && 'bg-field-list-row-hover-bg!']"
  >
    <slot />
    <div
      v-if="$slots.actions"
      class="o-field-row__actions bg-field-list-actions-bg rounded-default absolute top-0 right-0 bottom-0 hidden items-center gap-1.5 overflow-hidden px-1 py-0 group-hover:flex"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  highlight?: boolean;
}>();
</script>
