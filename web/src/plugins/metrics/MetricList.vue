<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="tw:flex tw:flex-col index-menu"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <OSelect
      data-test="log-search-index-list-select-stream"
      v-model="selectedMetric"
      :label="selectedMetric ? '' : t('search.selectIndex')"
      :options="streamOptions"
      data-cy="index-dropdown"
      class="metric-select-input"
      @update:model-value="onMetricChange"
    >
      <template v-if="selectedMetric?.type" #icon-left>
        <OIcon
          :title="selectedMetric?.type"
          size="xs"
          :name="metricsIconMapping[selectedMetric?.type || '']"
        />
      </template>
      <template #empty>
        <li class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2">
          <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">{{ t("search.noResult") }}</div>
        </li>
      </template>
    </OSelect>
    <div class="metric-list">
      <div
        class="metrics-label-table tw:mt-1"
        data-test="log-search-index-list-fields-table"
      >
        <OTable
          :data="visibleMetricLabels"
          :columns="metricColumns"
          row-key="name"
          pagination="none"
          :show-global-filter="false"
          class="field-table"
        >
          <template #cell-name="{ row }">
            <div class="field_list">
              <!-- TODO OK : Repeated code make separate component to display field  -->
              <template
                v-if="
                  row.name === store.state.zoConfig.timestamp_column
                "
              >
                <OFieldLabel :field="row" class="tw:pl-4" />
              </template>
              <template v-else>
                <OCollapsible
                  variant="sidebar"
                  class="metric-expansion-item"
                  :model-value="openMetricRows[row.name] === true"
                  @update:model-value="(v) => { openMetricRows[row.name] = v; if (v) openFilterCreator(null, row); }"
                >
                  <template #trigger>
                    <div class="tw:flex tw:items-center tw:min-w-0">
                      <OFieldLabel :field="row" class="tw:flex-1 tw:min-w-0" />
                      <div class="field_overlay">
                        <OButton
                          icon-left="add"
                          :data-test="`metrics-list-add-${row.name}-label-btn`"
                          variant="ghost"
                          size="icon-xs"
                          class="tw:mr-0"
                          @click.stop="addValueToEditor(row.name, '', '=')"
                        />
                      </div>
                    </div>
                  </template>
                  <div class="tw:pl-3 tw:pr-1 tw:py-1">
                      <div class="filter-values-container">
                        <div
                          v-show="
                            metricLabelValues[row.name]?.isLoading
                          "
                          class="tw:pl-3 tw:py-1"
                          style="height: 60px"
                        >
                          <OInnerLoading
                            :showing="
                              metricLabelValues[row.name]?.isLoading
                            "
                            label="Fetching values..."
                            size="xs"
                          />
                        </div>
                        <div
                          v-show="
                            !metricLabelValues[row.name]?.values
                              ?.length &&
                            !metricLabelValues[row.name]?.isLoading
                          "
                          class="tw:pl-3 tw:py-1 tw:text-sm tw:font-medium"
                        >
                          No values found
                        </div>
                        <div
                          v-for="value in metricLabelValues[row.name]
                            ?.values || []"
                          :key="value.key + value.count"
                        >
                          <ul>
                            <label class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:bg-muted/50 tw:pr-0">
                              <div
                                class="tw:flex tw:flex wrap tw:justify-between"
                                style="width: calc(100% - 46px)"
                                :class="
                                  store.state.theme === 'dark'
                                    ? 'tw:text-gray-300'
                                    : 'tw:text-gray-500'
                                "
                              >
                                <div
                                  :title="value.key"
                                  class="tw:truncate tw:pr-1"
                                  style="width: calc(100% - 50px)"
                                >
                                  {{ value.key }}
                                </div>
                                <div
                                  :title="value.count?.toString()"
                                  class="tw:truncate tw:text-right tw:pr-2"
                                  style="width: 50px"
                                >
                                  {{ value.count }}
                                </div>
                              </div>
                              <div
                                class="tw:flex tw:flex"
                                :class="
                                  store.state.theme === 'dark'
                                    ? 'text-white'
                                    : 'text-black'
                                "
                              >
                                <OButton
                                  class="tw:mr-1"
                                  size="icon-xs"
                                  variant="ghost"
                                  title="Include Term"
                                  @click="
                                    addValueToEditor(
                                      row.name,
                                      value.key,
                                      '=',
                                    )
                                  "
                                >
                                  <EqualIcon class="tw:size-3" />
                                </OButton>
                                <OButton
                                  class="tw:mr-1"
                                  size="icon-xs"
                                  variant="ghost"
                                  title="Exclude Term"
                                  @click="
                                    addValueToEditor(
                                      row.name,
                                      value.key,
                                      '!=',
                                    )
                                  "
                                >
                                  <NotEqualIcon class="tw:size-3" />
                                </OButton>
                              </div>
                            </label>
                          </ul>
                        </div>
                      </div>
                  </div>
                </OCollapsible>
              </template>
            </div>
          </template>
          <template #top>
            <OSearchInput
              data-test="log-search-index-list-field-search-input"
              v-model="searchMetricLabel"
              data-cy="index-field-search-input"
              clearable
              :debounce="1"
              :placeholder="t('search.searchField')"
            />
          </template>
        </OTable>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  type Ref,
  watch,
  onMounted,
  computed,
  nextTick,
  reactive,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useMetrics from "../../composables/useMetrics";
import { formatLargeNumber, getImageURL } from "../../utils/zincutils";
import stream from "@/services/stream";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import metricService from "@/services/metrics";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "MetricsList",
  emits: ["update:change-metric", "select-label", "update:modelValue"],
  components: { EqualIcon, NotEqualIcon, OButton, OSearchInput, OInnerLoading,
    OIcon, OTable, OCollapsible, OFieldLabel,
},
  props: ["modelValue", "metricsList"],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const { searchObj } = useMetrics();
    const streamOptions: any = ref(props.metricsList || []);
    const selectedMetricLabels = ref([]);
    const searchMetricLabel = ref("");
    const filteredMetricLabels = ref([]);
    const metricLabelValues: Ref<{
      [key: string]: {
        isLoading: boolean;
        values: {
          key: string;
          count: number | string;
        }[];
      };
    }> = ref({});
    const metricsIconMapping: any = {
      summary: "description",
      gauge: "speed",
      histogram: "bar-chart",
      counter: "tag",
    };
    const { parsePromQlQuery } = usePromqlSuggestions();
    const { getStream } = useStreams();

    const selectedMetric = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        emit("update:modelValue", value);
      },
    });
    watch(
      () => props.metricsList,
      () => {
        streamOptions.value = props.metricsList;
      },
      { deep: true },
    );
    onMounted(() => {
      if (!streamOptions.value.length) streamOptions.value = props.metricsList;
    });
    const filterMetrics = (val: string, update: any) => {
      update(() => {
        streamOptions.value = props.metricsList;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };
    const updateMetricLabels = async () => {
      const streamData = await getStream(
        selectedMetric.value?.value || "",
        "metrics",
        true,
      );

      selectedMetricLabels.value = streamData.schema;

      if (Array.isArray(selectedMetricLabels.value))
        filteredMetricLabels.value = [...selectedMetricLabels.value];
    };
    watch(
      () => selectedMetric.value,
      (metric) => {
        if (metric?.value) updateMetricLabels();
      },
      { immediate: true, deep: true },
    );
    const metricColumns = [{ id: "name", header: "", accessorKey: "name" }];

    const visibleMetricLabels = computed(() => {
      if (!searchMetricLabel.value) return filteredMetricLabels.value;
      return filterMetricLabels(filteredMetricLabels.value, searchMetricLabel.value);
    });

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

    const getMetricsFieldValues = (name: string) => {
      const startISOTimestamp: any = searchObj.data.datetime.startTime;
      const endISOTimestamp: any = searchObj.data.datetime.endTime;
      metricLabelValues.value[name] = {
        isLoading: true,
        values: [],
      };
      try {
        stream
          .fieldValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: selectedMetric.value?.value,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            fields: [name],
            type: "metrics",
            size: store.state.zoConfig?.query_values_default_num || 10,
          })
          .then((res: any) => {
            if (res.data.hits.length) {
              metricLabelValues.value[name]["values"] = res.data.hits
                .find((field: any) => field.field === name)
                .values.map((value: any) => {
                  return {
                    key: value.zo_sql_key ? value.zo_sql_key : "null",
                    count: formatLargeNumber(value.zo_sql_num),
                  };
                });
            }
          })
          .catch(() => {
            toast({
              variant: "error",
              message: "Error while fetching field values",
            });
          })
          .finally(() => {
            metricLabelValues.value[name]["isLoading"] = false;
          });
      } catch (err) {
        toast({
          variant: "error",
          message: "Error while fetching field values",
        });
      }
    };

    const getFilteredMetricValues = (name: string) => {
      const parsedQuery: any = parsePromQlQuery(searchObj.data.query);
      const metricName = parsedQuery?.metricName || "";
      const labels = parsedQuery?.label?.labels || {};
      if (metricName) labels["__name__"] = metricName;

      const formattedLabels = Object.keys(labels).map((key) => {
        return `${key}="${labels[key]}"`;
      });

      searchService
        .get_promql_series({
          org_identifier: store.state.selectedOrganization.identifier,
          start_time: Number(searchObj.data.datetime.startTime),
          end_time: Number(searchObj.data.datetime.endTime),
          labels: `{${formattedLabels.join(",")}}`,
        })
        .then((res) => {
          if (res.data.data.length) {
            const valuesSet = new Map();
            res.data.data.forEach((label: any) => {
              if (!label[name]) return;
              if (valuesSet.has(label[name])) {
                valuesSet.set(label[name], valuesSet.get(label[name]) + 1);
              } else {
                valuesSet.set(label[name], 1);
              }
            });
            metricLabelValues.value[name]["values"] = [];
            valuesSet.forEach((value, key) => {
              metricLabelValues.value[name]["values"].push({
                key: key ? key : "null",
                count: value,
              });
            });
          }
        })
        .catch((err) => console.log(err))
        .finally(() => {
          metricLabelValues.value[name].isLoading = false;
        });
    };

    const openMetricRows = reactive<Record<string, boolean>>({});
    const openFilterCreator = (event: any, { name }: any) => {
      metricLabelValues.value[name] = {
        isLoading: true,
        values: [],
      };
      metricService
        .formatPromqlQuery({
          org_identifier: store.state.selectedOrganization.identifier,
          query: searchObj.data.query,
        })
        .then(() => {
          getFilteredMetricValues(name);
        })
        .catch(() => {
          getMetricsFieldValues(name);
        });
    };

    const onMetricChange = async () => {
      await nextTick();

      emit("update:change-metric", selectedMetric.value);
    };
    const setSelectedMetricType = (option: any) => {
      searchObj.data.metrics.selectedMetricType = option.type;
    };
    const addLabelToEditor = (label: string) => {
      emit("select-label", label);
    };
    const addValueToEditor = (
      label: string,
      value: string,
      operator: string,
    ) => {
      addLabelToEditor(`${label}${operator}"${value}"`);
    };
    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      getImageURL,
      filteredMetricLabels,
      searchMetricLabel,
      metricColumns,
      visibleMetricLabels,
      filterMetricLabels,
      openFilterCreator,
      openMetricRows,
      metricLabelValues,
      onMetricChange,
      metricsIconMapping,
      setSelectedMetricType,
      "add": "add",
      addLabelToEditor,
      addValueToEditor,
      selectedMetric,
      // Exposed for testing
      selectedMetricLabels,
      getMetricsFieldValues,
      getFilteredMetricValues,
      updateMetricLabels,
    };
  },
});
</script>

<style lang="scss" scoped>
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
        background-color: color-mix(in srgb, currentColor 15%, transparent);
      }

      &.selected {
        background-color: rgba(89, 96, 178, 0.3);
      }
    }
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

    :deep(table) {
      display: table;
      table-layout: fixed !important;
    }

    :deep(thead) {
      display: none;
    }

    :deep(tr) {
      margin-bottom: 1px;
    }

    :deep(tbody),
    :deep(tr),
    :deep(td) {
      width: 100%;
      display: block;
      height: fit-content;
      overflow: hidden;
    }

    :deep(.q-table__control),
    label.q-field {
      width: 100%;
    }

    :deep(thead tr),
    :deep(tbody td) {
      height: auto;
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
  table {
    width: 100%;
    table-layout: fixed;

    .metric-expansion-item {
      &:hover {
        .field_overlay {
          visibility: visible;
}
      }

    }

    .field-container {
      &:hover {
        .field_overlay {
          visibility: visible;
}
      }
    }

    .field_list {
      &.selected {
        .metric-expansion-item {
          background-color: rgba(89, 96, 178, 0.3);
        }

        .field_overlay {
          background-color: #ffffff;
        }
      }
    }
  }
}

.theme-dark {
  .field_list {
    &:hover {
      box-shadow: 0px 4px 15px rgb(255, 255, 255, 0.1);

      .field_overlay {
        background-color: #3f4143;
        opacity: 1;
      }
    }
  }
}

.theme-light {
  .field_list {
    &:hover {
      box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

      .field_overlay {
        background-color: #e8e8e8;
        opacity: 1;
      }
    }
  }
}
</style>

<style lang="scss">
.metric-explore-metric-icon {
  min-width: 28px !important;
  padding-right: 8px !important;
}
</style>
