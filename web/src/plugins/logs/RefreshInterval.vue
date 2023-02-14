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
  <div class="col">
    <q-item
      v-for="(item, index) in data"
      :key="'interval_' + index"
      v-close-popup
      dense
      clickable
      @click="refreshTimeChange(item)"
    >
      <q-item-section>
        <q-item-label>{{ item.label }}</q-item-label>
      </q-item-section>
    </q-item>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ComponentRefreshInterval",
  props: {
    data: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["on_change"],
  setup(props, { emit }) {
    const refreshTimeChange = (item: any) => {
      emit("on_change", item);
    };

    return {
      refreshTimeChange,
    };
  },
});
</script>

<style lang="scss">
.q-item {
  &:hover {
    background-color: #e3e4fa;
  }
  border-radius: 5px;
  text-align: left;
  margin: 5px;
}
</style>
