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
    class="o-field-row group hover:bg-field-list-row-hover-bg -mx-page-edge pe-page-edge relative flex h-6 w-[calc(100%+2*var(--spacing-page-edge))] items-center gap-1 ps-[calc(var(--spacing-page-edge)+0.25rem)] max-md:h-7"
    :class="[highlight && 'bg-field-list-row-hover-bg!']"
  >
    <!-- Only the row's content carries the id, so the list's row control is named without the action buttons. -->
    <span v-if="labelId" :id="labelId" class="contents"><slot /></span>
    <slot v-else />
    <!-- The trailing action stays at the row's end and becomes the strip's last action, so the strip never covers it. -->
    <div
      v-if="$slots.trailing"
      class="o-field-row__actions group-focus-visible:bg-gradient-field-list-actions group-has-[:focus-visible]:bg-gradient-field-list-actions group-hover:bg-gradient-field-list-actions max-md:bg-gradient-field-list-actions group-hover:pe-page-edge group-focus-visible:pe-page-edge group-has-[:focus-visible]:pe-page-edge max-md:pe-page-edge flex shrink-0 items-center gap-1.5 overflow-hidden py-0 pe-0 group-hover:absolute group-hover:top-0 group-hover:right-0 group-hover:bottom-0 group-hover:ps-6 group-focus-visible:absolute group-focus-visible:top-0 group-focus-visible:right-0 group-focus-visible:bottom-0 group-focus-visible:ps-6 group-has-[:focus-visible]:absolute group-has-[:focus-visible]:top-0 group-has-[:focus-visible]:right-0 group-has-[:focus-visible]:bottom-0 group-has-[:focus-visible]:ps-6 max-md:absolute max-md:top-0 max-md:right-0 max-md:bottom-0 max-md:ps-6"
    >
      <span
        v-if="$slots.actions"
        class="sr-only group-hover:contents group-focus-visible:contents group-has-[:focus-visible]:contents max-md:contents"
      >
        <slot name="actions" />
      </span>
      <slot name="trailing" />
    </div>
    <div
      v-else-if="$slots.actions"
      class="o-field-row__actions bg-field-list-actions-bg rounded-default pe-page-edge pointer-events-none absolute top-0 right-0 bottom-0 flex items-center gap-1.5 overflow-hidden py-0 ps-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 max-md:pointer-events-auto max-md:opacity-100"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFieldRowLabelId } from "./fieldRowLabel";

defineProps<{
  highlight?: boolean;
}>();

const labelId = useFieldRowLabelId();
</script>
