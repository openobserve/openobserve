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
          <q-btn
            v-close-popup
            round
            flat
            icon="img:/src/assets/images/common/close_icon.svg"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-tabs v-model="tab" shrink align="left">
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
              style="height: calc(100vh - 290px)"
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
                :key="'field_' + value"
                class="list-item"
              >
                <q-item-section class="col-3">{{ value }}</q-item-section>
                <q-item-section class="col-9" style="display: inline;relative">
                  <q-btn-dropdown
                    size="0.5rem"
                    outlined
                    filled
                    dense
                    class="q-mr-sm pointer"
                    name="img:/src/assets/images/common/add_icon.svg"
                  >
                    <q-list>
                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            @click="
                              toggleIncludeSearchTerm(`${value}='${key}'`)
                            "
                            ><q-icon
                              title="Add to search query"
                              name="img:/src/assets/images/common/add_icon.svg"
                              size="1rem"
                              outlined
                              filled
                              dense
                              class="q-mr-sm pointer"
                            ></q-icon
                            >Inlcude Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>

                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            @click="
                              toggleExcludeSearchTerm(`${value}!='${key}'`)
                            "
                            ><q-icon
                              title="Add to search query"
                              name="img:/src/assets/images/common/add_icon.svg"
                              size="1rem"
                              outlined
                              filled
                              dense
                              class="q-mr-sm pointer"
                            ></q-icon
                            >Exclude Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-btn-dropdown>
                  {{ key }}
                </q-item-section>
              </q-item>
              <q-item></q-item>
            </q-list>
          </div>
        </q-card-section>
      </q-tab-panel>

      <q-tab-panel name="json" class="q-pa-none">
        <q-card-section class="q-pa-none q-mb-lg">
          <div class="indexDetailsContainer">
            <pre style="height: calc(100vh - 290px)">{{ rowData }}</pre>
          </div>
        </q-card-section>
      </q-tab-panel>
    </q-tab-panels>

    <q-separator />
    <q-card-section class="q-pa-md q-pb-md">
      <div class="row items-center no-wrap">
        <div class="col-2">
          <q-btn
            class="text-bold"
            text-color="light-text"
            no-caps
            :disabled="currentIndex <= 0"
            outline
            @click="$emit('showPrevDetail', false, true)"
            icon="navigate_before"
            label="Previous"
          />
        </div>
        <div class="col-8 row justify-center align-center q-gutter-sm">
          <div class="" style="width: 80px">
            <q-input
              v-model="selectedRelativeValue"
              type="number"
              dense
              filled
              min="0"
            ></q-input>
          </div>
          <div class="" style="minwidth: 100px">
            <q-select
              v-model="selectedRelativePeriod"
              :options="relativePeriods"
              dense
              filled
            ></q-select>
          </div>
          <div class="">
            <q-btn
              class="text-bold"
              text-color="light-text"
              no-caps
              :disabled="currentIndex >= totalLength - 1"
              outline
              label="Search Around"
              @click="
                searchTimeBoxed(
                  Number(selectedRelativeValue),
                  selectedRelativePeriod,
                  rowData
                )
              "
              padding="sm md"
            />
          </div>
        </div>
        <div class="col-2 items-end">
          <q-btn
            class="text-bold"
            text-color="light-text"
            no-caps
            :disabled="currentIndex >= totalLength - 1"
            outline
            @click="$emit('showNextDetail', true, false)"
            icon-right="navigate_next"
            label="Next"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { date } from "quasar";

const defaultValue: any = () => {
  return {
    data: {},
  };
};

export default defineComponent({
  name: "SearchDetail",
  emits: [
    "showPrevDetail",
    "showNextDetail",
    "add:searchterm",
    "remove:searchterm",
    "search:timeboxed",
  ],
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    currentIndex: {
      type: Number,
      required: true,
    },
    totalLength: {
      type: Number,
      required: true,
    },
  },
  methods: {
    toggleIncludeSearchTerm(term: string) {
      // if (flag == false) {
      this.$emit("add:searchterm", term);
      // } else {
      //   this.$emit("remove:searchterm", term);
      // }
    },
    toggleExcludeSearchTerm(term: string) {
      // if (flag == false) {
      this.$emit("add:searchterm", term);
      // } else {
      //   this.$emit("remove:searchterm", term);
      // }
    },
    searchTimeBoxed(
      selectedRelativeValue: number,
      selectedRelativePeriod: string,
      rowData: any
    ) {
      let multiplier = 1;
      if (selectedRelativePeriod === "Minutes") {
        multiplier = 60;
      }
      let start_time: any =
        rowData["_timestamp"] - selectedRelativeValue * multiplier * 1000000;
      let end_time: any =
        rowData["_timestamp"] + selectedRelativeValue * multiplier * 1000000;

      start_time = date.formatDate(
        Math.floor(start_time / 1000),
        "YYYY/MM/DD HH:mm"
      );

      end_time = date.formatDate(
        Math.floor(end_time / 1000),
        "YYYY/MM/DD HH:mm"
      );

      this.$emit("search:timeboxed", { start: start_time, end: end_time });
    },
  },
  setup() {
    const { t } = useI18n();
    const rowData: any = ref({});
    const router = useRouter();
    const tab = ref("table");
    const selectedRelativeValue = ref("1");
    const selectedRelativePeriod = ref("Minutes");
    const relativePeriods: any = ref(["Minutes"]);

    const flattenJSONObject = (obj: any, param: string) => {
      let newObj: any = {};
      for (let key in obj) {
        if (typeof obj[key] === "object") {
          // let childJSON = JSON.stringify(obj[key]);
          // let unflatten = flattenJSONObject(obj[key], key + ".");
          newObj = {
            ...newObj,
            ...flattenJSONObject(obj[key], param + key + "."),
          };
        } else {
          newObj[param + key] = obj[key];
        }
      }
      return newObj;
    };

    return {
      t,
      router,
      rowData,
      tab,
      flattenJSONObject,
      selectedRelativeValue,
      selectedRelativePeriod,
      relativePeriods,
    };
  },
  async created() {
    const newObj = await this.flattenJSONObject(this.modelValue, "");
    this.rowData = newObj;
  },
});
</script>

<style scoped>
.searchdetaildialog {
  width: 60vw;
}

.q-item__section {
  word-break: break-all;
}

.indexDetailsContainer .q-list .q-item {
  height: auto;
}

.q-icon {
  cursor: pointer;
}
</style>
