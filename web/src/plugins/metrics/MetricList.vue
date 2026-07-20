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
    class="flex flex-col w-full index-menu"
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
        <li class="flex items-center gap-2 px-3 py-2">
          <div class="flex flex-col flex-1 min-w-0">{{ t("search.noResult") }}</div>
        </li>
      </template>
    </OSelect>
    <div class="metric-list h-[calc(100vh-98px)] w-full overflow-x-hidden overflow-y-auto">
      <div
        class="metrics-label-table mt-1 w-full"
        data-test="log-search-index-list-fields-table"
      >
        <OTable
          :data="visibleMetricLabels"
          :columns="metricColumns"
          row-key="name"
          pagination="none"
          :show-global-filter="false"
          class="field-table w-full"
        >
          <template #cell-name="{ row }">
            <div class="p-0 mb-0.5 relative overflow-visible cursor-default group hover:shadow-[0px_4px_15px_rgba(0,0,0,0.17)] dark:hover:shadow-[0px_4px_15px_rgb(255,255,255,0.1)]">
              <!-- TODO OK : Repeated code make separate component to display field  -->
              <template
                v-if="
                  row.name === store.state.zoConfig.timestamp_column
                "
              >
                <OFieldLabel :field="row" class="pl-4" />
              </template>
              <template v-else>
                <OCollapsible
                  variant="sidebar"
                  :model-value="openMetricRows[row.name] === true"
                  @update:model-value="(v) => { openMetricRows[row.name] = v; if (v) openFilterCreator(null, row); }"
                >
                  <template #trigger>
                    <div class="flex items-center min-w-0">
                      <OFieldLabel :field="row" class="flex-1 min-w-0" />
                      <!-- `bg-surface-subtle`, not a hex pair with a `dark:`
                           override: the token already resolves in both themes,
                           which is the whole point of having it. -->
                      <div class="absolute h-full right-0 top-0 z-[5] bg-surface-subtle px-[0.375rem] invisible flex items-center group-hover:visible group-hover:opacity-100">
                        <OButton
                          icon-left="add"
                          :data-test="`metrics-list-add-${row.name}-label-btn`"
                          variant="ghost"
                          size="icon-xs"
                          class="mr-0"
                          @click.stop="addValueToEditor(row.name, '', '=')"
                        />
                      </div>
                    </div>
                  </template>
                  <div class="pl-3 pr-1 py-1">
                      <div class="filter-values-container">
                        <div
                          v-show="
                            metricLabelValues[row.name]?.isLoading
                          "
                          class="pl-3 py-1"
                          style="height: 60px"
                        >
                          <OInnerLoading
                            :showing="
                              metricLabelValues[row.name]?.isLoading
                            "
                            :label="t('metrics.metricList.fetchingValues')"
                            size="xs"
                          />
                        </div>
                        <div
                          v-show="
                            !metricLabelValues[row.name]?.values
                              ?.length &&
                            !metricLabelValues[row.name]?.isLoading
                          "
                          class="pl-3 py-1 text-sm font-medium"
                        >
                          {{ t('metrics.metricList.noValuesFound') }}
                        </div>
                        <div
                          v-for="value in metricLabelValues[row.name]
                            ?.values || []"
                          :key="value.key + value.count"
                        >
                          <ul>
                            <label class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 pr-0">
                              <div
                                class="flex flex wrap justify-between"
                                style="width: calc(100% - 46px)"
                                :class="
                                  store.state.theme === 'dark'
                                    ? 'text-gray-300'
                                    : 'text-gray-500'
                                "
                              >
                                <div
                                  :title="value.key"
                                  class="truncate pr-1"
                                  style="width: calc(100% - 50px)"
                                >
                                  {{ value.key }}
                                </div>
                                <div
                                  :title="value.count?.toString()"
                                  class="truncate text-right pr-2"
                                  style="width: 50px"
                                >
                                  {{ value.count }}
                                </div>
                              </div>
                              <div
                                class="flex flex"
                                :class="
                                  store.state.theme === 'dark'
                                    ? 'text-white'
                                    : 'text-black'
                                "
                              >
                                <OButton
                                  class="mr-1"
                                  size="icon-xs"
                                  variant="ghost"
                                  :title="t('metrics.metricList.includeTerm')"
                                  @click="
                                    addValueToEditor(
                                      row.name,
                                      value.key,
                                      '=',
                                    )
                                  "
                                >
                                  <EqualIcon class="size-3" />
                                </OButton>
                                <OButton
                                  class="mr-1"
                                  size="icon-xs"
                                  variant="ghost"
                                  :title="t('metrics.metricList.excludeTerm')"
                                  @click="
                                    addValueToEditor(
                                      row.name,
                                      value.key,
                                      '!=',
                                    )
                                  "
                                >
                                  <NotEqualIcon class="size-3" />
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
              message: t("metrics.metricList.errorFetchingFieldValues"),
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

<style>
.index-menu .metrics-label-table table {
  display: table;
  table-layout: fixed !important;
}

.index-menu .metrics-label-table thead {
  display: none;
}

.index-menu .metrics-label-table tr {
  margin-bottom: 1px;
}

.index-menu .metrics-label-table tbody,
.index-menu .metrics-label-table tr,
.index-menu .metrics-label-table td {
  width: 100%;
  display: block;
  height: fit-content;
  overflow: hidden;
}

.index-menu .metrics-label-table thead tr,
.index-menu .metrics-label-table tbody td {
  height: auto;
}

.metrics-label-table table {
  width: 100%;
  table-layout: fixed;
}

</style>
