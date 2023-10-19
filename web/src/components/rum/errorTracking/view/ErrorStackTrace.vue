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
  <div class="row q-mt-lg q-ml-xs">
    <div class="col-12">
      <div class="tags-title text-grey-8 text-bold q-mb-xs">Error Stack</div>
      <div class="q-mb-sm">{{ error_stack[0] }}</div>
      <div class="error-stacks">
        <template v-for="(stack, index) in error_stack" :key="stack">
          <div
            v-if="index"
            class="error_stack q-px-sm"
            :style="{
              'border-top': Number(index) === 1 ? '1px solid #e0e0e0' : '',
              'border-radius':
                Number(index) === error_stack.length - 1
                  ? '0 0 4px 4px'
                  : Number(index) === 1
                  ? '4px 4px 0 0'
                  : '',
            }"
          >
            {{ stack }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  error_stack: {
    type: Array,
    required: true,
  },
  error: {
    type: Object,
    required: true,
  },
});
</script>

<style lang="scss">
.tags-title {
  font-size: 16px;
}

.error_stack {
  border-bottom: 1px solid #e0e0e0;
  border-left: 1px solid #e0e0e0;
  border-right: 1px solid #e0e0e0;
  font-size: 13px;
  padding: 6px 8px;
}

.error_stacks:first-child .error_stack {
  border-top: 1px solid #e0e0e0;
}
</style>
