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
  <div class="error_details w-[40vw]">
    <div
      data-test="error-detail-error-type"
      @click="handleErrorTypeClick"
      class="text-base text-[var(--o2-info)] capitalize cursor-pointer"
    >
      {{ column.error_type || "Error" }}
    </div>
    <div
      class="text-sm cursor-pointer truncate mt-1"
      :title="column.error_message"
    >
      {{ column.error_message }}
    </div>
    <div class="text-xs flex items-center mt-1">
      <span class="mr-3 text-gray-500"> {{ column.service }}</span>
      <div
        class="mr-3"
        :class="
          column.error_handling === 'unhandled'
            ? 'text-red-6 px-1 border border-[rgb(246,68,68)] rounded'
            : 'text-gray-500'
        "
      >
        {{ column.error_handling }}
      </div>
      <OIcon name="schedule" size="sm" class="text-gray-500" />
      <span class="pl-1 text-gray-500">{{
        getFormattedDate(column.zo_sql_timestamp / 1000)
      }}</span>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { formatDate } from "@/utils/date";
import { defineProps } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["event-emitted"]);

const getFormattedDate = (timestamp: number) =>
  formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss.SSS Z");

const handleErrorTypeClick = () => {
  emit("event-emitted", {
    type: "error_type_click",
    data: {
      error_type: props,
    },
  });
};
</script>
