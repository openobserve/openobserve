<template>
  <div class="condition flex items-center gap-2">
    <OSelect
      v-if="conditionIndex !== 0"
      v-model="condition.logicalOperator"
      :options="filterOptions"
      @update:model-value="emitLogicalOperatorChange"
      class="condition-logical-operator w-fit max-w-[8rem]"
      :data-test="`dashboard-add-condition-logical-operator-${conditionIndex}`"
    />
    <OButtonGroup class="axis-field shrink-0" radius="sm">
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
        <div class="p-4 w-72">
          <div style="display: flex; align-items: center; gap: 4px">
            <StreamFieldSelect
              class="w-full"
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
          <div>
            <div class="p-1">
              <div class="gap-1">
                <OTabs v-model="condition.type" dense>
                  <OTab
                    name="list"
                    :label="t('common.list')"
                    class="flex-1"
                    :data-test="`dashboard-add-condition-list-${conditionIndex}`"
                  ></OTab>
                  <OTab
                    name="condition"
                    :label="t('common.condition')"
                    class="flex-1"
                    :data-test="`dashboard-add-condition-condition-${conditionIndex}`"
                  ></OTab>
                </OTabs>
                <OSeparator />
                <div>
                  <OTabPanels v-model="condition.type" animated>
                    <OTabPanel name="condition">
                      <div class="flex flex-col gap-2">
                        <OSelect
                          v-model="condition.operator"
                          :options="operators"
                          :label="t('common.operator')"
                          style="width: 100%"
                          data-test="dashboard-add-condition-operator"
                          class="o2-custom-select-dashboard"
                        />
                        <OCombobox
                          v-if="
                            !['Is Null', 'Is Not Null'].includes(
                              condition.operator,
                            )
                          "
                          :label="t('common.value')"
                          v-model="condition.value"
                          :items="dashboardVariablesFilterItems"
                          search-regex="(?:^|[^$])\$?(\w+)"
                          data-test="dashboard-add-condition-value"
                        />
                      </div>
                    </OTabPanel>
                    <OTabPanel name="list">
                      <OSelect
                        v-model="condition.values"
                        :options="sortedFilteredListOptions"
                        :label="t('common.selectFilter')"
                        multiple
                        searchable
                        :error="condition.values?.length === 0"
                        :error-message="condition.values?.length === 0 ? 'At least 1 item required' : ''"
                        data-test="dashboard-add-condition-list-tab"
                        class="o2-custom-select-dashboard"
                      />
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
        class="shrink-0"
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
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { defineComponent, ref, computed, toRef, watch, inject } from "vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
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
    OCombobox,
    StreamFieldSelect,
    OSelect,
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
      filterOptions,
      filterListFn,
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
