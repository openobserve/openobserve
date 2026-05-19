<template>
  <div class="condition">
    <OSelect
      v-if="conditionIndex !== 0"
      v-model="condition.logicalOperator"
      :options="filterOptions"
      @update:model-value="emitLogicalOperatorChange"
      class="condition-logical-operator"
      :data-test="`dashboard-add-condition-logical-operator-${conditionIndex}`"
    />
    <OButtonGroup class="axis-field" radius="sm">
      <ODropdown
        @update:open="(v: boolean) => v && loadFilterItem(condition.column)"
      >
        <template #trigger>
          <OButton
            variant="primary"
            size="chip-12"
            :data-test="`dashboard-add-condition-label-${conditionIndex}-${computedLabel(condition)}`"
            icon-right="arrow-drop-down"
          >
            {{ computedLabel(condition) }}
          </OButton>
        </template>
        <div class="add-condition-dropdown tw:p-4">
          <div style="display: flex; align-items: center; gap: 4px">
            <StreamFieldSelect
              class="tw:w-full"
              :streams="getAllSelectedStreams()"
              v-model="condition.column"
              :data-test="`dashboard-add-condition-column-${conditionIndex}`"
            />
            <OButton
              variant="ghost"
              size="icon"
              @click="removeColumnName"
              :data-test="`dashboard-add-condition-remove-column-${conditionIndex}`"
              icon-left="close"
            >
            </OButton>
          </div>
          <div style="height: 100%">
            <div class="tw:p-1" style="height: 100%">
              <div class="tw:gap-1" style="height: 100%">
                <OTabs v-model="condition.type" dense>
                  <OTab
                    name="list"
                    :label="t('common.list')"
                    :data-test="`dashboard-add-condition-list-${conditionIndex}`"
                  ></OTab>
                  <OTab
                    name="condition"
                    :label="t('common.condition')"
                    :data-test="`dashboard-add-condition-condition-${conditionIndex}`"
                  ></OTab>
                </OTabs>
                <OSeparator />
                <div class="tw:h-full">
                  <OTabPanels v-model="condition.type" animated>
                    <OTabPanel name="condition">
                      <div class="flex column" style="height: 220px">
                        <OSelect
                          v-model="condition.operator"
                          :options="operators"
                          :label="t('common.operator')"
                          style="width: 100%"
                          data-test="dashboard-add-condition-operator"
                          class="o2-custom-select-dashboard"
                        />
                        <CommonAutoComplete
                          v-if="
                            !['Is Null', 'Is Not Null'].includes(
                              condition.operator,
                            )
                          "
                          :label="t('common.value')"
                          v-model="condition.value"
                          :items="dashboardVariablesFilterItems"
                          searchRegex="(?:^|[^$])\$?(\w+)"
                        ></CommonAutoComplete>
                      </div>
                    </OTabPanel>
                    <OTabPanel name="list">
                      <OSelect
                        v-model="condition.values"
                        :options="sortedFilteredListOptions"
                        :label="t('common.selectFilter')"
                        multiple
                        :rules="[
                          (val: any) =>
                            val.length > 0 || 'At least 1 item required',
                        ]"
                        use-input
                        @filter="filterListFn"
                        data-test="dashboard-add-condition-list-tab"
                        class="o2-custom-select-dashboard"
                      >
                        <template v-slot:selected>
                          {{
                            condition.values[0]?.length > 15
                              ? condition.values[0]?.substring(0, 15) + "..."
                              : condition.values[0]
                          }}
                          {{
                            condition.values?.length > 1
                              ? " +" + (condition.values?.length - 1)
                              : ""
                          }}
                        </template>
                        <template
                          v-slot:option="{
                            itemProps,
                            opt,
                            selected,
                            toggleOption,
                          }"
                        >
                          <div
                            class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1.5 tw:cursor-pointer hover:tw:bg-muted/50"
                            @click="toggleOption(opt)"
                          >
                            <div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">
                              <OCheckbox
                                :model-value="selected"
                                @update:model-value="toggleOption(opt)"
                                data-test="dashboard-add-condition-list-item"
                              />
                            </div>
                            <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                              <SanitizedHtmlRenderer :html-content="opt" />
                            </div>
                          </div>
                        </template>
                      </OSelect>
                    </OTabPanel>
                  </OTabPanels>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ODropdown>
      <OButton
        variant="outline"
        size="icon-chip"
        @click="$emit('remove-condition')"
        data-test="dashboard-add-condition-remove"
        icon-left="close"
      >
      </OButton>
    </OButtonGroup>
  </div>
</template>

<script lang="ts">
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { defineComponent, ref, computed, toRef, watch, inject } from "vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useI18n } from "vue-i18n";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";

export default defineComponent({
  name: "AddCondition",
  components: {
    OSeparator,
    OButtonGroup,
    OButton,
    ODropdown,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    CommonAutoComplete,
    SanitizedHtmlRenderer,
    StreamFieldSelect,
    OSelect,
    OCheckbox,
  },
  props: [
    "condition",
    "schemaOptions", // fields
    "dashboardVariablesFilterItems",
    "dashboardPanelData",
    "label", // not used
    "loadFilterItem",
    "conditionIndex",
  ],
  setup(props, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const {
      getAllSelectedStreams,
      getStreamNameFromStreamAlias,
      dashboardPanelData,
    } = useDashboardPanelData(dashboardPanelDataPageKey);
    const { t } = useI18n();
    const searchTerm = ref("");
    const { filterFn: filterStreamFn, filteredOptions: filteredSchemaOptions } =
      useSelectAutoComplete(toRef(props, "schemaOptions"), "label");

    const filteredListOptions = computed(() => {
      const options = props.dashboardPanelData.meta.filterValue
        .find(
          (it: any) =>
            it.column == props?.condition?.column?.field &&
            it.stream ==
              getStreamNameFromStreamAlias(
                props?.condition?.column?.streamAlias,
              ),
        )
        ?.value?.filter((option: any) =>
          option?.toLowerCase().includes(searchTerm.value.toLowerCase()),
        );

      // Sort options alphabetically
      return options
        ? options.sort((a: string, b: string) => a.localeCompare(b))
        : [];
    });

    const filterListFn = (search: any, update: any) => {
      searchTerm.value = search;
      update(() => filteredListOptions.value);
    };

    const operators = [
      "=",
      "<>",
      ">=",
      "<=",
      ">",
      "<",
      "IN",
      "NOT IN",
      "str_match",
      "str_match_ignore_case",
      "match_all",
      "re_match",
      "re_not_match",
      "Contains",
      "Starts With",
      "Ends With",
      "Not Contains",
      "Is Null",
      "Is Not Null",
    ];

    const filterOptions = [
      { label: "AND", value: "AND" },
      { label: "OR", value: "OR" },
    ];

    const computedLabel = (condition: any) => {
      const builtCondition = buildCondition(condition, dashboardPanelData);

      return builtCondition === ""
        ? condition.column.field
        : builtCondition?.length > MAX_FIELD_LABEL_CHARS
          ? builtCondition.substring(0, MAX_FIELD_LABEL_CHARS) + "..."
          : builtCondition;
    };

    const emitLogicalOperatorChange = (newOperator: string) => {
      emit("logical-operator-change", newOperator);
    };

    const handleFieldChange = (newValue: string) => {
      props.loadFilterItem(newValue);
    };

    const removeColumnName = () => {
      props.condition.column = {};
    };

    watch(
      () => props.condition.column,
      (newColumn, oldColumn) => {
        if (newColumn !== oldColumn) {
          props.condition.values = [];
        }
      },
    );

    watch(
      () => props.condition.column,
      () => {
        props.loadFilterItem(props.condition.column);
      },
    );

    return {
      operators,
      computedLabel,
      t,
      filterStreamFn,
      filterListFn,
      filterOptions,
      emitLogicalOperatorChange,
      handleFieldChange,
      removeColumnName,
      filteredSchemaOptions,
      sortedFilteredListOptions: filteredListOptions,
      getAllSelectedStreams,
    };
  },
});
</script>

<style lang="scss" scoped>
.condition {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-condition-dropdown {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  :deep(.q-virtual-scroll__content) {
    padding: 0.5rem;
  }
}

.condition-logical-operator {
  width: 60px;
}

:deep(.condition-logical-operator .q-field__control) {
  min-height: 26px !important;
  height: 26px !important;
  padding: 0px 0px 0px 5px !important;
  vertical-align: middle !important;
  margin-top: 4px;
  /* Nudge up slightly to align with buttons */
}

:deep(.condition-logical-operator .q-field__native) {
  min-height: 26px !important;
  height: 26px !important;
  padding: 0px 0px 0px 0px !important;
}

:deep(.condition-logical-operator .q-field__append) {
  min-height: 26px !important;
  height: 26px !important;
  padding: 0px 0px 0px 0px !important;
}

:deep(.q-panel) {
  overflow: visible !important;
}

:deep(.o2-custom-select-dashboard .q-field__bottom) {
  padding-top: 8px !important;
}
</style>
