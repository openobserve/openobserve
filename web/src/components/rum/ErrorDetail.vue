<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div style="width: 40vw" class="error_details">
    <div @click="handleErrorTypeClick" class="error_type cursor-pointer">
      {{ column.error_type || "Error" }}
    </div>
    <div
      class="error_message cursor-pointer ellipsis q-mt-xs"
      :title="column.error_message"
    >
      {{ column.error_message }}
    </div>
    <div class="error_time row items-center q-mt-xs">
      <span class="q-mr-md text-grey-8"> {{ column.service }}</span>
      <div
        class="q-mr-md"
        :class="
          column.error_handling === 'unhandled'
            ? 'unhandled_error text-red-6 q-px-xs'
            : 'handled_error text-grey-8'
        "
      >
        {{ column.error_handling }}
      </div>
      <q-icon name="schedule" size="14px" class="text-grey-8" />
      <span class="q-pl-xs text-grey-8">{{
        getFormattedDate(column.zo_sql_timestamp / 1000)
      }}</span>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { date } from "quasar";
import { defineProps } from "vue";
const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["event-emitted"]);

const getFormattedDate = (timestamp: number) =>
  date.formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss.SSS Z");

const handleErrorTypeClick = () => {
  emit("event-emitted", {
    type: "error_type_click",
    data: {
      error_type: props,
    },
  });
};
</script>

<style lang="scss" scoped>
.error_type {
  font-size: 16px;
  color: $info;
  text-transform: capitalize;
}

.error_description {
  font-size: 14px;
}

.error_message {
  font-size: 14px;
}

.error_time {
  font-size: 12px;
}

.unhandled_error {
  border: 1px solid rgb(246, 68, 68);
  border-radius: 4px;
}
</style>
