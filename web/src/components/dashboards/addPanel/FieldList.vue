<!-- Copyright 2023 Zinc Labs Inc.

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
    <div class="col-auto">
      <q-select
        v-model="
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type
        "
        :label="t('dashboard.selectStreamType')"
        :options="data.streamType"
        data-test="index-dropdown-stream_type"
        input-debounce="0"
        behavior="menu"
        filled
        borderless
        dense
        class="q-mb-xs"
      ></q-select>
      <q-select
        v-model="
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream
        "
        :label="t('dashboard.selectIndex')"
        :options="filteredStreams"
        data-test="index-dropdown-stream"
        input-debounce="0"
        behavior="menu"
        use-input
        filled
        borderless
        dense
        hide-selected
        fill-input
        @filter="filterStreamFn"
        :loading="streamDataLoading.isLoading.value"
        option-label="name"
        option-value="name"
        emit-value
        :class="
          selectedMetricTypeIcon &&
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type == 'metrics'
            ? 'metric_icon_present'
            : ''
        "
      >
        <template
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type == 'metrics' && selectedMetricTypeIcon
          "
          v-slot:prepend
        >
          <q-icon
            style="margin-top: 14px"
            size="xs"
            :name="metricsIconMapping[selectedMetricTypeIcon || '']"
          />
        </template>

        <template
          v-slot:option="scope"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type == 'metrics'
          "
        >
          <q-item
            :class="
              store.state.theme === 'dark' &&
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream !== scope.opt.value
                ? 'text-white'
                : ''
            "
            v-bind="scope.itemProps"
          >
            <q-item-section avatar class="metric-explore-metric-icon">
              <q-icon
                size="xs"
                :name="
                  metricsIconMapping[scope.opt.metrics_meta.metric_type] || ''
                "
              />
            </q-item-section>
            <q-item-section>
              <q-item-label> {{ scope.opt.name }} </q-item-label>
            </q-item-section>
          </q-item>
        </template>

        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
      </q-select>
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
        :rows="data.currentFieldsList"
        row-key="column"
        :filter="dashboardPanelData.meta.stream.filterField"
        :filter-method="filterFieldFn"
        :pagination="{ rowsPerPage: 10000 }"
        hide-header
        hide-bottom
        virtual-scroll
        id="fieldList"
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
              :style="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].customQuery &&
                props.pageIndex ==
                  dashboardPanelData.meta.stream.customQueryFields.length
                  ? 'border: 1px solid black'
                  : ''
              "
            >
              <div
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
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >=
                          dashboardPanelData.meta.stream.customQueryFields
                            .length)
                    )
                  "
                  @dragstart="onDragStart($event, props.row)"
                >
                  <q-icon
                    name="drag_indicator"
                    color="grey-13"
                    :class="[
                      'q-mr-xs',
                      !(
                        promqlMode ||
                        (dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery &&
                          props.pageIndex >=
                            dashboardPanelData.meta.stream.customQueryFields
                              .length)
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
                        : props.row.type == 'Int64'
                        ? 'tag'
                        : 'toggle_off'
                    "
                    color="grey-6"
                    class="q-mr-xs"
                  />
                  {{ props.row.name }}
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >=
                          dashboardPanelData.meta.stream.customQueryFields
                            .length) ||
                      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type == 'geomap'
                    )
                  "
                >
                  <q-btn
                    padding="sm"
                    :disabled="isAddXAxisNotAllowed"
                    @click="addXAxisItem(props.row)"
                    data-test="dashboard-add-x-data"
                  >
                    <div>
                      {{
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type != "h-bar" ? "+X" : "+Y"
                      }}
                    </div>
                  </q-btn>
                  <q-btn
                    padding="sm"
                    :disabled="isAddYAxisNotAllowed"
                    @click="addYAxisItem(props.row)"
                    data-test="dashboard-add-y-data"
                  >
                    <div>
                      {{
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type != "h-bar" ? "+Y" : "+X"
                      }}
                    </div>
                  </q-btn>
                  <q-btn
                    v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type == 'heatmap'"
                    padding="sm"
                    :disabled="isAddZAxisNotAllowed"
                    @click="addZAxisItem(props.row)"
                    data-test="dashboard-add-z-data"
                  >
                    <div>+Z</div>
                  </q-btn>
                  <q-btn
                    padding="sm"
                    @click="addFilteredItem(props.row.name)"
                    data-test="dashboard-add-filter-data"
                  >
                    <div>+F</div>
                  </q-btn>
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >=
                          dashboardPanelData.meta.stream.customQueryFields
                            .length)
                    ) && dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type == 'geomap'
                  "
                >
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.latitude != null
                    "
                    no-caps
                    padding="sm"
                    @click="addLatitude(props.row)"
                    data-test="dashboard-add-latitude-data"
                  >
                    <div>+Lat</div>
                  </q-btn>
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.longitude != null
                    "
                    no-caps
                    padding="sm"
                    @click="addLongitude(props.row)"
                    data-test="dashboard-add-longitude-data"
                  >
                    <div>+Lng</div>
                  </q-btn>
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.weight != null
                    "
                    padding="sm"
                    @click="addWeight(props.row)"
                    data-test="dashboard-add-weight-data"
                  >
                    <div>+W</div>
                  </q-btn>
                  <q-btn
                    padding="sm"
                    @click="addFilteredItem(props.row.name)"
                    data-test="dashboard-add-filter-geomap-data"
                  >
                    <div>+F</div>
                  </q-btn>
                </div>
                <div
                  class="field_icons"
                  v-if="
                    !(
                      promqlMode ||
                      (dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery &&
                        props.pageIndex >=
                          dashboardPanelData.meta.stream.customQueryFields
                            .length)
                    ) && dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].type == 'sankey'
                  "
                >
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.source != null
                    "
                    no-caps
                    padding="sm"
                    @click="addSource(props.row)"
                    data-test="dashboard-add-source-data"
                  >
                    <div>+S</div>
                  </q-btn>
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.target != null
                    "
                    no-caps
                    padding="sm"
                    @click="addTarget(props.row)"
                    data-test="dashboard-add-target-data"
                  >
                    <div>+T</div>
                  </q-btn>
                  <q-btn
                    :disabled="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields?.value != null
                    "
                    padding="sm"
                    @click="addValue(props.row)"
                    data-test="dashboard-add-value-data"
                  >
                    <div>+V</div>
                  </q-btn>
                  <q-btn
                    padding="sm"
                    @click="addFilteredItem(props.row.name)"
                    data-test="dashboard-add-filter-sankey-data"
                  >
                    <div>+F</div>
                  </q-btn>
                </div>
              </div>
            </q-td>
          </q-tr>
        </template>
        <template #top-right>
          <q-input
            v-model="dashboardPanelData.meta.stream.filterField"
            data-test="index-field-search-input"
            filled
            borderless
            dense
            clearable
            debounce="1"
            :loading="getStreamFields.isLoading.value"
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
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { useLoading } from "@/composables/useLoading";
import useStreams from "@/composables/useStreams";

export default defineComponent({
  name: "FieldList",
  props: ["selectedXAxisValue", "selectedYAxisValue", "editMode"],
  emits: ["update:selectedXAxisValue", "update:selectedYAxisValue"],
  setup(props) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const data = reactive<any>({
      schemaList: [],
      indexOptions: [],
      streamType: ["logs", "metrics", "traces"],
      currentFieldsList: [],
    });
    const filteredStreams = ref([]);
    const $q = useQuasar();
    const {
      dashboardPanelData,
      addXAxisItem,
      addYAxisItem,
      addZAxisItem,
      addFilteredItem,
      isAddXAxisNotAllowed,
      isAddYAxisNotAllowed,
      isAddZAxisNotAllowed,
      promqlMode,
      addLatitude,
      addLongitude,
      addWeight,
      addSource,
      addTarget,
      addValue,
      cleanupDraggingFields,
    } = useDashboardPanelData();
    const { getStreams, getStream } = useStreams();

    const onDragEnd = () => {
      cleanupDraggingFields();
    };

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
          ].fields.stream
      )?.metrics_meta?.metric_type;
    });

    // get stream list
    const streamDataLoading = useLoading(async (stream_type: any) => {
      await getStreamList(stream_type);
    });

    // get the stream list based on the selected stream type
    const loadStreamsListBasedOnType = async () => {
      streamDataLoading.execute(
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type
      );
    };

    // watch the stream type and load the stream list
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      async () => {
        loadStreamsListBasedOnType();
      }
    );

    onMounted(() => {
      loadStreamsListBasedOnType();
    });

    const getStreamFields = useLoading(
      async (fieldName: string, streamType: string) => {
        return await getStream(fieldName, streamType, true);
      }
    );

    // update the selected stream fields list
    watch(
      () => [
        data.schemaList,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      ],
      async () => {
        // get the selected stream fields based on the selected stream type
        const fields: any = data.schemaList.find(
          (it: any) =>
            it.name ==
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream &&
            it.stream_type ==
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream_type
        );

        // if fields found
        if (fields) {
          try {
            // get schema of that field using getstream
            const fieldWithSchema: any = await getStreamFields.execute(
              fields.name,
              fields.stream_type,
              true
            );

            // below line required for pass by reference
            // if we don't set blank, then same object from cache is being set
            // and that doesn't call the watchers,
            // so it will not be updated when we switch to different chart types
            // which doesn't have field list and coming back to field list
            dashboardPanelData.meta.stream.selectedStreamFields = [];
            // assign the schema
            dashboardPanelData.meta.stream.selectedStreamFields =
              fieldWithSchema?.schema ?? [];
          } catch (error: any) {
            $q.notify({
              type: "negative",
              message: error ?? "Failed to get stream fields",
            });
          }
        }
      }
    );
    const selectedStreamForQueries: any = ref({});

    // Watch for changes in the current query selected stream
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream,
      (newStream) => {
        selectedStreamForQueries.value[
          dashboardPanelData.layout.currentQueryIndex
        ] = newStream;
      }
    );

    watch(
      () => [
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
        dashboardPanelData.meta.stream.streamResults,
      ],
      () => {
        if (!props.editMode) {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream = "";
        }

        data.indexOptions = dashboardPanelData.meta.stream.streamResults.filter(
          (data: any) =>
            data.stream_type ==
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type
        );

        // set the first stream as the selected stream when the api loads the data
        if (
          // !props.editMode &&
          // !dashboardPanelData.data.queries[
          //   dashboardPanelData.layout.currentQueryIndex
          // ].fields.stream &&
          data.indexOptions.length > 0
        ) {
          const currentIndex = dashboardPanelData.layout.currentQueryIndex;
          // Check if selected stream for current query exists in index options
          // If not, set the first index option as the selected stream
          if (
            selectedStreamForQueries.value[currentIndex] &&
            data.indexOptions.find(
              (it: any) =>
                it.name == selectedStreamForQueries.value[currentIndex]
            )
          ) {
            dashboardPanelData.data.queries[currentIndex].fields.stream =
              selectedStreamForQueries.value[currentIndex];
          } else {
            dashboardPanelData.data.queries[currentIndex].fields.stream =
              data.indexOptions[0]?.name;
          }
        }
      }
    );
    // update the current list fields if any of the lists changes
    watch(
      () => [
        dashboardPanelData.meta.stream.selectedStreamFields,
        dashboardPanelData.meta.stream.customQueryFields,
      ],
      () => {
        data.currentFieldsList = [];
        data.currentFieldsList = [
          ...dashboardPanelData.meta.stream.customQueryFields,
          ...dashboardPanelData.meta.stream.selectedStreamFields,
        ];
      }
    );

    // get the stream list by making an API call
    const getStreamList = async (stream_type: any) => {
      await getStreams(stream_type, false).then((res: any) => {
        data.schemaList = res.list;
        // below line required for pass by reference
        // if we don't set blank, then same object from cache is being set
        // and that doesn't call the watchers,
        // so it will not be updated when we switch to different chart types
        // which doesn't have field list and coming back to field list
        dashboardPanelData.meta.stream.streamResults = [];

        dashboardPanelData.meta.stream.streamResults = res.list;
      });
    };
    const filterFieldFn = (rows: any, terms: any) => {
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

    const mutationHandler = (mutationRecords: any) => {};

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
        filteredStreams.value = data.indexOptions.filter((stream: any) => {
          return stream.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
        });
      });
    };

    return {
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
      addLatitude,
      addLongitude,
      addWeight,
      addSource,
      addTarget,
      addValue,
      addFilteredItem,
      data,
      getStreamList,
      getStreamFields,
      dashboardPanelData,
      filterStreamFn,
      filteredStreams,
      isAddXAxisNotAllowed,
      isAddYAxisNotAllowed,
      isAddZAxisNotAllowed,
      promqlMode,
      streamDataLoading,
      metricsIconMapping,
      selectedMetricTypeIcon,
      onDragEnd,
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
        padding: 0 0 0 0.25rem;
        transition: all 0.3s ease;
        // background-color: white;
        position: absolute;
        z-index: 3;
        opacity: 0;
        right: 0;

        .q-icon {
          cursor: pointer;
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
</style>
