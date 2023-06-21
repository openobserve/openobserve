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
          <div
            class="text-body1 text-bold "
            data-test="log-detail-title-text"
          >
            {{ t("search.rowDetail") }}
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup
            round
            flat
            icon="cancel"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <div class="row justify-between">
      <div class="col-10">
        <q-tabs v-model="tab" shrink align="left">
          <q-tab data-test="log-detail-table-tab" name="table" label="Table" />
          <q-tab data-test="log-detail-json-tab" name="json" label="JSON" />
        </q-tabs>
      </div>
      <div
        v-show="tab === 'table'"
        class="col-2 flex justify-end align-center q-pr-md"
      >
        <q-toggle
          data-test="log-detail-wrap-values-toggle-btn"
          v-model="shouldWrapValues"
          label="Wrap"
          color="primary"
          size="xs"
          @update:model-value="toggleWrapLogDetails"
        />
      </div>
    </div>

    <q-separator />

    <q-tab-panels data-test="log-detail-tab-container" v-model="tab" animated>
      <q-tab-panel name="table">
        <q-card-section
          class="q-pa-none q-mb-lg"
          data-test="log-detail-table-content"
        >
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
              style="height: calc(100vh - 290)"
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
                <q-item-section
                  :data-test="`log-detail-${value}-key`"
                  class="col-3"
                  >{{ value }}</q-item-section
                >
                <q-item-section
                  class="col-9"
                  :class="!shouldWrapValues ? 'ellipsis' : ''"
                  style="display: inline;relative"
                >
                  <q-btn-dropdown
                    data-test="log-details-include-exclude-field-btn"
                    size="0.5rem"
                    outlined
                    filled
                    dense
                    class="q-mr-sm pointer"
                    :name="'img:' + getImageURL('images/common/add_icon.svg')"
                  >
                    <q-list>
                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-include-field-btn"
                            @click="
                              toggleIncludeSearchTerm(`${value}='${key}'`)
                            "
                            ><q-btn
                              title="Add to search query"
                              :icon="
                                'img:' + getImageURL('images/common/equals.svg')
                              "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            ></q-btn
                            >Include Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>

                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-exclude-field-btn"
                            @click="
                              toggleExcludeSearchTerm(`${value}!='${key}'`)
                            "
                            ><q-btn
                              title="Add to search query"
                              :icon="
                                'img:' +
                                getImageURL('images/common/not_equals.svg')
                              "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            ></q-btn
                            >Exclude Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-btn-dropdown>

                  <pre
                    :data-test="`log-detail-${value}-value`"
                    class="table-pre"
                    :style="{
                      'white-space': !shouldWrapValues ? 'nowrap' : 'pre-wrap',
                    }"
                    >{{ key }}</pre
                  >
                </q-item-section>
              </q-item>
              <q-item></q-item>
            </q-list>
          </div>
        </q-card-section>
      </q-tab-panel>
      <q-tab-panel name="json" class="q-pa-none">
        <q-card-section
          data-test="log-detail-json-content"
          class="q-pa-none q-mb-lg"
        >
          <div class="indexDetailsContainer">
            <pre class="json-pre">{{ rowData }}</pre>
          </div>
        </q-card-section>
      </q-tab-panel>
    </q-tab-panels>

    <q-separator />
    <q-card-section class="q-pa-md q-pb-md">
      <div class="row items-center no-wrap justify-between">
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
        <div
          v-show="streamType !== 'enrichment_tables'"
          class="col-8 row justify-center align-center q-gutter-sm"
        >
          <div style="line-height: 40px; font-weight: bold">No of Records:</div>
          <div class="" style="minwidth: 150px">
            <q-select
              v-model="selectedRelativeValue"
              :options="recordSizeOptions"
              dense
              filled
            ></q-select>
          </div>
          <div class="">
            <q-btn
              data-test="logs-detail-table-search-around-btn"
              class="text-bold"
              text-color="light-text"
              no-caps
              :disabled="currentIndex >= totalLength - 1"
              outline
              label="Search Around"
              @click="searchTimeBoxed(rowData, Number(selectedRelativeValue))"
              padding="sm md"
            />
          </div>
        </div>
        <div class="col-2 items-end">
          <q-btn
            data-test="log-detail-next-detail-btn"
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
import {
  defineComponent,
  ref,
  onBeforeMount,
  onBeforeUnmount,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import dashboards from "@/services/dashboards";
import useLogs from "@/composables/useLogs";

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
    streamType: {
      type: String,
      default: "logs",
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
    searchTimeBoxed(rowData: any, size: number) {
      this.$emit("search:timeboxed", {
        key: rowData[this.store.state.zoConfig.timestamp_column],
        size: size,
      });
    },
  },
  setup(props) {
    const { t } = useI18n();
    const rowData: any = ref({});
    const router = useRouter();
    const store = useStore();
    const tab = ref("table");
    const selectedRelativeValue = ref("10");
    const recordSizeOptions: any = ref([10, 20, 50, 100, 200, 500, 1000]);
    const shouldWrapValues: any = ref(false);
    const searchObj = useLogs();

    onBeforeMount(() => {
      if (window.localStorage.getItem("wrap-log-details") === null) {
        window.localStorage.setItem("wrap-log-details", "false");
      }
      shouldWrapValues.value =
        window.localStorage.getItem("wrap-log-details") === "true";
    });

    const toggleWrapLogDetails = () => {
      window.localStorage.setItem(
        "wrap-log-details",
        shouldWrapValues.value ? "true" : "false"
      );
    };

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
      store,
      router,
      rowData,
      tab,
      flattenJSONObject,
      selectedRelativeValue,
      recordSizeOptions,
      getImageURL,
      shouldWrapValues,
      toggleWrapLogDetails,
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

.table-pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  display: inline;
  font-weight: normal;
  font-family: Nunito Sans, sans-serif;
}

.json-pre {
  height: calc(100vh - 290px);
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
