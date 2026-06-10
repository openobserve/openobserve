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
  <div class="tw:flex tw:flex-col tw:justify-center tw:gap-2 tw:leading-tight tw:min-w-0 tw:h-full">
    <div class="tw:flex tw:items-center tw:flex-nowrap tw:min-w-0">
      <span :class="`fi fi-${column.country_iso_code} tw:mr-1.5 tw:shrink-0`" />
      <div class="tw:text-xs tw:truncate">{{ column.country }}</div>
    </div>
    <div class="tw:flex tw:items-center tw:flex-nowrap tw:min-w-0 tw:text-xs tw:text-text-secondary">
      <span class="tw:truncate">{{ column.city || "Unknown" }}</span>
      <OIcon
        data-test="circle-icon"
        name="circle"
        size="xs"
        class="tw:mx-1.5 tw:text-gray-400 tw:shrink-0"
      />
      <span class="tw:truncate">{{ column.browser }}</span>
      <OIcon
        data-test="circle-icon"
        name="circle"
        size="xs"
        class="tw:mx-1.5 tw:text-gray-400 tw:shrink-0"
      />
      <span class="tw:truncate">{{ column.os }}</span>
    </div>
  </div>
</template>
<script lang="ts" setup>
import "flag-icons/css/flag-icons.min.css";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps({
  column: {
    type: Object,
    required: true,
  },
});
</script>
<style lang="scss">
.error_type {
  font-size: 1rem;
  color: $info;
}

.error_description {
  font-size: 0.875rem;
}

.error_message {
  font-size: 0.875rem;
}

.error_time {
  font-size: 0.75rem;
}
</style>
