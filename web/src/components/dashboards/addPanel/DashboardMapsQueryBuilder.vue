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
  <div v-if="!promqlMode && dashboardPanelData.data.type == 'maps'">
    <!-- name container -->
    <div style="display: flex; flex-direction: row" class="tw:pl-3">
      <div class="layout-name">
        {{ t("panel.mapname") }}
        <OIcon name="info-outline" size="sm" class="tw:ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'name',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'name')"
        @drop="onDrop($event, 'name')"
        @dragenter="onDragEnter($event, 'name', null)"
        data-test="dashboard-name-layout"
      >
        <OButtonGroup
          class="axis-field tw:mr-2 tw:my-1"
          radius="sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.name
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.name,
              'name',
            )
          "
        >
          <OButton
            variant="outline"
            size="icon-chip"
            class="cursor-grab"
            :data-test="`dashboard-name-item-${nameLabel}-drag`"
          >
            <template #icon-left>
              <OIcon name="drag-indicator" size="xs" />
            </template>
          </OButton>
          <ODropdown>
            <template #trigger>
              <OButton
                variant="primary"
                size="chip-12"
                :data-test="`dashboard-name-item-${nameLabel}`"
              >
                {{ nameLabel }}
                <template #icon-right
                  ><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-maps-query-builder-dropdown"
              :data-test="`dashboard-name-item-${nameLabel}-menu`"
            >
              <div
                style="padding: 3px 16px 16px 16px"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.name.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="tw:mr-1 tw:mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.name
                      "
                      :allowAggregation="false"
                      :customQuery="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ODropdown>
          <OButton
            variant="outline"
            size="icon-chip"
            :data-test="`dashboard-name-item-${nameLabel}-remove`"
            @click="removeMapName()"
            icon-left="close"
          >
          </OButton>
        </OButtonGroup>
        <div
          class="tw:text-xs text-weight-bold tw:text-center tw:py-1"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.name == null
          "
        >
          <div class="tw:mt-1">{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- value for maps container -->
    <div style="display: flex; flex-direction: row" class="tw:pl-3">
      <div class="layout-name">
        {{ t("panel.mapvalue") }}
        <OIcon name="info-outline" size="sm" class="tw:ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea ==
              'value_for_maps',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'value_for_maps')"
        @drop="onDrop($event, 'value_for_maps')"
        @dragenter="onDragEnter($event, 'value_for_maps', null)"
        data-test="dashboard-value_for_maps-layout"
      >
        <OButtonGroup
          class="axis-field tw:mr-2 tw:my-1"
          radius="sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.value_for_maps
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.value_for_maps,
              'value_for_maps',
            )
          "
        >
          <OButton
            variant="outline"
            size="icon-chip"
            class="cursor-grab"
            :data-test="`dashboard-value_for_maps-item-${valueLabel}-drag`"
          >
            <template #icon-left>
              <OIcon name="drag-indicator" size="xs" />
            </template>
          </OButton>
          <ODropdown>
            <template #trigger>
              <OButton
                variant="primary"
                size="chip-12"
                :data-test="`dashboard-value_for_maps-item-${valueLabel}`"
              >
                {{ valueLabel }}
                <template #icon-right
                  ><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-maps-query-builder-dropdown"
              :data-test="`dashboard-value_for_maps-item-${valueLabel}-menu`"
            >
              <div
                style="padding: 3px 16px 16px 16px"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.value_for_maps.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="tw:mr-1 tw:mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.value_for_maps
                      "
                      :allowAggregation="true"
                      :customQuery="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ODropdown>
          <OButton
            variant="outline"
            size="icon-chip"
            :data-test="`dashboard-value_for_maps-item-${valueLabel}-remove`"
            @click="removeMapValue()"
            icon-left="close"
          >
          </OButton>
        </OButtonGroup>
        <div
          class="tw:text-xs text-weight-bold tw:text-center tw:py-1"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.value_for_maps == null
          "
        >
          <div class="tw:mt-1">{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <DashboardJoinsOption :dashboardData="dashboardData"></DashboardJoinsOption>
    <OSeparator />
    <!-- filters container -->
    <DashboardFiltersOption
      :dashboardData="dashboardData"
    ></DashboardFiltersOption>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  reactive,
  watch,
  computed,
  inject,
  nextTick,
} from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import DashboardFiltersOption from "@/views/Dashboards/addPanel/DashboardFiltersOption.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { buildSQLQueryFromInput } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import DashboardJoinsOption from "@/views/Dashboards/addPanel/DashboardJoinsOption.vue";
import useNotifications from "@/composables/useNotifications";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "DashboardMapsQueryBuilder",
  components: {
    OSeparator,
    OButtonGroup,
    OButton,
    ODropdown,
    SortByBtnGrp,
    SanitizedHtmlRenderer,
    DashboardFiltersOption,
    DynamicFunctionPopUp,
    DashboardJoinsOption,
    OIcon,
    OTooltip,
  },
  props: ["dashboardData"],
  setup(props) {
    const { t } = useI18n();
    const { showErrorNotification } = useNotifications();

    const expansionItems = reactive({
      name: true,
      value_for_maps: true,
      filter: false,
    });

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const {
      dashboardPanelData,
      addMapName,
      addMapValue,
      addFilteredItem,
      removeMapName,
      removeMapValue,
      promqlMode,
      cleanupDraggingFields,
    } = useDashboardPanelData(dashboardPanelDataPageKey);

    const triggerOperators = [
      { label: t("dashboard.count"), value: "count" },
      { label: t("dashboard.countDistinct"), value: "count-distinct" },
      { label: t("dashboard.sum"), value: "sum" },
      { label: t("dashboard.avg"), value: "avg" },
      { label: t("dashboard.min"), value: "min" },
      { label: t("dashboard.max"), value: "max" },
      {
        label: t("dashboard.p50"),
        value: "p50",
      },
      {
        label: t("dashboard.p90"),
        value: "p90",
      },
      {
        label: t("dashboard.p95"),
        value: "p95",
      },
      {
        label: t("dashboard.p99"),
        value: "p99",
      },
    ];

    watch(
      () => dashboardPanelData.meta.dragAndDrop.dragging,
      (newVal: boolean, oldVal: boolean) => {
        if (oldVal == false && newVal == true) {
          expansionItems.name = true;
          expansionItems.value_for_maps = true;
          expansionItems.filter = true;
        }
      },
    );

    const onDrop = (e: any, targetAxis: string) => {
      e.stopPropagation();
      // move the items  between axis or from the field list
      // check if the source is from axis or field list
      if (dashboardPanelData.meta.dragAndDrop.dragSource === "fieldList") {
        // add the item to the target list
        const dragElement = dashboardPanelData.meta.dragAndDrop.dragElement;
        if (!dragElement) {
          return;
        }

        switch (targetAxis) {
          case "name":
            addMapName(dragElement);
            break;
          case "value_for_maps":
            addMapValue(dragElement);
            break;
          case "f":
            addFilteredItem(dragElement);
            break;
        }
      } else {
        // move the item from field list to axis
        const dragElement = dashboardPanelData.meta.dragAndDrop.dragElement;

        const currentQueryField =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields;
        if (targetAxis !== "f") {
          if (
            (targetAxis === "name" && currentQueryField.name) ||
            (targetAxis === "value_for_maps" &&
              currentQueryField.value_for_maps)
          ) {
            const maxAllowedAxisFields = 1;

            const errorMessage = `Max ${maxAllowedAxisFields} field in ${targetAxis.toUpperCase()} is allowed.`;

            showErrorNotification(errorMessage);
            cleanupDraggingFields();
            return;
          }

          // Remove from the original axis
          const dragSource = dashboardPanelData.meta.dragAndDrop.dragSource;
          if (dragSource === "name") {
            removeMapName();
          } else if (dragSource === "value_for_maps") {
            removeMapValue();
          }
        }
        if (targetAxis === "f") {
          return;
        }

        // find first arg which is of type field
        const firstFieldTypeArg = dragElement?.args?.find(
          (arg: any) => arg?.type === "field",
        )?.value;

        if (!firstFieldTypeArg) {
          showErrorNotification("Without field, not able to drag");
          cleanupDraggingFields();
          return;
        }

        const fieldObj = {
          name: firstFieldTypeArg.field,
          streamAlias: firstFieldTypeArg.streamAlias,
        };

        // Add to the new axis
        if (targetAxis === "name") {
          addMapName(fieldObj);
        } else if (targetAxis === "value_for_maps") {
          addMapValue(fieldObj);
        }
      }

      cleanupDraggingFields();
    };

    const onDragStart = (e: any, item: any) => {
      e.preventDefault();
    };

    const onDragOver = (e: any, area: string) => {
      e.preventDefault();
    };

    const onDragEnter = (e: any, area: string, index: any) => {
      if (
        dashboardPanelData.meta.dragAndDrop.dragSource != "fieldList" &&
        area === "f"
      ) {
        e.preventDefault();
        return;
      }
      dashboardPanelData.meta.dragAndDrop.targetDragIndex =
        index != null && index >= 0
          ? index
          : dashboardPanelData.meta.dragAndDrop.targetDragIndex;
      dashboardPanelData.meta.dragAndDrop.currentDragArea = area;
      e.preventDefault();
    };

    const onFieldDragStart = (e: any, item: any, axis: string) => {
      dashboardPanelData.meta.dragAndDrop.dragging = true;
      dashboardPanelData.meta.dragAndDrop.dragElement = item;
      dashboardPanelData.meta.dragAndDrop.dragSource = axis;
    };

    const onDragEnd = () => {
      cleanupDraggingFields();
    };
    const Hint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case "maps":
          return t("dashboard.oneFieldMessage");
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
        return field?.alias;
      }
      const label = buildSQLQueryFromInput(
        field,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.joins?.length
          ? dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.stream
          : "",
      );

      return label?.length > MAX_FIELD_LABEL_CHARS
        ? label.substring(0, MAX_FIELD_LABEL_CHARS) + "..."
        : label;
    };

    const nameLabel = computed(() => {
      const nameField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.name;
      return commonBtnLabel(nameField);
    });

    const valueLabel = computed(() => {
      const valueField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value_for_maps;
      return commonBtnLabel(valueField);
    });

    return {
      t,
      dashboardPanelData,
      removeMapName,
      removeMapValue,
      nameLabel,
      valueLabel,
      triggerOperators,
      pagination: ref({
        rowsPerPage: 0,
      }),
      model: ref([]),
      tab: ref("General"),
      getImageURL,
      onDrop,
      onDragStart,
      onDragEnd,
      onDragOver,
      onDragEnter,
      expansionItems,
      Hint,
      promqlMode,
      onFieldDragStart,
    };
  },
});
</script>

<style lang="scss" scoped>
.axis-field {
  overflow: hidden;
}

:deep(.axis-field .q-btn--rectangle) {
  border-radius: 0%;
}

:deep(.axis-field .q-btn:before) {
  border: 0px solid transparent;
}

.axis-container {
  flex: 1;
  width: 100%;
  // white-space: nowrap;
  display: flex;
  flex-wrap: wrap;
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
  transition: all;
  transition-duration: 200ms;
  background-color: var(--color-field-list-row-hover-bg);
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

.dashboard-maps-query-builder-dropdown {
  :deep(.q-virtual-scroll__content) {
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

.field-function-menu-popup {
  width: 771px !important;
  height: 323px;
  padding: 16px;
}
</style>
