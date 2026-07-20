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
  <div v-if="!promqlMode && dashboardPanelData.data.type == 'sankey'">
    <!-- source container -->
    <div style="display: flex; flex-direction: row" class="pl-3">
      <div class="layout-name whitespace-nowrap min-w-[130px] flex items-center">
        {{ t("panel.source") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="layout-separator flex items-center ml-[2px] mr-[2px]">:</span>
      <div
        class="axis-container droppable scroll flex-1 w-full flex flex-wrap border-transparent border-dashed border-2"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-[var(--color-field-list-row-hover-bg)]':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'source',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'source')"
        @drop="onDrop($event, 'source')"
        @dragenter="onDragEnter($event, 'source', null)"
        data-test="dashboard-source-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-1"
          radius="sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.source
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.source,
              'source',
            )
          "
        >
          <OButton
            variant="outline"
            size="icon-chip"
            class="cursor-grab"
            :data-test="`dashboard-source-item-${sourceLabel}-drag`"
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
                :data-test="`dashboard-source-item-${sourceLabel}`"
              >
                {{ sourceLabel }}
                <template #icon-right
                  ><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-sankey-chart-builder-dropdown w-[771px]! h-[323px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.05)] p-4 shadow-[0px_3px_15px_rgba(0,0,0,0.1)] translate-y-2 rounded-none"
              :data-test="`dashboard-source-item-${sourceLabel}-menu`"
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
                    ].fields.source.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="mr-1 mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.source
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
            :data-test="`dashboard-source-item-${sourceLabel}-remove`"
            @click="removeSource()"
            icon-left="close"
          >
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-weight-bold text-center py-1"
          data-test="dashboard-sankey-source-empty-hint"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.source == null
          "
        >
          <div class="mt-1">{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- target container -->
    <div style="display: flex; flex-direction: row" class="pl-3">
      <div class="layout-name whitespace-nowrap min-w-[130px] flex items-center">
        {{ t("panel.target") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="layout-separator flex items-center ml-[2px] mr-[2px]">:</span>
      <div
        class="axis-container droppable scroll flex-1 w-full flex flex-wrap border-transparent border-dashed border-2"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-[var(--color-field-list-row-hover-bg)]':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'target',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'target')"
        @drop="onDrop($event, 'target')"
        @dragenter="onDragEnter($event, 'target', null)"
        data-test="dashboard-target-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-1"
          radius="sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.target
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.target,
              'target',
            )
          "
        >
          <OButton
            variant="outline"
            size="icon-chip"
            class="cursor-grab"
            :data-test="`dashboard-target-item-${targetLabel}-drag`"
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
                :data-test="`dashboard-target-item-${targetLabel}`"
              >
                {{ targetLabel }}
                <template #icon-right
                  ><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-sankey-chart-builder-dropdown w-[771px]! h-[323px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.05)] p-4 shadow-[0px_3px_15px_rgba(0,0,0,0.1)] translate-y-2 rounded-none"
              :data-test="`dashboard-target-item-${targetLabel}-menu`"
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
                    ].fields.target.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="mr-1 mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.target
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
            :data-test="`dashboard-target-item-${targetLabel}-remove`"
            @click="removeTarget()"
            icon-left="close"
          >
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-weight-bold text-center py-1"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.target == null
          "
        >
          <div class="mt-1">{{ Hint }}</div>
        </div>
      </div>
    </div>
    <OSeparator />
    <!-- value container -->
    <div style="display: flex; flex-direction: row" class="pl-3">
      <div class="layout-name whitespace-nowrap min-w-[130px] flex items-center">
        {{ t("panel.value") }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="Hint" />
      </div>
      <span class="layout-separator flex items-center ml-[2px] mr-[2px]">:</span>
      <div
        class="axis-container droppable scroll flex-1 w-full flex flex-wrap border-transparent border-dashed border-2"
        :class="{
          'bg-[rgba(0,0,0,0.042)] border-white border-dotted': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-[var(--color-field-list-row-hover-bg)]':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'value',
        }"
        @dragend="onDragEnd()"
        @dragover="onDragOver($event, 'value')"
        @drop="onDrop($event, 'value')"
        @dragenter="onDragEnter($event, 'value', null)"
        data-test="dashboard-value-layout"
      >
        <OButtonGroup
          class="axis-field overflow-hidden mr-2 my-1"
          radius="sm"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.value
          "
          :draggable="true"
          @dragstart="
            onFieldDragStart(
              $event,
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.value,
              'value',
            )
          "
        >
          <OButton
            variant="outline"
            size="icon-chip"
            class="cursor-grab"
            :data-test="`dashboard-value-item-${valueLabel}-drag`"
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
                :data-test="`dashboard-value-item-${valueLabel}`"
              >
                {{ valueLabel }}
                <template #icon-right
                  ><OIcon name="arrow-drop-down" size="sm"
                /></template>
              </OButton>
            </template>
            <div
              class="field-function-menu-popup dashboard-sankey-chart-builder-dropdown w-[771px]! h-[323px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.05)] p-4 shadow-[0px_3px_15px_rgba(0,0,0,0.1)] translate-y-2 rounded-none"
              :data-test="`dashboard-value-item-${valueLabel}-menu`"
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
                    ].fields.value.isDerived
                      ? 'auto'
                      : '771px',
                }"
              >
                <div>
                  <div class="mr-1 mb-2">
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.value
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
            :data-test="`dashboard-value-item-${valueLabel}-remove`"
            @click="removeValue()"
            icon-left="close"
          >
          </OButton>
        </OButtonGroup>
        <div
          class="text-xs text-weight-bold text-center py-1"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.value == null
          "
        >
          <div class="mt-1">{{ Hint }}</div>
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
import useNotifications from "@/composables/useNotifications";
import DashboardFiltersOption from "@/views/Dashboards/addPanel/DashboardFiltersOption.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { buildSQLQueryFromInput } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import DashboardJoinsOption from "@/views/Dashboards/addPanel/DashboardJoinsOption.vue";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "DashboardSankeyChartBuilder",
  components: {
    OSeparator,
    OButtonGroup,
    OButton,
    ODropdown,
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
      source: true,
      target: true,
      value: true,
      filter: false,
    });

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const {
      dashboardPanelData,
      addSource,
      addTarget,
      addValue,
      removeSource,
      removeTarget,
      removeValue,
      addFilteredItem,
      promqlMode,
      cleanupDraggingFields,
      selectedStreamFieldsBasedOnUserDefinedSchema,
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
          expansionItems.source = true;
          expansionItems.target = true;
          expansionItems.value = true;
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
          case "source":
            addSource(dragElement);
            break;
          case "target":
            addTarget(dragElement);
            break;
          case "value":
            addValue(dragElement);
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
            (targetAxis === "source" && currentQueryField.source) ||
            (targetAxis === "target" && currentQueryField.target) ||
            (targetAxis === "value" && currentQueryField.value)
          ) {
            const maxAllowedAxisFields = 1;

            const errorMessage = t(
              "dashboard.dashboardSankeyChartBuilder.maxFieldAllowed",
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
          if (dragSource === "source") {
            removeSource();
          } else if (dragSource === "target") {
            removeTarget();
          } else if (dragSource === "value") {
            removeValue();
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
            t("dashboard.dashboardSankeyChartBuilder.withoutFieldDrag"),
          );
          cleanupDraggingFields();
          return;
        }

        const fieldObj = {
          name: firstFieldTypeArg.field,
          streamAlias: firstFieldTypeArg.streamAlias,
        };

        // Add to the new axis
        if (targetAxis === "source") {
          addSource(fieldObj);
        } else if (targetAxis === "target") {
          addTarget(fieldObj);
        } else if (targetAxis === "value") {
          addValue(fieldObj);
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
        case "sankey":
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

    const sourceLabel = computed(() => {
      const sourceField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.source;
      return commonBtnLabel(sourceField);
    });

    const targetLabel = computed(() => {
      const targetField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.target;
      return commonBtnLabel(targetField);
    });

    const valueLabel = computed(() => {
      const valueField =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value;
      return commonBtnLabel(valueField);
    });

    return {
      t,
      dashboardPanelData,
      removeSource,
      removeTarget,
      removeValue,
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
      promqlMode,
      sourceLabel,
      targetLabel,
      valueLabel,
      onFieldDragStart,
    };
  },
});
</script>

