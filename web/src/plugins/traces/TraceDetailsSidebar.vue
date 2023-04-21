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
  <div class="flex justify-end">
    <q-btn
      dense
      icon="close"
      class="align-right no-border"
      size="sm"
      @click="closeSidebar"
    ></q-btn>
  </div>
  <div class="q-pb-sm">
    <div class="q-px-md q-pb-none text-h6">{{ span.operation_name }}</div>
    <div class="q-px-md text-body2">{{ span.service_name }}</div>
  </div>
  <div>
    <q-tabs v-model="activeTab" dense inline-label class="text-bold q-mx-md">
      <q-tab name="tags" label="Tags" />
      <q-tab name="details" label="Details" />
    </q-tabs>
    <q-seperator />
    <q-tab-panels v-model="activeTab">
      <q-tab-panel name="tags">
        <div v-for="key in Object.keys(span)" :key="key">
          <div class="row q-py-sm q-px-sm border-bottom">
            <div class="col-12 text-subtitle2 text-grey-8">{{ key }}</div>
            <div class="col-12 text-subtitle2">{{ span[key] }}</div>
          </div>
        </div>
      </q-tab-panel>
      <q-tab-panel name="details">
        <div>Details</div>
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "TraceDetailsSidebar",
  props: {
    span: {
      type: Object,
      default: () => null,
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const activeTab = ref("tags");
    const closeSidebar = () => {
      emit("close");
    };
    return {
      activeTab,
      closeSidebar,
    };
  },
});
</script>

<style scoped></style>
