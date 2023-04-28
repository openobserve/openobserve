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
  <div
    class="flex justify-start items-center q-px-sm bg-grey-11"
    :style="{ height: '30px' }"
  >
    <div :style="{ width: 'calc(100% - 22px)' }" class="q-pb-none ellipsis">
      Span Details
    </div>
    <q-btn
      dense
      icon="close"
      class="align-right no-border q-pa-xs"
      size="xs"
      @click="closeSidebar"
    ></q-btn>
  </div>
  <div class="q-pb-sm">
    <div
      :title="span.operation_name"
      class="q-px-sm q-pb-none text-h6 ellipsis non-selectable"
    >
      {{ span.operation_name }}
    </div>
    <div
      class="q-px-sm text-caption ellipsis non-selectable"
      :title="span.service_name"
    >
      {{ span.service_name }}
    </div>
  </div>
  <q-tabs
    v-model="activeTab"
    dense
    inline-label
    class="text-bold q-mx-sm span_details_tabs"
  >
    <q-tab name="tags" label="Attributes" style="text-transform: capitalize" />
  </q-tabs>
  <q-separator style="width: 100%" />
  <q-tab-panels v-model="activeTab" class="span_details_tab-panels">
    <q-tab-panel name="tags">
      <div v-for="key in Object.keys(span)" :key="key">
        <div class="row q-py-sm q-px-sm border-bottom">
          <div class="col-12 text-subtitle2 text-grey-8">{{ key }}</div>
          <div class="col-12 text-subtitle2">{{ span[key] }}</div>
        </div>
      </div>
    </q-tab-panel>
  </q-tab-panels>
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

<style scoped lang="scss">
.span_details_tab-panels {
  height: calc(100% - 130px);
  overflow-y: scroll;
  overflow-x: hidden;
}
</style>

<style lang="scss">
.span_details_tabs {
  .span_details_tab-panels {
    .q-tab-panel {
      padding: 8px;
    }
  }
  .q-tab__indicator {
    display: none;
  }
}
</style>
