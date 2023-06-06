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
    <div>
      <q-select
        v-model="dashboardPanelData.data.fields.stream_type"
        :label="t('dashboard.selectStreamType')"
        :options="data.streamType"
        data-cy="index-dropdown"
        input-debounce="0"
        behavior="menu"
        filled
        borderless
        dense
        class="q-mb-xs"
      ></q-select>
      <q-select
        v-model="dashboardPanelData.data.fields.stream"
        :label="t('dashboard.selectIndex')"
        :options="filteredStreams"
        data-cy="index-dropdown"
        input-debounce="0"
        behavior="menu"
        use-input
        filled
        borderless
        dense
        hide-selected
        fill-input
        @filter="filterStreamFn"
      >
        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
    <div class="index-table q-mt-xs">
      <q-table
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
              :style="props.pageIndex == dashboardPanelData.meta.stream.customQueryFields.length ? 'border: 1px solid black' : ''"
            >
              <div class="field_overlay" :title="props.row.name">
                <div
                  class="field_label"
                  draggable="true"
                  @dragstart="onDragStart($event, props.row)"
                >
                  <q-icon
                    name="drag_indicator"
                    color="grey-13"
                    class="drag_indicator q-mr-xs"
                    v-if="!promqlMode"
                  />

                  <q-icon
                    :name="props.row.type == 'Utf8'? 'text_fields' : props.row.type == 'Int64'? 'tag' : 'toggle_off'"
                    color="grey-6"
                    class="q-mr-xs"
                  />
                  {{ props.row.name }}
                </div>
                <div class="field_icons" v-if="!promqlMode">
                  <q-btn
                    color="white"
                    padding="sm"
                    text-color="black"
                    :disabled="isAddXAxisNotAllowed"
                    @click="addXAxisItem(props.row)"
                  >
                    <div>
                      {{
                        dashboardPanelData.data.type != "h-bar" ? "+X" : "+Y"
                      }}
                    </div>
                  </q-btn>
                  <q-btn
                    color="white"
                    padding="sm"
                    text-color="black"
                    :disabled="isAddYAxisNotAllowed"
                    @click="addYAxisItem(props.row)"
                  >
                    <div>
                      {{
                        dashboardPanelData.data.type != "h-bar" ? "+Y" : "+X"
                      }}
                    </div>
                  </q-btn>
                  <q-btn
                    color="white"
                    padding="sm"
                    text-color="black"
                    @click="addFilteredItem(props.row.name)"
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
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, onActivated, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import IndexService from "../../../services/index";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  props: ["selectedXAxisValue", "selectedYAxisValue", 'editMode'],
  emits: ["update:selectedXAxisValue", "update:selectedYAxisValue"],
  setup(props) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const data = reactive({
      schemaList: [],
      indexOptions: [],
      streamType: ["logs", "metrics", "traces"],
      currentFieldsList: [],
    });
    const filteredStreams = ref([]);
    const $q = useQuasar();
    const { dashboardPanelData, addXAxisItem, addYAxisItem, addFilteredItem, isAddXAxisNotAllowed, isAddYAxisNotAllowed, promqlMode } =
      useDashboardPanelData();

    onActivated(() => {
      getStreamList();
    });

    // update the selected stream fields list
    watch(
      () => [data.schemaList, dashboardPanelData.data.fields.stream, dashboardPanelData.data.fields.stream_type],
      () => {
        console.log("stream:", dashboardPanelData.data.fields.stream);
        
        const fields: any = data.schemaList.find(
          (it: any) => it.name == dashboardPanelData.data.fields.stream
        );
        dashboardPanelData.meta.stream.selectedStreamFields =
          fields?.schema || [];
      }
    );

    watch(()=> [dashboardPanelData.data.fields.stream_type, dashboardPanelData.meta.stream.streamResults], ()=> {
      
        if(!props.editMode){
          dashboardPanelData.data.fields.stream = ""
        }
      
        data.indexOptions = dashboardPanelData.meta.stream.streamResults
          .filter((data: any) => data.stream_type == dashboardPanelData.data.fields.stream_type)
          .map((data: any) => {
            return data.name;
          });

        // set the first stream as the selected stream when the api loads the data
        if (!props.editMode &&
          !dashboardPanelData.data.fields.stream &&
          data.indexOptions.length > 0
        ) {
          dashboardPanelData.data.fields.stream = data.indexOptions[0];
        }
    })

    // update the current list fields if any of the lists changes
    watch(
      () => [
        dashboardPanelData.meta.stream.selectedStreamFields,
        dashboardPanelData.meta.stream.customQueryFields,
      ],
      () => {
        console.log("updated custom query fields or selected stream fields");

        data.currentFieldsList = [];
        data.currentFieldsList = [
          ...dashboardPanelData.meta.stream.customQueryFields,
          ...dashboardPanelData.meta.stream.selectedStreamFields,
        ];
      }
    );

    // get the stream list by making an API call
    const getStreamList = () => {
      IndexService.nameList(
        store.state.selectedOrganization.identifier,
        "",
        true
      ).then((res) => {
        data.schemaList = res.data.list;
        dashboardPanelData.meta.stream.streamResults = res.data.list;
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
    };

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        filteredStreams.value = data.indexOptions.filter(
          (streamName: any) =>
            streamName.toLowerCase().indexOf(val.toLowerCase()) > -1
        );
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
      addFilteredItem,
      data,
      getStreamList,
      dashboardPanelData,
      filterStreamFn,
      filteredStreams,
      isAddXAxisNotAllowed,
      isAddYAxisNotAllowed,
      promqlMode
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
        background-color: white;
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
        box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

        .field_icons {
          background-color: white;
          opacity: 1;
        }
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
