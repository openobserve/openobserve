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
    <div class="flex flex-row pl-3">
      <div class="flex min-w-20 items-center whitespace-nowrap">
        <span
          class="rounded-default bg-badge-indigo-ol-text mr-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.mapname") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
        <OTooltip :content="Hint" />
      </div>
      <span class="mr-0.5 ml-0.5 flex items-center">:</span>
      <div
        class="axis-container droppable scroll flex min-h-8 w-full flex-1 flex-wrap items-center border border-dashed border-transparent"
        :class="{
          '[border-style:dotted] border-white bg-[rgba(0,0,0,0.042)]':
            dashboardPanelData.meta.dragAndDrop.dragging,
          'bg-field-list-row-hover-bg transition-colors duration-200':
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
          class="axis-field border-border-default border-s-badge-indigo-ol-border bg-surface-panel my-0.5 mr-2 overflow-hidden border border-s-2"
          radius="sm"
          :divided="false"
          v-if="
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              ?.name
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
                ?.name,
              'name',
            )
          "
        >
          <OButton
            variant="ghost"
            size="icon-chip"
            class="!w-4 cursor-grab"
            :data-test="`dashboard-name-item-${nameLabel}-drag`"
          >
            <template #icon-left>
              <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
            </template>
          </OButton>
          <ODropdown>
            <template #trigger>
              <OButton
                variant="ghost"
                size="chip-12"
                class="!ps-1 !pe-0"
                :data-test="`dashboard-name-item-${nameLabel}`"
              >
                <AxisFieldChipLabel :label="nameLabel" />
                <template #icon-right><OIcon name="arrow-drop-down" size="sm" /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-maps-query-builder-dropdown w-[48.1875rem]! translate-y-2 overflow-hidden rounded-none p-0 shadow-md"
              :data-test="`dashboard-name-item-${nameLabel}-menu`"
            >
              <div
                class="pt-0.75 pr-4 pb-4 pl-4"
                :style="{
                  width:
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                      .customQuery ||
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                      .fields.name.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="mr-1 mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                          .fields.name
                      "
                      :allowAggregation="false"
                      :customQuery="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                          .customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon-chip"
            class="-ms-1 !w-4"
            :data-test="`dashboard-name-item-${nameLabel}-remove`"
            @click="removeMapName()"
          >
            <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
          </OButton>
        </OButtonGroup>
        <div
          class="flex min-w-0 flex-1 items-center justify-center text-center text-xs whitespace-nowrap"
          v-if="
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              .name == null
          "
        >
          <div>{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- value for maps container -->
    <div class="flex flex-row pl-3">
      <div class="flex min-w-20 items-center whitespace-nowrap">
        <span
          class="rounded-default bg-badge-success-ol-text mr-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.mapvalue") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
        <OTooltip :content="Hint" />
      </div>
      <span class="mr-0.5 ml-0.5 flex items-center">:</span>
      <div
        class="axis-container droppable scroll flex min-h-8 w-full flex-1 flex-wrap items-center border border-dashed border-transparent"
        :class="{
          '[border-style:dotted] border-white bg-[rgba(0,0,0,0.042)]':
            dashboardPanelData.meta.dragAndDrop.dragging,
          'bg-field-list-row-hover-bg transition-colors duration-200':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'value_for_maps',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'value_for_maps')"
        @drop="onDrop($event, 'value_for_maps')"
        @dragenter="onDragEnter($event, 'value_for_maps', null)"
        data-test="dashboard-value_for_maps-layout"
      >
        <OButtonGroup
          class="axis-field border-border-default border-s-badge-success-ol-border bg-surface-panel my-0.5 mr-2 overflow-hidden border border-s-2"
          radius="sm"
          :divided="false"
          v-if="
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              ?.value_for_maps
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
                ?.value_for_maps,
              'value_for_maps',
            )
          "
        >
          <OButton
            variant="ghost"
            size="icon-chip"
            class="!w-4 cursor-grab"
            :data-test="`dashboard-value_for_maps-item-${valueLabel}-drag`"
          >
            <template #icon-left>
              <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
            </template>
          </OButton>
          <ODropdown>
            <template #trigger>
              <OButton
                variant="ghost"
                size="chip-12"
                class="!ps-1 !pe-0"
                :data-test="`dashboard-value_for_maps-item-${valueLabel}`"
              >
                <AxisFieldChipLabel :label="valueLabel" />
                <template #icon-right><OIcon name="arrow-drop-down" size="sm" /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-maps-query-builder-dropdown w-[48.1875rem]! translate-y-2 overflow-hidden rounded-none p-0 shadow-md"
              :data-test="`dashboard-value_for_maps-item-${valueLabel}-menu`"
            >
              <div
                class="pt-0.75 pr-4 pb-4 pl-4"
                :style="{
                  width:
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                      .customQuery ||
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                      .fields.value_for_maps.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="mr-1 mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                          .fields.value_for_maps
                      "
                      :allowAggregation="true"
                      :customQuery="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                          .customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon-chip"
            class="-ms-1 !w-4"
            :data-test="`dashboard-value_for_maps-item-${valueLabel}-remove`"
            @click="removeMapValue()"
          >
            <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
          </OButton>
        </OButtonGroup>
        <div
          class="flex min-w-0 flex-1 items-center justify-center text-center text-xs whitespace-nowrap"
          v-if="
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              .value_for_maps == null
          "
        >
          <div>{{ Hint }}</div>
        </div>
      </div>
    </div>
    <template v-if="showJoinsAndFilters">
      <OSeparator />
      <DashboardJoinsOption :dashboardData="dashboardData"></DashboardJoinsOption>
      <OSeparator />
      <!-- filters container -->
      <DashboardFiltersOption :dashboardData="dashboardData"></DashboardFiltersOption>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, watch, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
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
import AxisFieldChipLabel from "@/components/dashboards/addPanel/AxisFieldChipLabel.vue";

export default defineComponent({
  name: "DashboardMapsQueryBuilder",
  components: {
    AxisFieldChipLabel,
    OSeparator,
    OButtonGroup,
    OButton,
    ODropdown,
    DashboardFiltersOption,
    DynamicFunctionPopUp,
    DashboardJoinsOption,
    OIcon,
    OTooltip,
  },
  props: ["dashboardData"],
  setup() {
    const { t } = useI18n();
    const { showErrorNotification } = useNotifications();

    const expansionItems = reactive({
      name: true,
      value_for_maps: true,
      filter: false,
    });

    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");

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
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields;
        if (targetAxis !== "f") {
          if (
            (targetAxis === "name" && currentQueryField.name) ||
            (targetAxis === "value_for_maps" && currentQueryField.value_for_maps)
          ) {
            const maxAllowedAxisFields = 1;

            const errorMessage = t("dashboard.dashboardMapsQueryBuilder.maxFieldAllowed", {
              count: maxAllowedAxisFields,
              axis: targetAxis.toUpperCase(),
            });

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
          showErrorNotification(t("dashboard.dashboardMapsQueryBuilder.withoutFieldNotDrag"));
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

    const onDragStart = (e: any) => {
      e.preventDefault();
    };

    const onDragOver = (e: any, _columnData?: string) => {
      e.preventDefault();
    };

    const onDragEnter = (e: any, area: string, index: any) => {
      if (dashboardPanelData.meta.dragAndDrop.dragSource != "fieldList" && area === "f") {
        e.preventDefault();
        return;
      }
      dashboardPanelData.meta.dragAndDrop.targetDragIndex =
        index != null && index >= 0 ? index : dashboardPanelData.meta.dragAndDrop.targetDragIndex;
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
    const Hint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "maps":
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const commonBtnLabel = (field: any) => {
      if (
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery
      ) {
        return field?.alias;
      }
      const label = buildSQLQueryFromInput(
        field,
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.joins?.length
          ? dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              ?.stream
          : "",
      );

      return label?.length > MAX_FIELD_LABEL_CHARS
        ? label.substring(0, MAX_FIELD_LABEL_CHARS) + "..."
        : label;
    };

    const nameLabel = computed(() => {
      const nameField =
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.name;
      return commonBtnLabel(nameField);
    });

    const valueLabel = computed(() => {
      const valueField =
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
          .value_for_maps;
      return commonBtnLabel(valueField);
    });

    // Joins and Filters hide themselves in custom-SQL mode; the separators
    // around them must follow the same condition or they stack into a
    // double border.
    const showJoinsAndFilters = computed(() => {
      const currentQuery =
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
      return !(currentQuery?.customQuery && dashboardPanelData.data.queryType === "sql");
    });

    return {
      t,
      dashboardPanelData,
      showJoinsAndFilters,
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
