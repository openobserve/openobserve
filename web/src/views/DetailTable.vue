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
  <q-card class="column full-height no-wrap searchdetaildialog">
    <q-card-section class="q-pa-md q-pb-md">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 text-bold text-dark">
            {{ t("search.rowDetail") }}
          </div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup round flat icon="cancel" />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-tabs
      v-model="tab"
      dense
      class="text-grey"
      active-color="primary"
      indicator-color="primary"
      align="justify"
      narrow-indicator
    >
      <q-tab name="table" label="Table" />
      <q-tab name="json" label="JSON" />
    </q-tabs>

    <q-separator />

    <q-tab-panels v-model="tab" animated>
      <q-tab-panel name="table">
        <q-card-section class="q-pa-none q-mb-lg">
          <div
            v-if="rowData.length == 0"
            class="q-pt-md"
            style="max-width: 350px"
          >
            No data available.
          </div>
          <div v-else class="indexDetailsContainer">
            <q-list
              separator
              style="height: calc(100vh - 220px); width: 70vw"
              class="q-px-none q-py-none"
            >
              <q-item class="list-head">
                <q-item-section class="text-bold col-3">
                  {{ t("search.sourceName") }}
                </q-item-section>
                <q-item-section class="text-bold col-9">
                  {{ t("search.sourceValue") }}
                </q-item-section>
              </q-item>

              <q-item
                v-for="(key, value) in rowData"
                :key="value"
                class="list-item"
              >
                <q-item-section class="col-3">{{ value }}</q-item-section>
                <q-item-section class="col-9">{{ key }}</q-item-section>
              </q-item>
              <q-item></q-item>
            </q-list>
          </div>
        </q-card-section>
      </q-tab-panel>

      <q-tab-panel name="json">
        <pre>
          {{ rowData }}
        </pre>
      </q-tab-panel>
    </q-tab-panels>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../utils/zincutils";

const defaultValue: any = () => {
  return {
    data: {},
  };
};

export default defineComponent({
  name: "SearchDetail",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  setup() {
    const { t } = useI18n();
    const rowData: any = ref({});

    return {
      t,
      rowData,
      tab: ref("table"),
      getImageURL,
    };
  },
  created() {
    this.rowData = this.modelValue;
  },
});
</script>

<style scoped>
.searchdetaildialog {
  width: 74vw;
}
.q-item__section {
  word-break: break-all;
}
.indexDetailsContainer .q-list .q-item {
  height: auto;
}
</style>
