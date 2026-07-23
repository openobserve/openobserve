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
  <div v-if="!promqlMode && dashboardPanelData.data.type == 'geomap'">
    <!-- latitude container -->
    <div class="pl-3 flex flex-row">
      <div class="whitespace-nowrap min-w-24 flex items-center">
        <span
          class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-indigo-ol-text"
          aria-hidden="true"
        ></span>
        {{ t("panel.latitude") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="flex items-center mx-0.5">:</span>
      <div
        class="axis-container droppable flex-1 w-full flex flex-wrap items-center min-h-8 border-2 border-dashed border-transparent"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-field-list-row-hover-bg':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'latitude',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'latitude')"
        @drop="onDrop($event, 'latitude')"
        @dragenter="onDragEnter($event, 'latitude', null)"
        data-test="dashboard-latitude-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-0.5 border border-border-default border-s-2 border-s-badge-indigo-ol-border bg-surface-panel"
          radius="sm"
          :divided="false"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.latitude
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.latitude,
              'latitude',
            )
          "
        >
          <OButton
            variant="ghost"
            size="icon-chip"
            class="cursor-grab !w-4"
            :data-test="`dashboard-latitude-item-${latitudeLabel}-drag`"
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
                :data-test="`dashboard-latitude-item-${latitudeLabel}`"
              >
                <AxisFieldChipLabel :label="latitudeLabel" />
                <template #icon-right><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-geo-maps-query-builder-dropdown w-[48.1875rem]! h-[20.1875rem] shadow-md p-4 translate-y-2 rounded-none"
              :data-test="`dashboard-latitude-item-${latitudeLabel}-menu`"
            >
              <div class="pt-0.75 pr-4 pb-4 pl-4"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.latitude.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <DynamicFunctionPopUp
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.latitude
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
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon-chip"
            class="!w-4 -ms-1"
            :data-test="`dashboard-latitude-item-${latitudeLabel}-remove`"
            @click="removeLatitude()"
          >
            <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-center w-full flex justify-center items-center"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.latitude == null
          "
        >
          <div>{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- longitude container -->
    <div class="pl-3 flex flex-row">
      <div class="whitespace-nowrap min-w-24 flex items-center">
        <span
          class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-orange-ol-text"
          aria-hidden="true"
        ></span>
        {{ t("panel.longitude") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="flex items-center mx-0.5">:</span>
      <div
        class="axis-container droppable flex-1 w-full flex flex-wrap items-center min-h-8 border-2 border-dashed border-transparent"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-field-list-row-hover-bg':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'longitude',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'longitude')"
        @drop="onDrop($event, 'longitude')"
        @dragenter="onDragEnter($event, 'longitude', null)"
        data-test="dashboard-longitude-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-0.5 border border-border-default border-s-2 border-s-badge-orange-ol-border bg-surface-panel"
          radius="sm"
          :divided="false"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.longitude
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.longitude,
              'longitude',
            )
          "
        >
          <OButton
            variant="ghost"
            size="icon-chip"
            class="cursor-grab !w-4"
            :data-test="`dashboard-longitude-item-${longitudeLabel}-drag`"
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
                :data-test="`dashboard-longitude-item-${longitudeLabel}`"
              >
                <AxisFieldChipLabel :label="longitudeLabel" />
                <template #icon-right><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-geo-maps-query-builder-dropdown w-[48.1875rem]! h-[20.1875rem] shadow-md p-4 translate-y-2 rounded-none"
              :data-test="`dashboard-longitude-item-${longitudeLabel}-menu`"
            >
              <div class="pt-0.75 pr-4 pb-4 pl-4"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.longitude.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <DynamicFunctionPopUp
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.longitude
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
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon-chip"
            class="!w-4 -ms-1"
            :data-test="`dashboard-longitude-item-${longitudeLabel}-remove`"
            @click="removeLongitude()"
          >
            <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-center w-full flex justify-center items-center"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.longitude == null
          "
        >
          <div>{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- weight container -->
    <div class="pl-3 flex flex-row">
      <div class="whitespace-nowrap min-w-24 flex items-center">
        <span
          class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-success-ol-text"
          aria-hidden="true"
        ></span>
        {{ t("panel.weight") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="WeightHint" />
      </div>
      <span class="flex items-center mx-0.5">:</span>
      <div
        class="axis-container droppable flex-1 w-full flex flex-wrap items-center min-h-8 border-2 border-dashed border-transparent"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-field-list-row-hover-bg':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'weight',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'weight')"
        @drop="onDrop($event, 'weight')"
        @dragenter="onDragEnter($event, 'weight', null)"
        data-test="dashboard-weight-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-0.5 border border-border-default border-s-2 border-s-badge-success-ol-border bg-surface-panel"
          radius="sm"
          :divided="false"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.weight
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.weight,
              'weight',
            )
          "
        >
          <OButton
            variant="ghost"
            size="icon-chip"
            class="cursor-grab !w-4"
            :data-test="`dashboard-weight-item-${weightLabel}-drag`"
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
                :data-test="`dashboard-weight-item-${weightLabel}`"
              >
                <AxisFieldChipLabel :label="weightLabel" />
                <template #icon-right><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-geo-maps-query-builder-dropdown w-[48.1875rem]! h-[20.1875rem] shadow-md p-4 translate-y-2 rounded-none"
              :data-test="`dashboard-weight-item-${weightLabel}-menu`"
            >
              <div class="pt-0.75 pr-4 pb-4 pl-4"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.weight.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <DynamicFunctionPopUp
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.weight
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
          </ODropdown>
          <OButton
            variant="ghost"
            size="icon-chip"
            class="!w-4 -ms-1"
            :data-test="`dashboard-weight-item-${weightLabel}-remove`"
            @click="removeWeight()"
          >
            <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-center w-full flex justify-center items-center"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.weight == null
          "
        >
          <div>{{ WeightHint }}</div>
        </div>
      </div>
    </div>
    <template v-if="showJoinsAndFilters">
      <OSeparator />
      <DashboardJoinsOption
        :dashboardData="dashboardData"
        label-width-class="min-w-24"
      ></DashboardJoinsOption>
      <OSeparator />
      <!-- filters container -->
      <DashboardFiltersOption
        :dashboardData="dashboardData"
        label-width-class="min-w-24"
      ></DashboardFiltersOption>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, watch, computed } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
import { inject } from "vue";
import useNotifications from "@/composables/useNotifications";
import DashboardFiltersOption from "@/views/Dashboards/addPanel/DashboardFiltersOption.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import DashboardJoinsOption from "@/views/Dashboards/addPanel/DashboardJoinsOption.vue";
import { buildSQLQueryFromInput } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import AxisFieldChipLabel from "@/components/dashboards/addPanel/AxisFieldChipLabel.vue";

export default defineComponent({
  name: "DashboardGeoMapsQueryBuilder",
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
      latitude: true,
      longitude: true,
      weight: true,
      filter: false,
    });
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const {
      dashboardPanelData,
      addLatitude,
      addLongitude,
      addWeight,
      removeLatitude,
      removeLongitude,
      removeWeight,
      addFilteredItem,
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
          expansionItems.latitude = true;
          expansionItems.longitude = true;
          expansionItems.weight = true;
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
          case "latitude":
            addLatitude(dragElement);
            break;
          case "longitude":
            addLongitude(dragElement);
            break;
          case "weight":
            addWeight(dragElement);
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
            (targetAxis === "latitude" && currentQueryField.latitude) ||
            (targetAxis === "longitude" && currentQueryField.longitude) ||
            (targetAxis === "weight" && currentQueryField.weight)
          ) {
            const maxAllowedAxisFields = 1;

            const errorMessage = t(
              "dashboard.dashboardGeoMapsQueryBuilder.maxFieldAllowed",
              {
                count: maxAllowedAxisFields,
                axis: targetAxis.toUpperCase(),
              },
            );

            showErrorNotification(errorMessage);
            cleanupDraggingFields();
            return;
          }

          // Remove from the original axis
          const dragSource = dashboardPanelData.meta.dragAndDrop.dragSource;
          if (dragSource === "latitude") {
            removeLatitude();
          } else if (dragSource === "longitude") {
            removeLongitude();
          } else if (dragSource === "weight") {
            removeWeight();
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
          showErrorNotification(
            t("dashboard.dashboardGeoMapsQueryBuilder.withoutFieldDrag"),
          );
          cleanupDraggingFields();
          return;
        }

        const fieldObj = {
          name: firstFieldTypeArg.field,
          streamAlias: firstFieldTypeArg.streamAlias,
        };

        // Add to the new axis
        if (targetAxis === "latitude") {
          addLatitude(fieldObj);
        } else if (targetAxis === "longitude") {
          addLongitude(fieldObj);
        } else if (targetAxis === "weight") {
          addWeight(fieldObj);
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
    const Hint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "geomap":
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const WeightHint = computed(() => {
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
        return field.alias;
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

    const latitudeLabel = computed(() => {
      const latitudeField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.latitude;
      return commonBtnLabel(latitudeField);
    });

    const longitudeLabel = computed(() => {
      const longitudeField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.longitude;
      return commonBtnLabel(longitudeField);
    });

    const weightLabel = computed(() => {
      const weightField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.weight;
      return commonBtnLabel(weightField);
    });

    // Joins and Filters hide themselves in custom-SQL mode; the separators
    // around them must follow the same condition or they stack into a
    // double border.
    const showJoinsAndFilters = computed(() => {
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];
      return !(
        currentQuery?.customQuery && dashboardPanelData.data.queryType === "sql"
      );
    });

    return {
      t,
      dashboardPanelData,
      showJoinsAndFilters,
      removeLatitude,
      removeLongitude,
      removeWeight,
      triggerOperators,
      pagination: ref({
        rowsPerPage: 0,
      }),
      model: ref([]),
      tab: ref("General"),
      getImageURL,
      onDrop,
      onDragEnter,
      onDragStart,
      onDragEnd,
      onDragOver,
      expansionItems,
      Hint,
      WeightHint,
      promqlMode,
      latitudeLabel,
      longitudeLabel,
      weightLabel,
      onFieldDragStart,
    };
  },
});
</script>
