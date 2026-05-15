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
    class="column index-menu"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <div class="col-auto tw:mx-[0.625rem]">
      <!-- stream type selection will be hidden for metrics page -->
      <OSelect
        v-if="dashboardPanelDataPageKey !== 'metrics'"
        v-model="
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type
        "
        :label="t('dashboard.selectStreamType')"
        :options="streamTypeOptions"
        data-test="index-dropdown-stream_type"
        class="tw:mb-1"
        :readonly="dashboardPanelDataPageKey === 'logs'"
      />
      <OSelect
        v-model="
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream
        "
        :label="t('dashboard.selectIndex')"
        :options="dashboardPanelData.meta.stream.streamResults"
        data-test="index-dropdown-stream"
        searchable
        :loading="streamDataLoading.isLoading.value"
        valueKey="name"
        labelKey="name"
        :readonly="dashboardPanelDataPageKey === 'logs'"
        :title="
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream
        "
      />
    </div>
    <div class="column col index-table q-mt-xs">
      <q-table
        class="col"
        :columns="[
          {
            name: 'name',
            field: 'name',
            align: 'left',
            label: 'Field',
            sortable: true,
          },
        ]"
        :rows="flattenGroupedFields"
        v-model:pagination="pagination"
        row-key="column"
        :filter="dashboardPanelData.meta.stream.filterField"
        :filter-method="filterFieldFn"
        hide-header
        virtual-scroll
        id="fieldList"
        :rows-per-page-options="[]"
        :hide-bottom="
          (!store.state.zoConfig.user_defined_schemas_enabled ||
            dashboardPanelData.meta.stream.userDefinedSchema.length == 0) &&
          dashboardPanelData.meta.stream.selectedStreamFields != undefined &&
          (dashboardPanelData.meta.stream.selectedStreamFields.length <=
            pagination.rowsPerPage ||
            dashboardPanelData.meta.stream.selectedStreamFields.length == 0)
        "
      >
        <template #body-cell-name="props">
          <q-tr :props="props">
            <q-td
              class="field_list"
              :props="props"
              v-mutation="mutationHandler"
              @dragenter="onDragEnter"
              @dragleave="onDragLeave"
              @dragover="onDragOver"
              @drop="onDrop"
              @dragend="onDragEnd"
            >
              <div
                v-if="props?.row?.isGroup"
                class="tw:pl-2 tw:py-1 tw:font-semibold field-group-header"
                :title="props?.row?.groupName"
              >
                {{ props?.row?.groupName }}
              </div>
              <div
                v-else
                class="field_overlay"
                :title="props.row.name"
                :data-test="`field-list-item-${
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].fields?.stream_type
                }-${
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].fields?.stream
                }-${props.row.name}`"
              >
                <div
                  class="field_label"
                  :draggable="
                    !hideAllFieldsSelection &&
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >= customQueryFieldsLength)
                    )
                  "
                  @dragstart="onDragStart($event, props.row)"
                >
                  <q-icon
                    name="drag_indicator"
                    color="grey-13"
                    :class="[
                      'q-mr-xs',
                      !hideAllFieldsSelection &&
                      !(
                        promqlMode ||
                        (dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery &&
                          props.pageIndex >= customQueryFieldsLength)
                      )
                        ? 'drag_indicator'
                        : 'drag_disabled',
                    ]"
                    v-if="!promqlMode"
                    data-test="dashboard-add-data-indicator"
                  />

                  <q-icon
                    :name="
                      props.row.type == 'Utf8'
                        ? 'text_fields'
                        : props.row.type == 'Boolean'
                          ? 'toggle_off'
                          : 'tag'
                    "
                    color="grey-6"
                    class="q-mr-xs"
                  />
                  {{ props.row.name }}
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !hideAllFieldsSelection &&
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >= customQueryFieldsLength) ||
                      dashboardPanelData.data.type == 'geomap' ||
                      dashboardPanelData.data.type == 'maps' ||
                      dashboardPanelData.data.type == 'custom_chart'
                    )
                  "
                >
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="isAddXAxisNotAllowed"
                    @click="addXAxisItem(props.row)"
                    data-test="dashboard-add-x-data"
                  >
                    {{ dashboardPanelData.data.type != "h-bar" ? "+X" : "+Y" }}
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="isAddYAxisNotAllowed"
                    @click="addYAxisItem(props.row)"
                    data-test="dashboard-add-y-data"
                  >
                    {{ dashboardPanelData.data.type != "h-bar" ? "+Y" : "+X" }}
                  </OButton>
                  <OButton
                    v-if="dashboardPanelData.data.type == 'table'"
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="isAddBreakdownNotAllowed"
                    @click="addBreakDownAxisItem(props.row)"
                    data-test="dashboard-add-p-data"
                  >
                    +P
                  </OButton>
                  <OButton
                    v-if="
                      dashboardPanelData.data.type == 'area' ||
                      dashboardPanelData.data.type == 'bar' ||
                      dashboardPanelData.data.type == 'line' ||
                      dashboardPanelData.data.type == 'h-bar' ||
                      dashboardPanelData.data.type == 'h-stacked' ||
                      dashboardPanelData.data.type == 'scatter' ||
                      dashboardPanelData.data.type == 'area-stacked' ||
                      dashboardPanelData.data.type == 'stacked'
                    "
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="isAddBreakdownNotAllowed"
                    @click="addBreakDownAxisItem(props.row)"
                    data-test="dashboard-add-b-data"
                  >
                    +B
                  </OButton>
                  <OButton
                    v-if="dashboardPanelData.data.type == 'heatmap'"
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="isAddZAxisNotAllowed"
                    @click="addZAxisItem(props.row)"
                    data-test="dashboard-add-z-data"
                  >
                    +Z
                  </OButton>
                  <OButton
                    v-if="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery == false
                    "
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                        (vrlField: any) => vrlField.name == props.row.name,
                      )
                    "
                    @click="addFilteredItem(props.row)"
                    data-test="dashboard-add-filter-data"
                  >
                    +F
                  </OButton>
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !hideAllFieldsSelection &&
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >= customQueryFieldsLength)
                    ) &&
                    dashboardPanelData.data.type == 'geomap'
                  "
                >
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.latitude != null
                    "
                    @click="addLatitude(props.row)"
                    data-test="dashboard-add-latitude-data"
                  >
                    +Lat
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.longitude != null
                    "
                    @click="addLongitude(props.row)"
                    data-test="dashboard-add-longitude-data"
                  >
                    +Lng
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.weight != null
                    "
                    @click="addWeight(props.row)"
                    data-test="dashboard-add-weight-data"
                  >
                    +W
                  </OButton>
                  <OButton
                    v-if="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery == false
                    "
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                        (vrlField: any) => vrlField.name == props.row.name,
                      )
                    "
                    @click="addFilteredItem(props.row)"
                    data-test="dashboard-add-filter-data"
                  >
                    +F
                  </OButton>
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !hideAllFieldsSelection &&
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >= customQueryFieldsLength)
                    ) &&
                    dashboardPanelData.data.type == 'maps'
                  "
                >
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.name != null
                    "
                    @click="addMapName(props.row)"
                    data-test="dashboard-add-x-data"
                  >
                    +N
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.value_for_maps != null
                    "
                    @click="addMapValue(props.row)"
                    data-test="dashboard-add-y-data"
                  >
                    +V
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    @click="addFilteredItem(props.row)"
                    data-test="dashboard-add-filter-data"
                  >
                    +F
                  </OButton>
                </div>

                <div
                  class="field_icons"
                  v-if="
                    !hideAllFieldsSelection &&
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >= customQueryFieldsLength)
                    ) &&
                    dashboardPanelData.data.type == 'sankey'
                  "
                >
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.source != null
                    "
                    @click="addSource(props.row)"
                    data-test="dashboard-add-source-data"
                  >
                    +S
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.target != null
                    "
                    @click="addTarget(props.row)"
                    data-test="dashboard-add-target-data"
                  >
                    +T
                  </OButton>
                  <OButton
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.value != null
                    "
                    @click="addValue(props.row)"
                    data-test="dashboard-add-value-data"
                  >
                    +V
                  </OButton>
                  <OButton
                    v-if="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery == false
                    "
                    variant="ghost-neutral"
                    size="chip"
                    :disabled="
                      !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                        (vrlField: any) => vrlField.name == props.row.name,
                      )
                    "
                    @click="addFilteredItem(props.row)"
                    data-test="dashboard-add-filter-data"
                  >
                    +F
                  </OButton>
                </div>
              </div>
            </q-td>
          </q-tr>
        </template>
        <template #top-right>
          <OInput
            v-model="dashboardPanelData.meta.stream.filterField"
            data-test="index-field-search-input"
            clearable
            :debounce="1"
            :loading="getStreamFields.isLoading.value"
            :placeholder="t('search.searchField')"
            class="tw:mx-[0.625rem]"
          >
            <template #prepend>
              <q-icon name="search" />
            </template>
          </OInput>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  reactive,
  ref,
  watch,
  onActivated,
  computed,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { useLoading } from "@/composables/useLoading";
import useStreams from "@/composables/useStreams";
import { inject } from "vue";
import useNotifications from "@/composables/useNotifications";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

export default defineComponent({
  name: "FieldList",
  components: { OButton, OSelect, OInput },
  props: ["editMode", "hideAllFieldsSelection"],
  setup(props, { emit }) {
    const dashboardPanelDataPageKey: any = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const userDefinedSchemaBtnGroupOption = [
      {
        label: "",
        value: "user_defined_schema",
        slot: "user_defined_slot",
      },
      {
        label: "",
        value: "all_fields",
        slot: "all_fields_slot",
      },
    ];

    const pagination = ref({
      page: 1,
      rowsPerPage: 250,
    });

    // custom query fields length
    // will be updated when filter is applied
    const customQueryFieldsLength = ref(0);

    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const data = reactive<any>({
      // schemaList: [],
      // indexOptions: [],
      streamType: ["logs", "metrics", "traces"],
    });
    const filteredStreams = ref([]);
    const {
      dashboardPanelData,
      addXAxisItem,
      addYAxisItem,
      addZAxisItem,
      addBreakDownAxisItem,
      addFilteredItem,
      isAddXAxisNotAllowed,
      isAddBreakdownNotAllowed,
      isAddYAxisNotAllowed,
      isAddZAxisNotAllowed,
      promqlMode,
      addLatitude,
      addLongitude,
      addWeight,
      addMapName,
      addMapValue,
      addSource,
      addTarget,
      addValue,
      cleanupDraggingFields,
      updateGroupedFields,
      fetchPromQLLabels,
    } = useDashboardPanelData(dashboardPanelDataPageKey);
    const { getStreams, getStream } = useStreams();
    const { showErrorNotification } = useNotifications();
    const onDragEnd = () => {
      cleanupDraggingFields();
    };
    const { parsePromQlQuery } = usePromqlSuggestions();

    const metricsIconMapping: any = {
      Summary: "description",
      Gauge: "speed",
      Histogram: "bar_chart",
      Counter: "pin",
    };

    const selectedMetricTypeIcon = computed(() => {
      return dashboardPanelData.meta.stream.streamResults.find(
        (it: any) =>
          it.name ==
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream,
      )?.metrics_meta?.metric_type;
    });

    // computed property to set default value as false
    const hideAllFieldsSelection = computed(
      () => props.hideAllFieldsSelection ?? false,
    );

    // get stream list
    const streamDataLoading = useLoading(async (stream_type: any) => {
      await getStreamList(stream_type);
    });

    // get the stream list based on the selected stream type
    const loadStreamsListBasedOnType = async () => {
      streamDataLoading.execute(
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      );
    };

    // watch the stream type and load the stream list
    watch(
      () => [
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      ],
      async () => {
        loadStreamsListBasedOnType();
      },
    );

    onMounted(() => {
      loadStreamsListBasedOnType();
    });

    const streamTypeOptions = computed(() =>
      data.streamType.map((t: string) => ({ label: t, value: t })),
    );

    const onStreamSearch = (val: string) => {
      filteredStreams.value =
        dashboardPanelData.meta.stream.streamResults.filter((stream: any) => {
          return stream.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
        });
    };

    const getStreamFields = useLoading(
      async (fieldName: string, streamType: string) => {
        return await getStream(fieldName, streamType, true);
      },
    );

    // Track stream/type per query index to detect changes within each specific query
    const queryStreamTracking = ref<
      Record<
        number,
        {
          stream: string | null | undefined;
          streamType: string | null | undefined;
        }
      >
    >({});

    // Initialize tracking for all existing queries
    dashboardPanelData.data.queries.forEach((query: any, index: number) => {
      if (!queryStreamTracking.value[index]) {
        queryStreamTracking.value[index] = {
          stream: query?.fields?.stream || null,
          streamType: query?.fields?.stream_type || null,
        };
      }
    });

    // update the selected stream fields list
    watch(
      () => [
        dashboardPanelData.meta.stream.streamResults,
        dashboardPanelData.meta.stream.streamResultsType,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream_type,
        dashboardPanelData.layout.currentQueryIndex, // Track index changes
      ],
      async (newValues, oldValues) => {
        const currentIndex = dashboardPanelData.layout.currentQueryIndex;
        const currentStream = newValues?.[2];
        const currentStreamType = newValues?.[3];

        // Initialize tracking for this query if it doesn't exist
        if (!queryStreamTracking.value[currentIndex]) {
          queryStreamTracking.value[currentIndex] = {
            stream: currentStream,
            streamType: currentStreamType,
          };
          // Don't apply default query for newly tracked query
          return;
        }

        // Get the previous stream/type for THIS specific query (not the previous query)
        const previousForThisQuery = queryStreamTracking.value[currentIndex];

        // Check if stream or streamType changed FOR THIS SPECIFIC QUERY
        const streamChangedForThisQuery =
          previousForThisQuery.stream !== currentStream;
        const streamTypeChangedForThisQuery =
          previousForThisQuery.streamType !== currentStreamType;

        // Update tracking for this query
        queryStreamTracking.value[currentIndex] = {
          stream: currentStream,
          streamType: currentStreamType,
        };

        // Only proceed if stream or streamType actually changed within THIS query
        if (!streamChangedForThisQuery && !streamTypeChangedForThisQuery) {
          return;
        }

        // get the selected stream fields based on the selected stream type
        const fields: any = dashboardPanelData.meta.stream.streamResults.find(
          (it: any) =>
            it.name ==
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream &&
            it.stream_type ==
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream_type,
        );

        // if fields found and stream result is of same type
        if (
          fields &&
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type ===
            dashboardPanelData.meta.stream.streamResultsType
        ) {
          try {
            // if promql mode
            // NOTE: For the metrics page, we added one watch that resets the query on stream change.
            // Because of that, the default query overrides the original/saved query on the edit panel.
            // To prevent this, we added the dashboardPanelDataPageKey condition.
            // IMPORTANT: Only set default query if stream or stream_type actually changed
            if (promqlMode.value && dashboardPanelDataPageKey === "metrics") {
              // Parse query to check if metric name differs from stream name
              // Only override query if they differ or metric name is null
              let parsedQuery = null;
              try {
                // Parse the query to get the metric name
                parsedQuery = parsePromQlQuery(
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].query,
                );
              } catch (error: any) {
                console.error("Failed to parse PromQL query:", error);
                parsedQuery = null;
              }

              const metricName = parsedQuery?.metricName;
              const streamName =
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.stream;

              // Add guard
              if (!streamName) {
                console.warn("Cannot update query: stream name is undefined");
                return;
              }

              // Set query if: (1) no metric name exists, OR (2) metric name differs from stream
              if (!metricName || metricName !== streamName) {
                // Set the query to the new stream name with curly braces
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].query = streamName + "{}";
              }

              fetchPromQLLabels(
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.stream?.toString(),
              );
            }
          } catch (error: any) {
            showErrorNotification(
              error?.message ?? "Failed to get stream fields",
            );
          }
        }
      },
    );

    watch(
      () => [
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
        dashboardPanelData.meta.stream.streamResults,
        dashboardPanelData.meta.stream.streamResultsType,
      ],
      () => {
        // if (!props.editMode) {
        //   dashboardPanelData.data.queries[
        //     dashboardPanelData.layout.currentQueryIndex
        //   ].fields.stream = "";
        // }

        // data.indexOptions = data.schemaList.filter(
        //   (data: any) =>
        //     data.stream_type ==
        //     dashboardPanelData.data.queries[
        //       dashboardPanelData.layout.currentQueryIndex
        //     ].fields.stream_type
        // );

        // set the first stream as the selected stream when the api loads the data
        // Here, we need to check if the stream results are same as the selected stream type
        if (
          // !props.editMode &&
          // !dashboardPanelData.data.queries[
          //   dashboardPanelData.layout.currentQueryIndex
          // ].fields.stream &&
          dashboardPanelData.meta.stream.streamResults.length > 0 &&
          dashboardPanelData.meta.stream.streamResultsType ===
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type
        ) {
          const currentIndex = dashboardPanelData.layout.currentQueryIndex;
          // Check if selected stream for current query exists in index options
          // If not, set the first index option as the selected stream
          const existingStream = dashboardPanelData.meta.stream.streamResults.find(
            (it: any) =>
              it.name ==
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream,
          );
          if (existingStream) {
            dashboardPanelData.data.queries[currentIndex].fields.stream =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream;
          } else {
            dashboardPanelData.data.queries[currentIndex].fields.stream =
              dashboardPanelData.meta.stream.streamResults[0]?.name;
          }
        }
      },
    );
    // update the current list fields if any of the lists changes
    watch(
      () => [
        dashboardPanelData.meta.stream.customQueryFields,
        dashboardPanelData.meta.stream.vrlFunctionFieldList,
      ],
      () => {
        // set the custom query fields length
        customQueryFieldsLength.value =
          dashboardPanelData.meta.stream.customQueryFields.length +
          dashboardPanelData.meta.stream.vrlFunctionFieldList.length;
      },
      { immediate: true },
    );

    const flattenGroupedFields = computed(() => {
      const flattenedFields: any[] = [];

      dashboardPanelData.meta.stream.customQueryFields.forEach((field: any) => {
        flattenedFields.push({
          name: field.name,
          type: field.type,
          isGroup: false,
        });
      });

      dashboardPanelData.meta.stream.vrlFunctionFieldList.forEach(
        (field: any) => {
          flattenedFields.push({
            name: field.name,
            type: field.type,
            isGroup: false,
          });
        },
      );

      dashboardPanelData.meta.streamFields.groupedFields.forEach(
        (group: any) => {
          // Add a group header row
          flattenedFields.push({
            isGroup: true,
            groupName: group.name,
          });

          if (
            group.settings.hasOwnProperty("defined_schema_fields") &&
            group.settings.defined_schema_fields.length > 0
          ) {
            // add the user defined fields
            // _timestamp field + user defined fields + all_fields_name

            // add _timestamp field
            flattenedFields.push({
              name: store.state.zoConfig?.timestamp_column,
              type: "Int64",
              stream: group.name,
              streamAlias: group.stream_alias,
              isGroup: false,
            });

            // add user defined fields
            for (const field of group.schema) {
              if (
                store.state.zoConfig.user_defined_schemas_enabled &&
                group.settings.hasOwnProperty("defined_schema_fields") &&
                group.settings.defined_schema_fields.length > 0
              ) {
                if (group.settings.defined_schema_fields.includes(field.name)) {
                  // push as a user defined schema
                  flattenedFields.push({
                    ...field,
                    stream: group.name,
                    streamAlias: group.stream_alias,
                    isGroup: false,
                  });
                }
              }
            }

            // add all_fields_name
            flattenedFields.push({
              name: store.state.zoConfig?.all_fields_name,
              type: "Utf8",
              stream: group.name,
              streamAlias: group.stream_alias,
              isGroup: false,
            });
          } else {
            // use schema of the group
            // Add the fields in the group, including the group name
            group.schema.forEach((field: any) => {
              flattenedFields.push({
                ...field,
                stream: group.name,
                streamAlias: group.stream_alias,
                isGroup: false,
              });
            });
          }
        },
      );

      return flattenedFields;
    });

    watch(
      () => ({
        stream:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream,
        streamType:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type,
        joins:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].joins,
      }),
      () => {
        updateGroupedFields();
      },
      { deep: true, immediate: true },
    );

    watch(
      () => dashboardPanelData.meta.stream.filterField,
      () => {
        // Recompute custom query fields length based on filtered results.
        // When a search filter is active, pageIndex is relative to the
        // filtered rows, so customQueryFieldsLength must reflect the count
        // of custom/VRL fields that pass the filter — not the total.
        const filterTerm = dashboardPanelData.meta.stream.filterField
          ?.toLowerCase()
          ?.trim();
        if (!filterTerm) {
          customQueryFieldsLength.value =
            dashboardPanelData.meta.stream.customQueryFields.length +
            dashboardPanelData.meta.stream.vrlFunctionFieldList.length;
        } else {
          const matchingCustom =
            dashboardPanelData.meta.stream.customQueryFields.filter(
              (f: any) => f.name?.toLowerCase().includes(filterTerm),
            ).length;
          const matchingVrl =
            dashboardPanelData.meta.stream.vrlFunctionFieldList.filter(
              (f: any) => f.name?.toLowerCase().includes(filterTerm),
            ).length;
          customQueryFieldsLength.value = matchingCustom + matchingVrl;
        }
      },
    );

    // get the stream list by making an API call
    const getStreamList = async (stream_type: any) => {
      await getStreams(stream_type, false).then((res: any) => {
        // below line required for pass by reference
        // if we don't set blank, then same object from cache is being set
        // and that doesn't call the watchers,
        // so it will not be updated when we switch to different chart types
        // which doesn't have field list and coming back to field list
        dashboardPanelData.meta.stream.streamResults = [];

        dashboardPanelData.meta.stream.streamResults = res.list;

        dashboardPanelData.meta.stream.streamResultsType = stream_type;
      });
    };
    const filterFieldFn = (rows: any, terms: any) => {
      if (!terms || terms.trim() === "") {
        return rows;
      }

      const searchTerm = terms.toLowerCase();

      const filteredRows = rows.filter((row: any) => {
        // Always include group headers
        if (row.isGroup) {
          return true;
        }

        // Filter fields based on name
        return row.name.toLowerCase().includes(searchTerm);
      });

      return filteredRows;
    };

    const mutationHandler: any = (mutationRecords: any) => {};

    const onDragEnter = (e: any) => {
      e.preventDefault();
    };

    const onDragStart = (e: any, item: any) => {
      dashboardPanelData.meta.dragAndDrop.dragging = true;
      dashboardPanelData.meta.dragAndDrop.dragElement = item;
      dashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
      dashboardPanelData.meta.dragAndDrop.dragSourceIndex = null;
    };

    const onDragLeave = (e: any) => {
      e.preventDefault();
      // e.target.classList.remove('drag-enter')
    };

    const onDragOver = (e: any) => {
      e.preventDefault();
    };

    const onDrop = (e: any) => {
      dashboardPanelData.meta.dragAndDrop.dragging = false;
      dashboardPanelData.meta.dragAndDrop.dragElement = null;
      dashboardPanelData.meta.dragAndDrop.dragSource = null;
      dashboardPanelData.meta.dragAndDrop.dragSourceIndex = null;
    };

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        filteredStreams.value =
          dashboardPanelData.meta.stream.streamResults.filter((stream: any) => {
            return stream.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
          });
      });
    };

    return {
      dashboardPanelDataPageKey,
      t,
      store,
      router,
      mutationHandler,
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop,
      onDragStart,
      filterFieldFn,
      addXAxisItem,
      addYAxisItem,
      addZAxisItem,
      addBreakDownAxisItem,
      addLatitude,
      addLongitude,
      addWeight,
      addMapName,
      addMapValue,
      addSource,
      addTarget,
      addValue,
      addFilteredItem,
      data,
      getStreamList,
      getStreamFields,
      dashboardPanelData,
      filterStreamFn,
      streamTypeOptions,
      onStreamSearch,
      filteredStreams,
      isAddXAxisNotAllowed,
      isAddBreakdownNotAllowed,
      isAddYAxisNotAllowed,
      isAddZAxisNotAllowed,
      promqlMode,
      streamDataLoading,
      metricsIconMapping,
      selectedMetricTypeIcon,
      onDragEnd,
      customQueryFieldsLength,
      userDefinedSchemaBtnGroupOption,
      pagination,
      flattenGroupedFields,
      hideAllFieldsSelection,
    };
  },
});
</script>

<style lang="scss" scoped>
.metric-explore-metric-icon {
  min-width: 28px !important;
  padding-right: 8px !important;
}

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
  height: 100%;

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

  .q-select {
    // text-transform: capitalize;
  }

  .index-table {
    width: 100%;
    height: 100%;

    // border: 1px solid rgba(0, 0, 0, 0.02);
    .q-table {
      display: block;
    }

    tr {
      margin-bottom: 1px;
    }

    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: 25px;
    }

    :deep(.q-table__top) {
      padding: 0px !important;
      border-bottom: unset;
    }

    :deep(.q-table__control),
    label.q-field {
      width: 100%;
    }

    .q-table thead tr,
    .q-table tbody td {
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

    .field_overlay {
      justify-content: space-between;
      background-color: transparent;
      transition: all 0.3s ease;
      padding: 0px 10px;
      align-items: center;
      position: absolute;
      line-height: 2rem;
      overflow: hidden;
      inset: 0;
      display: flex;
      z-index: 1;
      width: 100%;
      border-radius: 0px;
      height: 25px;

      .field_icons {
        padding: 0 0 0 0.15rem;
        transition: all 0.3s ease;
        // background-color: white;
        position: absolute;
        z-index: 3;
        opacity: 0;
        right: 0;

        .q-icon {
          cursor: pointer;
        }

        button {
          border-left: 2px solid #d0d0d0;
        }
      }

      .field_label {
        // pointer-events: none;
        font-size: 0.825rem;
        position: relative;
        display: inline;
        z-index: 2;
        left: 0;
        // text-transform: capitalize;

        .drag_indicator {
          cursor: -webkit-grab;
          cursor: grab;
        }

        .drag_disabled {
          cursor: not-allowed;
        }
      }
    }

    &.selected {
      .field_overlay {
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
      }

      &:hover {
        .field_overlay {
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);
          background-color: white;

          .field_icons {
            background-color: white;
          }
        }
      }
    }

    &:hover {
      .field_overlay {
        .field_icons {
          // background-color: white;
          opacity: 1;
        }
      }
    }
  }
}

.theme-dark {
  .field_overlay {
    &:hover {
      box-shadow: 0px 4px 15px rgb(255, 255, 255, 0.1);

      .field_icons {
        background-color: #202224;
        opacity: 1;
      }
    }
  }

  .field-group-header {
    background-color: var(--o2-header-menu-bg);
  }
}

.theme-light {
  .field_overlay {
    &:hover {
      box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

      .field_icons {
        background-color: white;
        opacity: 1;
      }
    }
  }

  .field-group-header {
    background-color: rgb(229, 231, 235);
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
    // background-color: $selected-list-bg !important;
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

// if metric icon is present then move the label to the left
:deep(.metric_icon_present .q-field__label) {
  margin-left: -24px;
}

.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}

.schema-field-toggle .q-btn {
  padding: 5px !important;
}

.schema-field-toggle {
  border: 1px solid light-grey;
  border-radius: 5px;
  line-height: 10px;
}

.q-table__bottom {
  padding: 0px !important;
}

.pagination-field-count {
  line-height: 32px;
  font-weight: 700;
  font-size: 13px;
}

.q-table__bottom .q-table__control {
  min-height: 80px !important;
}

.fieldList-pagination {
  // min-height: 80px;
  display: flex;
  // padding-bottom: 2rem; //why we added this not sure but need to check and for now removing it because it is showing too much space at the bottom
}
</style>
