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
  <div class="column index-menu">
    <q-select
      data-test="log-search-index-list-select-stream"
      v-model="searchMetricValue"
      :label="searchMetricValue ? '' : t('search.selectIndex')"
      :options="streamOptions"
      data-cy="index-dropdown"
      input-debounce="0"
      behavior="menu"
      filled
      borderless
      emit-value
      dense
      use-input
      hide-selected
      fill-input
      @filter="filterMetrics"
    >
      <template #no-option>
        <q-item>
          <q-item-section> {{ t("search.noResult") }}</q-item-section>
        </q-item>
      </template>
    </q-select>
    <div class="metric-list">
      <div class="metrics-label-table q-mt-xs">
        <q-table
          data-test="log-search-index-list-fields-table"
          :visible-columns="['name']"
          :rows="filteredMetricLabels"
          :row-key="(row) => row.name"
          :filter="searchMetricLabel"
          :filter-method="filterMetricLabels"
          :pagination="{ rowsPerPage: 10000 }"
          hide-header
          hide-bottom
          class="field-table"
          id="fieldList"
        >
          <template #body-cell-name="props">
            <q-tr :props="props">
              <q-td :props="props" class="field_list">
                <!-- TODO OK : Repeated code make seperate component to display field  -->
                <q-expansion-item
                  dense
                  switch-toggle-side
                  :label="props.row.name"
                  expand-icon-class="field-expansion-icon"
                  :expand-icon="
                    'img:' + getImageURL('images/common/down-solid.svg')
                  "
                  :expanded-icon="
                    'img:' + getImageURL('images/common/up-solid.svg')
                  "
                  @before-show="(event: any) => openFilterCreator(event, props.row)"
                >
                  <template v-slot:header>
                    <div
                      class="flex content-center ellipsis"
                      :title="props.row.name"
                    >
                      <div class="field_label ellipsis">
                        {{ props.row.name }}
                      </div>
                    </div>
                  </template>
                  <q-card>
                    <q-card-section class="q-pl-md q-pr-xs q-py-xs">
                      <div class="filter-values-container">
                        <div
                          v-show="metricLabelValues[props.row.name]?.isLoading"
                          class="q-pl-md q-py-xs"
                          style="height: 60px"
                        >
                          <q-inner-loading
                            size="xs"
                            :showing="
                              metricLabelValues[props.row.name]?.isLoading
                            "
                            label="Fetching values..."
                            label-style="font-size: 1.1em"
                          />
                        </div>
                        <div
                          v-show="
                            !metricLabelValues[props.row.name]?.values
                              ?.length &&
                            !metricLabelValues[props.row.name]?.isLoading
                          "
                          class="q-pl-md q-py-xs text-subtitle2"
                        >
                          No values found
                        </div>
                        <div
                          v-for="value in metricLabelValues[props.row.name]
                            ?.values || []"
                          :key="value"
                        >
                          <q-list dense>
                            <q-item tag="label" class="q-pr-none">
                              <div
                                class="flex row wrap justify-between"
                                style="width: 100%"
                              >
                                <div
                                  :title="value"
                                  class="ellipsis q-pr-xs"
                                  style="width: 100%"
                                >
                                  {{ value }}
                                </div>
                              </div>
                            </q-item>
                          </q-list>
                        </div>
                      </div>
                    </q-card-section>
                  </q-card>
                </q-expansion-item>
              </q-td>
            </q-tr>
          </template>
          <template #top-right>
            <q-input
              data-test="log-search-index-list-field-search-input"
              v-model="searchMetricLabel"
              data-cy="index-field-search-input"
              filled
              borderless
              dense
              clearable
              debounce="1"
              :placeholder="t('search.searchField')"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>
            </q-input>
          </template>
        </q-table>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useMetrics from "../../composables/useMetrics";
import { formatLargeNumber, getImageURL } from "../../utils/zincutils";
import { getConsumableDateTime } from "@/utils/commons";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import stream from "@/services/stream";

export default defineComponent({
  name: "MetricsList",
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { searchObj } = useMetrics();
    const streamOptions: any = ref(searchObj.data.metrics.metricList);
    const selectedMetricLabels = ref([]);
    const searchMetricLabel = ref("");
    const filteredMetricLabels = ref([]);
    const metricLabelValues: Ref<{
      [key: string]: { isLoading: boolean; values: [] };
    }> = ref({});
    const { dashboardPanelData } = useDashboardPanelData();

    watch(
      () => searchObj.data.metrics.metricList.length,
      () => {
        streamOptions.value = searchObj.data.metrics.metricList;
      }
    );

    const searchMetricValue: Ref<string> = ref(
      searchObj.data.metrics.selectedMetrics[0]
    );

    const filterMetrics = (val, update) => {
      update(() => {
        streamOptions.value = searchObj.data.metrics.metricList;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1
        );
      });
    };

    watch(
      () => searchMetricValue.value,
      () => {
        updateMetricLabels();
      }
    );

    const updateMetricLabels = () => {
      selectedMetricLabels.value = searchObj.data.streamResults.list.find(
        (stream: any) => stream.name === searchMetricValue.value
      ).schema;
      filteredMetricLabels.value = [...selectedMetricLabels.value];
    };

    const filterMetricLabels = (rows: any, terms: any) => {
      var filtered = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    const updateSelectedMetrics = (metric: any) => {
      searchObj.data.metrics.selectedMetrics = [];
      searchObj.data.metrics.selectedMetrics.push(metric);
    };

    const openFilterCreator = (event: any, { name }: any) => {
      console.log("open filter creator", name);

      let timestamps = getConsumableDateTime(searchObj.data.datetime);

      const startISOTimestamp: any =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      const endISOTimestamp: any =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;

      metricLabelValues.value[name] = {
        isLoading: true,
        values: [],
      };
      try {
        stream
          .fieldValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: searchMetricValue.value,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            fields: [name],
            type: "metrics",
            size: 10,
          })
          .then((res: any) => {
            metricLabelValues.value[name]["values"] = res.data?.data || [];
          });
        stream
          .labelValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: searchMetricValue.value,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            label: name,
          })
          .then((res: any) => {
            metricLabelValues.value[name]["values"] = res.data?.data || [];
          })
          .finally(() => {
            metricLabelValues.value[name]["isLoading"] = false;
          });
      } catch (err) {
        $q.notify({
          type: "negative",
          message: "Error while fetching field values",
        });
      }
    };

    return {
      $q,
      t,
      store,
      router,
      searchObj,
      streamOptions,
      getImageURL,
      filterMetrics,
      updateSelectedMetrics,
      searchMetricValue,
      filteredMetricLabels,
      searchMetricLabel,
      filterMetricLabels,
      openFilterCreator,
      metricLabelValues,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}
.index-menu {
  width: 100%;

  .metric-list {
    height: calc(100vh - 98px);
    width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    .metric-container {
      width: 100%;

      &:hover {
        background-color: #e6e6e6;
      }

      &.selected {
        background-color: rgba(89, 96, 178, 0.3);
      }
    }
  }
}

.q-item {
  color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}
.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}
.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>

<style lang="scss" scoped>
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}

.index-menu {
  width: 100%;

  .q-field {
    &__control {
      height: 35px;
      padding: 0px 5px;
      min-height: auto !important;

      &-container {
        padding-top: 0px !important;
      }
    }

    &__native :first-of-type {
      padding-top: 0.25rem;
    }
  }

  .metrics-label-table {
    width: 100%;
    // border: 1px solid rgba(0, 0, 0, 0.02);

    .q-table {
      display: table;
      table-layout: fixed !important;
    }

    tr {
      margin-bottom: 1px;
    }

    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: fit-content;
      overflow: hidden;
    }

    .q-table__control,
    label.q-field {
      width: 100%;
    }

    .q-table thead tr,
    .q-table tbody td {
      height: auto;
    }

    .q-table__top {
      border-bottom: unset;
    }
  }

  .field-table {
    width: 100%;
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    .field_label {
      pointer-events: none;
      font-size: 0.825rem;
      position: relative;
      display: inline;
      z-index: 2;
      left: 0;
      // text-transform: capitalize;
    }

    .field-container {
      height: 25px;
    }

    .field_overlay {
      position: absolute;
      height: 100%;
      right: 0;
      top: 0;
      z-index: 5;
      background-color: #e8e8e8;
      padding: 0 6px;
      visibility: hidden;
      display: flex;
      align-items: center;

      .q-icon {
        cursor: pointer;
        opacity: 0;
        margin: 0 1px;
      }
    }

    &.selected {
      .field_overlay {
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
      }
    }

    &:hover {
      .field-container {
        background-color: #e8e8e8;
      }
    }
  }
}

.q-item {
  color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}

.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}

.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}

.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>

<style lang="scss">
.metrics-label-table {
  .q-table {
    width: 100%;
    table-layout: fixed;

    .q-expansion-item {
      .q-item {
        display: flex;
        align-items: center;
        padding: 0;
        height: 25px !important;
        min-height: 25px !important;
      }

      .q-item__section--avatar {
        min-width: 12px;
        max-width: 12px;
        margin-right: 8px;
      }

      .filter-values-container {
        .q-item {
          padding-left: 4px;

          .q-focus-helper {
            background: none !important;
          }
        }
      }

      .q-item-type {
        &:hover {
          .field_overlay {
            visibility: visible;

            .q-icon {
              opacity: 1;
            }
          }
        }
      }

      .field-expansion-icon {
        img {
          width: 12px;
          height: 12px;
        }
      }
    }

    .field-container {
      &:hover {
        .field_overlay {
          visibility: visible;

          .q-icon {
            opacity: 1;
          }
        }
      }
    }

    .field_list {
      &.selected {
        .q-expansion-item {
          background-color: rgba(89, 96, 178, 0.3);
        }

        .field_overlay {
          background-color: #ffffff;
        }
      }
    }
  }
}
</style>
