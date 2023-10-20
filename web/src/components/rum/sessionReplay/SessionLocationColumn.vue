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
      <div class="row items-center no-wrap">
        <div style="font-size: 12px">{{ column.country }}</div>
      </div>
      <div class="row q-mt-xs items-center">
        <div class="text-grey-8">
          {{ column.city }}
        </div>
        <q-icon name="circle" size="4px" class="q-mx-md text-grey-6" />
        <div class="text-grey-8">{{ column.browser }}</div>
        <q-icon name="circle" size="4px" class="q-mx-md text-grey-6" />
        <div class="text-grey-8">{{ column.os }}</div>
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { defineProps } from "vue";
defineProps({
  column: {
    type: Object,
    required: true,
  },
});
</script>
<style lang="scss">
.error_type {
  font-size: 16px;
  color: $info;
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
</style>
