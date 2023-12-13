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
  <div v-if="!promqlMode && dashboardPanelData.data.type == 'geomap'">
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">
        {{ t("panel.latitude") }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
            {{ Hint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll q-pt-xs"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            currentDragArea == 'latitude',
        }"
        @dragenter="onDragEnter($event, 'latitude')"
        @dragleave="onDragLeave($event, 'latitude')"
        @dragover="onDragOver($event, 'latitude')"
        @drop="onDrop($event, 'latitude')"
        v-mutation="handler2"
        data-test="dashboard-x-layout"
      >
        <q-btn-group
          class="q-mr-sm q-mb-sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.latitude
          "
        >
        <div
          :draggable="true"
          @dragstart="onFieldDragStart($event, dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.latitude.column, 'latitude')"
        >
          <q-icon
            name="drag_indicator"
            color="grey-13"
            class="'q-mr-xs'"
          />
          <q-btn
            icon-right="arrow_drop_down"
            no-caps
            color="primary"
            dense
            rounded
            size="sm"
            :label="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.latitude?.column
            "
            class="q-pl-sm"
            :data-test="`dashboard-x-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.latitude?.column
            }`"
          >
            <q-menu
              class="q-pa-md"
              :data-test="`dashboard-x-item-${
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.latitude?.column
              }-menu`"
            >
              <div>
                <q-input
                  dense
                  filled
                  data-test="dashboard-x-item-input"
                  :label="t('common.label')"
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.latitude.label
                  "
                  :rules="[(val) => val > 0 || 'Required']"
                />
                <div
                  v-if="
                    !dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery && dashboardPanelData.data.queryType == 'sql'
                  "
                >
                  <SortByBtnGrp
                    :fieldObj="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields.latitude
                    "
                  />
                </div>
              </div>
            </q-menu>
          </q-btn>
          <q-btn
            size="xs"
            round
            flat
            dense
            :data-test="`dashboard-x-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.latitude?.column
            }-remove`"
            @click="removeLatitude()"
            icon="close"
          />
        </div>
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.latitude == null
          "
        >
          {{ Hint }}
        </div>
      </div>
    </div>
    <q-separator />
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">
        {{ t("panel.longitude") }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
            {{ Hint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll q-pt-xs"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            currentDragArea == 'longitude',
        }"
        @dragenter="onDragEnter($event, 'longitude')"
        @dragleave="onDragLeave($event, 'longitude')"
        @dragover="onDragOver($event, 'longitude')"
        @drop="onDrop($event, 'longitude')"
        v-mutation="handler2"
        data-test="dashboard-y-layout"
      >
        <q-btn-group
          class="q-mr-sm q-mb-sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.longitude
          "
        >
        <div
          :draggable="true"
          @dragstart="onFieldDragStart($event, dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.longitude.column, 'longitude')"
        >
        <q-icon
          name="drag_indicator"
          color="grey-13"
          class="'q-mr-xs'"
        />
          <q-btn
            icon-right="arrow_drop_down"
            no-caps
            dense
            color="primary"
            rounded
            size="sm"
            :label="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.longitude?.column
            "
            :data-test="`dashboard-y-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.longitude?.column
            }`"
            class="q-pl-sm"
          >
            <q-menu
              class="q-pa-md"
              :data-test="`dashboard-y-item-${
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.longitude?.column
              }-menu`"
            >
              <div>
                <q-input
                  dense
                  filled
                  label="Label"
                  data-test="dashboard-y-item-input"
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.longitude.label
                  "
                  :rules="[(val) => val > 0 || 'Required']"
                />
                <div
                  v-if="
                    !dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery && dashboardPanelData.data.queryType == 'sql'
                  "
                >
                  <SortByBtnGrp
                    :fieldObj="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields.longitude
                    "
                  />
                </div>
              </div>
            </q-menu>
          </q-btn>
          <q-btn
            size="xs"
            round
            flat
            dense
            :data-test="`dashboard-y-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.longitude?.column
            }-remove`"
            @click="removeLongitude()"
            icon="close"
          />
          </div>
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.longitude == null
          "
        >
          {{ Hint }}
        </div>
      </div>
    </div>
    <q-separator />
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">
        {{ t("panel.weight") }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
            {{ WeightHint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll q-pt-xs"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            currentDragArea == 'weight',
        }"
        @dragenter="onDragEnter($event, 'weight')"
        @dragleave="onDragLeave($event, 'weight')"
        @dragover="onDragOver($event, 'weight')"
        @drop="onDrop($event, 'weight')"
        v-mutation="handler2"
        data-test="dashboard-y-layout"
      >
        <q-btn-group
          class="q-mr-sm q-mb-sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.weight
          "
        >
        <div
          :draggable="true"
          @dragstart="onFieldDragStart($event, dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.weight.column, 'weight')"
        >
        <q-icon
          name="drag_indicator"
          color="grey-13"
          class="'q-mr-xs'"
        />
          <q-btn
            icon-right="arrow_drop_down"
            no-caps
            dense
            color="primary"
            rounded
            size="sm"
            :label="weightLabel"
            :data-test="`dashboard-y-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.weight?.column
            }`"
            class="q-pl-sm"
          >
            <q-menu
              class="q-pa-md"
              :data-test="`dashboard-y-item-${
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.weight?.column
              }-menu`"
            >
              <div>
                <div class="row q-mb-sm" style="align-items: center">
                  <div
                    v-if="
                      !dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery
                    "
                    class="q-mr-xs"
                    style="width: 160px"
                  >
                    <q-select
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.weight.aggregationFunction
                      "
                      :options="triggerOperators"
                      dense
                      filled
                      emit-value
                      map-options
                      :label="t('common.aggregation')"
                      data-test="dashboard-y-item-dropdown"
                    >
                      <template v-slot:append>
                        <q-icon
                          name="close"
                          size="small"
                          @click.stop.prevent="
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].fields.weight.aggregationFunction = null
                          "
                          class="cursor-pointer"
                        />
                      </template>
                    </q-select>
                  </div>
                </div>
                <q-input
                  dense
                  filled
                  :label="t('common.label')"
                  data-test="dashboard-y-item-input"
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.weight.label
                  "
                  :rules="[(val) => val > 0 || 'Required']"
                />
                <div
                  v-if="
                    !dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery && dashboardPanelData.data.queryType == 'sql'
                  "
                >
                  <SortByBtnGrp
                    :fieldObj="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields.weight
                    "
                  />
                </div>
              </div>
            </q-menu>
          </q-btn>
          <q-btn
            size="xs"
            round
            flat
            dense
            :data-test="`dashboard-y-item-${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.weight?.column
            }-remove`"
            @click="removeWeight()"
            icon="close"
          />
          </div>
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.weight == null
          "
        >
          {{ WeightHint }}
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
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "DashboardMapQueryBuilder",
  components: { SortByBtnGrp },
  setup() {
    const { t } = useI18n();
    const $q = useQuasar();
    const expansionItems = reactive({
      latitude: true,
      longitude: true,
      weight: true,
    });

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
      { label: t("dashboard.count"), value: "count" },
      { label: t("dashboard.countDistinct"), value: "count-distinct" },
      { label: t("dashboard.sum"), value: "sum" },
      { label: t("dashboard.avg"), value: "avg" },
      { label: t("dashboard.min"), value: "min" },
      { label: t("dashboard.max"), value: "max" },
    ];

    watch(
      () => dashboardPanelData.meta.dragAndDrop.dragging,
      (newVal: boolean, oldVal: boolean) => {
        if (oldVal == false && newVal == true) {
          expansionItems.latitude = true;
          expansionItems.longitude = true;
          expansionItems.weight = true;
        }
      }
    );

    const currentDragArea = ref("");

    const onDrop = (e: any, area: string) => {
      console.log(e, area,"map");
      
      if (dashboardPanelData.meta.dragAndDrop.dragElementType == "fieldList") {
      const dragItem: any = dashboardPanelData.meta.dragAndDrop.dragElement;
        console.log(dragItem,"dragItem");
        
      dashboardPanelData.meta.dragAndDrop.dragging = false;
      dashboardPanelData.meta.dragAndDrop.dragElement = null;
      dashboardPanelData.meta.dragAndDrop.dragElementType = null;
      if (dragItem && area == "latitude") {
        addLatitude(dragItem);
      } else if (dragItem && area == "longitude") {
        addLongitude(dragItem);
      } else if (dragItem && area == "weight") {
        addWeight(dragItem);
      }
      currentDragArea.value = "";
    } else if(dashboardPanelData.meta.dragAndDrop.dragElementType == "fieldElement"){
      const dragItem: any = dashboardPanelData.meta.dragAndDrop.dragElement;
      console.log(dragItem,"dragItem");
      
      dashboardPanelData.meta.dragAndDrop.dragging = false;
      dashboardPanelData.meta.dragAndDrop.dragElement = null;
      dashboardPanelData.meta.dragAndDrop.dragElementType = null;
        
      const dragName = dashboardPanelData.meta.stream.selectedStreamFields.find(
          (item: any) => {
            return item.name == dragItem;
          }
        );

        if(dragName) {

          const currentQueryField = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields;

          if( area == "latitude" && currentQueryField.latitude) {
            console.log("Dragging not allowed in 'latitude' axis.");
            $q.notify({
              type: "negative",
              message: "Max 1 field in 'latitude' is allowed.",
              timeout: 5000,
            });
            return;
          }

          if (area == "longitude" && currentQueryField.longitude) {
            console.log("Dragging not allowed in 'longitude' axis.");
            $q.notify({
              type: "negative",
              message: "Max 1 field in 'longitude' is allowed.",
              timeout: 5000,
            });
            return;
          }

          if (area == "weight" && currentQueryField.weight) {
            console.log("Dragging not allowed in 'weight' axis.");
            $q.notify({
              type: "negative",
              message: "Max 1 field in 'weight' is allowed.",
              timeout: 5000,
            });
            return;
          }

          if(onLeave.value == "latitude") {
            console.log(onLeave.value,"onLeave lat");
            
            removeLatitude();
          } else if(onLeave.value == "longitude") {
            console.log(onLeave.value,"onLeave long");
            
            removeLongitude();
          } else if(onLeave.value == "weight") {
            console.log(onLeave.value,"onLeave weight");
            removeWeight();
          }

          if(area == "latitude") {
            console.log(area,"area lat");
            
            addLatitude(dragName);
          } else if(area == "longitude") {
            console.log(area,"area long");
            addLongitude(dragName);
          } else if(area == "weight") {
            console.log(area,"area weight");
            addWeight(dragName);
          }
        } else{
        }
        currentDragArea.value = "";
    }
  }

    const onDragEnter = (e: any, area: string) => {};

    const onDragStart = (e: any, item: any) => {
      e.preventDefault();
    };

    const onDragLeave = (e: any, area: string) => {
      currentDragArea.value = "";

      e.preventDefault();
    };

    const onDragOver = (e: any, area: string) => {
      currentDragArea.value = area;
      e.preventDefault();
    };

    const onLeave = ref("");
     
    const onFieldDragStart = (e: any, item: any, axis: string) => {
      console.log("onFieldDragStart item", item);
      onLeave.value = axis;

      dashboardPanelData.meta.dragAndDrop.dragging = true;
      dashboardPanelData.meta.dragAndDrop.dragElement = item;
      dashboardPanelData.meta.dragAndDrop.dragElementType = "fieldElement";
      console.log("onFieldDragStart", dashboardPanelData.meta.dragAndDrop.dragElement);
      console.log("onFieldDragStart", dashboardPanelData.meta.dragAndDrop.dragging);
      console.log("onFieldDragStart", dashboardPanelData.meta.dragAndDrop.dragElementType);

      // dashboardPanelData.meta.dragAndDrop.dragStartIndex = index;
    };

    const handler2 = () => {};

    const Hint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case "geomap":
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const WeightHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case "geomap":
          return t("dashboard.oneFieldConfigMessage");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const commonBtnLabel = (field: any) => {
      if (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
      ) {
        return field.column;
      }
      if (field.aggregationFunction) {
        const aggregation = field.aggregationFunction.toUpperCase();
        return `${aggregation}(${field.column})`;
      } else {
        return field.column;
      }
    };

    const weightLabel = computed(() => {
      const weightField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.weight;
      return commonBtnLabel(weightField);
    });

    return {
      t,
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
      getImageURL,
      onDrop,
      onDragStart,
      onDragLeave,
      onDragOver,
      onDragEnter,
      handler2,
      currentDragArea,
      expansionItems,
      Hint,
      WeightHint,
      promqlMode,
      weightLabel,
      onFieldDragStart
    };
  },
});
</script>

<style lang="scss" scoped>
.axis-container {
  flex: 1;
  width: 100%;
  // white-space: nowrap;
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
