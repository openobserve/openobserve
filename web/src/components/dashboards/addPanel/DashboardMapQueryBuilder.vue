<!-- Copyright 2023 Zinc Labs Inc.

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
  <div v-if="!promqlMode && dashboardPanelData.data.type == 'geomap'">
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
      <div class="layout-name">{{ t('panel.latitude') }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
          {{ Hint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div class="axis-container droppable scroll q-py-xs" :class="{
        'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
        'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'latitude'
      }" @dragenter="onDragEnter($event, 'latitude')" @dragleave="onDragLeave($event, 'latitude')"
        @dragover="onDragOver($event, 'latitude')" @drop="onDrop($event, 'latitude')" v-mutation="handler2"
        data-test="dashboard-x-layout">
        <q-btn-group class="q-mr-sm" v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.latitude">
          <q-btn icon-right="arrow_drop_down" no-caps color="primary" dense rounded size="sm" :label="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.latitude?.column"
            class="q-pl-sm" :data-test="`dashboard-x-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.latitude?.column}`">
            <q-menu class="q-pa-md" :data-test="`dashboard-x-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.latitude?.column}-menu`">
              <div>
                <!-- <div class="">
                  <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery"
                    class="q-mr-xs q-mb-sm">
                    <q-select v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index]
                      .aggregationFunction
                      " :options="triggerOperatorsWithHistogram" dense filled emit-value
                      map-options label="Aggregation" data-test="dashboard-x-item-dropdown">
                      <template v-slot:append>
                        <q-icon name="close" size="small"
                          @click.stop.prevent="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index].aggregationFunction = null"
                          class="cursor-pointer" />
                      </template>
                    </q-select>
                  </div>
                </div> -->
                <q-input dense filled data-test="dashboard-x-item-input" label="Label" v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.latitude.label"
                   :rules="[val => val > 0 || 'Required']" />
              </div>
            </q-menu>
          </q-btn>
          <q-btn size="xs" round flat dense :data-test="`dashboard-x-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.latitude?.column}-remove`"
            @click="removeLatitude()" icon="close" />
        </q-btn-group>
        <div class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.latitude == null">
          {{ Hint }}
        </div>
      </div>

    </div>
    <q-separator />
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
      <div class="layout-name">{{ t('panel.longitude') }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
            {{ Hint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div class="axis-container droppable scroll q-py-xs" :class="{
        'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
        'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'longitude'
      }" @dragenter="onDragEnter($event, 'longitude')" @dragleave="onDragLeave($event, 'longitude')"
        @dragover="onDragOver($event, 'longitude')" @drop="onDrop($event, 'longitude')" v-mutation="handler2"
        data-test="dashboard-y-layout">
        <q-btn-group class="q-mr-sm" v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.longitude">
          <q-btn icon-right="arrow_drop_down" no-caps dense color="primary" rounded size="sm" :label="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.longitude?.column"
            :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.longitude?.column}`" class="q-pl-sm">
            <q-menu class="q-pa-md" :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.longitude?.column}-menu`">
              <div>
                <!-- <div class="row q-mb-sm" style="align-items: center;">
                  <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery"
                    class="q-mr-xs" style="width: 160px">
                    <q-select v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index]
                      .aggregationFunction
                      "
                      :options="dashboardPanelData.data.type == 'heatmap' ? triggerOperatorsWithHistogram : triggerOperators"
                      dense filled emit-value map-options label="Aggregation" data-test="dashboard-y-item-dropdown">
                      <template v-slot:append>
                        <div v-if="dashboardPanelData.data.type == 'heatmap'">
                          <q-icon name="close" size="small"
                            @click.stop.prevent="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index].aggregationFunction = null"
                            class="cursor-pointer" />
                        </div>
                      </template>
                    </q-select>
                  </div>
                  <div class="color-input-wrapper" v-if="!['table', 'pie'].includes(dashboardPanelData.data.type)">
                    <input type="color" data-test="dashboard-y-item-color" v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index]
                      .color
                      " />
                  </div>
                </div> -->
                <q-input dense filled label="Label" data-test="dashboard-y-item-input" v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.longitude.label"
                   :rules="[val => val > 0 || 'Required']" />
              </div>
            </q-menu>
          </q-btn>
          <q-btn size="xs" round flat dense :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.longitude?.column}-remove`"
            @click="removeLongitude()" icon="close" />
        </q-btn-group>
        <div class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.longitude == null">
          {{ Hint }}
        </div>
      </div>
    </div>
    <q-separator />
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
        <div class="layout-name">{{ t('panel.weight') }}
          <q-icon name="info_outline" class="q-ml-xs">
            <q-tooltip>
              {{ Hint }}
            </q-tooltip>
          </q-icon>
        </div>
        <span class="layout-separator">:</span>
        <div class="axis-container droppable scroll q-py-xs" :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'weight'
        }" @dragenter="onDragEnter($event, 'weight')" @dragleave="onDragLeave($event, 'weight')"
          @dragover="onDragOver($event, 'weight')" @drop="onDrop($event, 'weight')" v-mutation="handler2"
          data-test="dashboard-y-layout">
          <q-btn-group class="q-mr-sm" v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.weight">
            <q-btn icon-right="arrow_drop_down" no-caps dense color="primary" rounded size="sm" :label="weightLabel"
              :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.weight?.column}`" class="q-pl-sm">
              <q-menu class="q-pa-md" :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.weight?.column}-menu`">
                <div>
                  <div class="row q-mb-sm" style="align-items: center;">
                    <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery"
                      class="q-mr-xs" style="width: 160px">
                      <q-select v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight
                        .aggregationFunction
                        "
                        :options="triggerOperators"
                        dense filled emit-value map-options label="Aggregation" data-test="dashboard-y-item-dropdown">
                        <template v-slot:append>
                            <q-icon name="close" size="small"
                              @click.stop.prevent="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight.aggregationFunction = null"
                              class="cursor-pointer" />
                        </template>
                      </q-select>
                    </div>
                  </div>
                  <q-input dense filled label="Label" data-test="dashboard-y-item-input" v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight.label" 
                      :rules="[val => val > 0 || 'Required']" />
                </div>
              </q-menu>
            </q-btn>
            <q-btn size="xs" round flat dense :data-test="`dashboard-y-item-${dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields?.weight?.column}-remove`"
              @click="removeWeight()" icon="close" />
          </q-btn-group>
          <div class="text-caption text-weight-bold text-center q-mt-xs"
            v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight == null">
            {{ Hint }}
          </div>
        </div>
      </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";

export default defineComponent({
  name: "DashboardMapQueryBuilder",
  components: {},
  setup() {
    // const showXAxis = ref(true);
    // const panelName = ref("");
    // const panelDesc = ref("");
    const { t } = useI18n();
    const expansionItems = reactive({
      latitude: true,
      longitude: true,
      weight: true,
    })

    const {
      dashboardPanelData,
      addLatitude,
      addLongitude,
      addWeight,
      removeLatitude,
      removeLongitude,
      removeWeight,
      addFilteredItem,
      loadFilterItem,
      promqlMode, 
    } = useDashboardPanelData();
    const triggerOperators = [
      { label: "Count", value: "count" },
      { label: "Count (Distinct)", value: "count-distinct" },
      { label: "Sum", value: "sum" },
      { label: "Avg", value: "avg" },
      { label: "Min", value: "min" },
      { label: "Max", value: "max" },
    ]
    // const triggerOperatorsWithHistogram: any = [{ label: "Histogram", value: "histogram" }]

    watch(() => dashboardPanelData.meta.dragAndDrop.dragging, (newVal: boolean, oldVal: boolean) => {
      if (oldVal == false && newVal == true) {
        expansionItems.latitude = true
        expansionItems.longitude = true
        expansionItems.weight = true
      }
    })

    const currentDragArea = ref('')

    const onDrop = (e: any, area: string) => {

      const dragItem: any = dashboardPanelData.meta.dragAndDrop.dragElement

      dashboardPanelData.meta.dragAndDrop.dragging = false
      dashboardPanelData.meta.dragAndDrop.dragElement = null

      if (dragItem && area == 'latitude') {
        addLatitude(dragItem)
      } else if (dragItem && area == 'longitude') {
        addLongitude(dragItem)
      } else if (dragItem && area == 'weight') {
        addWeight(dragItem)
      } else {

      }
      currentDragArea.value = ''
    }


    const onDragEnter = (e: any, area: string) => {

      // // don't drop on other draggables
      // if (e.target.draggable !== true) {
      //   e.target.classList.add('drag-enter')
      // }
    }

    const onDragStart = (e: any, item: any) => {
      e.preventDefault()
    }

    const onDragLeave = (e: any, area: string) => {
      currentDragArea.value = ''

      e.preventDefault()
    }

    const onDragOver = (e: any, area: string) => {
      currentDragArea.value = area
      e.preventDefault()
    }

    const handler2 = () => { }

    const Hint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case 'geomap':
          return "Add 1 field here"
        default:
          return "Add maximum 2 fields here";
      }
    })

    const commonBtnLabel = (field: any) => {
      if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery) {
        return field.column
      }
      if (field.aggregationFunction) {
        const aggregation = field.aggregationFunction.toUpperCase();
        return `${aggregation}(${field.column})`;
      } else {
        return field.column;
      }
    };

    const weightLabel = computed(() => {
      const weightField = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.weight;
      return commonBtnLabel(weightField);
    });

    return {
      // showXAxis,
      t,
      // panelName,
      // panelDesc,
      dashboardPanelData,
      removeLatitude,
      removeLongitude,
      removeWeight,
      loadFilterItem,
      triggerOperators,
      pagination: ref({
        rowsPerPage: 0,
      }),
      model: ref([]),
      tab: ref("General"),
      // options: ["=", "<>", ">=", "<=", ">", "<", "Contains", "Not Contains", 'Is Null', 'Is Not Null'],
      getImageURL,
      onDrop,
      onDragStart,
      onDragLeave,
      onDragOver,
      onDragEnter,
      handler2,
      currentDragArea,
      expansionItems,
      // triggerOperatorsWithHistogram,
      Hint,
      promqlMode,
      // xLabel,
      // yLabel,
      weightLabel,
    };
  },
});
</script>

<style lang="scss" scoped>
.axis-container {
  flex: 1;
  width: 100%;
  white-space: nowrap;
  overflow-x: auto;
}

.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}

.layout-name {
  white-space: nowrap;
  min-width: 130px;
  display: flex;
  align-items: center;
}

.droppable {
  border-color: transparent;
  border-style: dashed;
  border-width: 2px;
}

.drop-target {
  background-color: rgba(0, 0, 0, 0.042);
  border-color: white;
  border-style: dotted;
}

.drop-entered {
  background-color: #b8b8b8;
}

.color-input-wrapper {
  height: 1.5em;
  width: 1.5em;
  overflow: hidden;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  position: relative;
}

.color-input-wrapper input[type="color"] {
  position: absolute;
  height: 4em;
  width: 4em;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
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
    text-transform: capitalize;
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

    .q-table__top {
      padding: 0px;
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

    .field_overlay {
      justify-content: space-between;
      background-color: transparent;
      transition: all 0.3s ease;
      padding: 0px 10px;
      align-items: center;
      position: absolute;
      // line-height: 2rem;
      overflow: hidden;
      inset: 0;
      display: flex;
      z-index: 1;
      width: 100%;
      border-radius: 0px;
      height: 25px;

      .field_icons {
        padding: 0 0.625rem 0 0.25rem;
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
        pointer-events: none;
        font-size: 0.825rem;
        position: relative;
        display: inline;
        z-index: 2;
        left: 0;
        // text-transform: capitalize;
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
  // color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused>.q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused>.q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused>.q-focus-helper,
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