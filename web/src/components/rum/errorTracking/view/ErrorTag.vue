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
  <div class="tag-block row items-center wrap q-mr-sm q-mt-sm">
    <div class="q-px-md">{{ tag.key }}</div>
    <q-separator vertical />
    <div class="q-px-md tag-bg">{{ tag.value }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  tag: {
    type: Object,
    required: true,
  },
});
</script>

<style lang="scss" scoped>
.tag-block {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.tag-bg {
  background-color: #e7e8f0b2;
  color: #5960b2;
}
</style>
