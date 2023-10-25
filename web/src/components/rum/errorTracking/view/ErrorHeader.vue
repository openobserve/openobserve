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
  <div>
    <div>
      <div class="row items-center no-wrap q-my-xs">
        <div class="error_type text-bold ">{{ error.type }}</div>
      </div>
      <div class="error_message q-pt-xs row items-center">
        <div
          v-if="error.error_handling === 'unhandled'"
          :class="
            error.error_handling === 'unhandled'
              ? 'unhandled_error text-red-6 q-px-xs q-mr-sm'
              : ''
          "
        >
          {{ error.error_handling }}
        </div>
        {{ error.error_message }}
      </div>
      <div class="q-pt-sm q-pb-xs">
        <span class="text-bold">Event ID:</span>
        <span :title="eventId" class="q-pl-xs cursor-pointer"
          >{{ error.error_id }} <q-icon size="12px" name="content_copy"
        /></span>
        <span class="q-ml-lg">{{ error.timestamp }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineProps } from "vue";

const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const eventId = "c595b5645b3d45e3b0946c50609f0c82";
const getEventId = computed(() =>
  "c595b5645b3d45e3b0946c50609f0c82".slice(0, 8)
);
</script>

<style lang="scss">
.error_type {
  font-size: 22px;
}

.error_description {
  font-size: 18px;
}

.error_message {
  font-size: 16px;
}
.error_symbol {
  width: 12px;
  height: 12px;
  background-color: rgb(251, 119, 119);
  border-radius: 50%;
}
.error_time {
  font-size: 16px;
}

.unhandled_error {
  border: 1px solid rgb(246, 68, 68);
  border-radius: 4px;
  font-size: 14px;
}
</style>
