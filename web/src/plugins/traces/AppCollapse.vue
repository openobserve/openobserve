<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
    <div class="flex items-start">
      <div :style="headerStyle">
        <q-btn
          dense
          flat
          round
          size="sm"
          icon="chevron_right"
          @click="updateCollapse"
          :style="{ rotate: isOpen ? '90deg' : '0deg' }"
        />
      </div>
      <slot name="header" />
    </div>
    <div v-if="isOpen">
      <slot name="content"></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "AppCollapse",
  props: {
    open: {
      type: Object,
      default: () => null,
    },
    headerStyle: {
      type: Object,
      default: () => {},
    },
  },
  emits: ["update:collapse"],
  setup(props, { emit }) {
    const isOpen: any = ref(props.open);
    function formatTimeWithSuffix(ns: number) {
      if (ns < 10000) {
        return `${ns} ms`;
      } else {
        return `${(ns / 1000).toFixed(2)} s`;
      }
    }
    function updateCollapse() {
      isOpen.value = !isOpen.value;
    }
    return {
      formatTimeWithSuffix,
      isOpen,
      updateCollapse,
    };
  },
});
</script>

<style scoped></style>
