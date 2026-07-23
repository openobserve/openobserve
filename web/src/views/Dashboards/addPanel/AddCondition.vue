<template>
  <div class="condition flex items-center gap-2">
    <OSelect
      v-if="conditionIndex !== 0"
      v-model="conditionModel.logicalOperator"
      :options="filterOptions"
      size="sm"
      @update:model-value="emitLogicalOperatorChange"
      class="condition-logical-operator w-fit max-w-32"
      :data-test="`dashboard-add-condition-logical-operator-${conditionIndex}`"
    />
    <OButtonGroup
      class="axis-field shrink-0 border border-border-default border-s-2 border-s-text-body bg-surface-panel"
      radius="sm"
      :divided="false"
    >
      <ODropdown
        @update:open="(v: boolean) => v && loadFilterItem(condition.column)"
      >
        <template #trigger>
          <OButton
            variant="ghost"
            size="chip-12"
            class="!pe-0"
            :data-test="`dashboard-add-condition-label-${conditionIndex}-${computedLabel(condition)}`"
            icon-right="arrow-drop-down"
          >
            <span class="whitespace-nowrap font-normal"
              ><span class="text-text-body">{{
                labelParts(condition).prefix
              }}</span
              ><span class="text-text-body">{{
                labelParts(condition).field
              }}</span
              ><span
                v-if="labelParts(condition).op"
                class="text-text-secondary"
                >{{ labelParts(condition).op }}</span
              ><template v-if="labelParts(condition).value"
                ><span class="text-badge-blue-ol-text">{{
                  labelParts(condition).valueOpen
                }}</span
                ><span
                  :class="
                    labelParts(condition).valueIsNumber
                      ? 'text-badge-success-ol-text'
                      : 'text-badge-error-ol-text'
                  "
                  >{{ labelParts(condition).valueInner }}</span
                ><span class="text-badge-blue-ol-text">{{
                  labelParts(condition).valueClose
                }}</span></template
              ></span
            >
          </OButton>
        </template>
        <div class="p-4 w-72">
          <div class="flex items-center gap-1">
            <StreamFieldSelect
              class="w-full"
              :streams="getAllSelectedStreams()"
              v-model="conditionModel.column"
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
                <OTabs v-model="conditionModel.type" dense>
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
                  <OTabPanels v-model="conditionModel.type" animated>
                    <OTabPanel name="condition">
                      <div class="flex flex-col gap-2">
                        <OSelect
                          v-model="conditionModel.operator"
                          :options="operators"
                          :label="t('common.operator')"
                          data-test="dashboard-add-condition-operator"
                          class="o2-custom-select-dashboard w-full"
                        />
                        <OCombobox
                          v-if="
                            !['Is Null', 'Is Not Null'].includes(
                              condition.operator,
                            )
                          "
                          :label="t('common.value')"
                          v-model="conditionModel.value"
                          :items="dashboardVariablesFilterItems"
                          search-regex="(?:^|[^$])\$?(\w+)"
                          data-test="dashboard-add-condition-value"
                        />
                      </div>
                    </OTabPanel>
                    <OTabPanel name="list">
                      <OSelect
                        v-model="conditionModel.values"
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
        variant="ghost"
        size="icon-chip"
        class="shrink-0 !w-4 -ms-1"
        @click="$emit('remove-condition')"
        data-test="dashboard-add-condition-remove"
      >
        <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
      </OButton>
    </OButtonGroup>
  </div>
</template>

<script lang="ts">
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { type SelectModelValue } from "@/lib/forms/Select/OSelect.types";
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
    OIcon,
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

    // Same reference as props.condition; mutation targets its nested fields only.
    const conditionModel = computed(() => props.condition);
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

    /**
     * Split a condition label like "stream.field IN ('x')" into styled parts:
     * muted stream prefix + bold field, muted operator, and the parenthesised
     * value highlighted separately. Labels without an operator/value collapse
     * to just prefix + field.
     */
    const labelParts = (condition: any) => {
      const label = String(computedLabel(condition) ?? "");
      const spaceIdx = label.indexOf(" ");
      const column = spaceIdx === -1 ? label : label.slice(0, spaceIdx);
      let rest = spaceIdx === -1 ? "" : label.slice(spaceIdx + 1);
      let value = "";
      const parens = rest.match(/^(.*?)\s*(\(.*\)?)\s*$/);
      if (parens) {
        rest = parens[1];
        value = parens[2];
      }
      const dotIdx = column.lastIndexOf(".");
      // Peel the outer parentheses off the value so they can render blue like
      // the query editor's brackets, leaving the inner literal(s) to colour.
      const valueOpen = value.startsWith("(") ? "(" : "";
      const valueClose = value.endsWith(")") ? ")" : "";
      const valueInner = value.slice(
        valueOpen.length,
        value.length - valueClose.length,
      );
      // A value is numeric when its inner content (no quotes/commas) is all
      // numbers → green like a number in the query; otherwise red (string).
      const bare = valueInner.replace(/['"]/g, "").trim();
      const valueIsNumber = bare !== "" && /^-?[\d.\s,]+$/.test(bare);
      return {
        prefix: dotIdx === -1 ? "" : column.slice(0, dotIdx + 1),
        field: dotIdx === -1 ? column : column.slice(dotIdx + 1),
        // Pre-padded — Vue's whitespace condensing strips spaces between the
        // adjacent label spans, so the operator carries its own.
        op: rest ? ` ${rest} ` : "",
        value,
        valueOpen,
        valueInner,
        valueClose,
        valueIsNumber,
      };
    };

    const emitLogicalOperatorChange = (newOperator: SelectModelValue) => {
      emit("logical-operator-change", newOperator);
    };

    const handleFieldChange = (newValue: string) => {
      props.loadFilterItem(newValue);
    };

    const removeColumnName = () => {
      conditionModel.value.column = {};
    };

    watch(
      () => props.condition.column,
      (newColumn, oldColumn) => {
        if (newColumn !== oldColumn) {
          conditionModel.value.values = [];
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
      labelParts,
      t,
      filterStreamFn,
      filterOptions,
      filterListFn,
      emitLogicalOperatorChange,
      handleFieldChange,
      removeColumnName,
      conditionModel,
      filteredSchemaOptions,
      sortedFilteredListOptions: filteredListOptions,
      getAllSelectedStreams,
    };
  },
});
</script>
