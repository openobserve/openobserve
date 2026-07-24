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
  <div class="flex h-full min-w-0 flex-col justify-center gap-2 leading-tight">
    <div class="flex min-w-0 flex-nowrap items-center">
      <span
        v-if="column.country_iso_code"
        :class="`fi fi-${column.country_iso_code} mr-1.5 shrink-0`"
      />
      <div class="truncate text-xs">{{ column.country || "Unknown" }}</div>
    </div>
    <div class="text-text-secondary flex min-w-0 flex-nowrap items-center text-xs">
      <template v-for="(part, index) in detailParts" :key="`${index}-${part}`">
        <OIcon
          v-if="index > 0"
          data-test="circle-icon"
          name="circle"
          size="xs"
          class="text-icon-color mx-1.5 shrink-0"
        />
        <span class="truncate">{{ part }}</span>
      </template>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { computed } from "vue";
import "flag-icons/css/flag-icons.min.css";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
});

// Only render the parts that are actually known — no dangling separators.
const detailParts = computed(() => {
  const parts = [props.column.city, props.column.browser, props.column.os]
    .map((part) => (part || "").trim())
    .filter(Boolean);
  return parts.length ? parts : ["Unknown"];
});
</script>
