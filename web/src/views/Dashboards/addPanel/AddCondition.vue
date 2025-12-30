<template>
  <div class="condition">
    <q-select
      v-if="conditionIndex !== 0"
      v-model="condition.logicalOperator"
      dense
      options-dense
      borderless
      hide-bottom-space
      :options="filterOptions"
      @update:model-value="emitLogicalOperatorChange"
      class="condition-logical-operator"
      :data-test="`dashboard-add-condition-logical-operator-${conditionIndex}}`"
    />
    <q-btn-group>
      <q-btn
        square
        icon-right="arrow_drop_down"
        no-caps
        dense
        :no-wrap="true"
        color="primary"
        size="sm"
        :label="computedLabel(condition)"
        class="q-pl-sm"
        :data-test="`dashboard-add-condition-label-${conditionIndex}-${computedLabel(condition)}`"
      >
        <q-menu
          class="q-pa-md"
          @show="(e: any) => loadFilterItem(condition.column)"
        >
          <div style="display: flex">
            <StreamFieldSelect
              class="tw:w-full"
              :streams="getAllSelectedStreams()"
              v-model="condition.column"
              :data-test="`dashboard-add-condition-column-${conditionIndex}}`"
            />
            <q-btn
              size="xs"
              dense
              @click="removeColumnName"
              icon="close"
              :data-test="`dashboard-add-condition-remove-column-${conditionIndex}`"
            />
          </div>
          <div style="height: 100%">
            <div class="q-pa-xs" style="height: 100%">
              <div class="q-gutter-xs" style="height: 100%">
                <q-tabs v-model="condition.type" dense>
                  <q-tab
                    dense
                    name="list"
                    :label="t('common.list')"
                    style="width: auto"
                    :data-test="`dashboard-add-condition-list-${conditionIndex}`"
                  ></q-tab>
                  <q-tab
                    dense
                    name="condition"
                    :label="t('common.condition')"
                    style="width: auto"
                    :data-test="`dashboard-add-condition-condition-${conditionIndex}`"
                  ></q-tab>
                </q-tabs>
                <q-separator></q-separator>
                <q-tab-panels
                  v-model="condition.type"
                  dense
                  animated
                  style="height: 100%"
                >
                  <q-tab-panel dense name="condition" class="q-pa-none">
                    <div class="flex column" style="height: 220px">
                      <q-select
                        dense
                        borderless
                        hide-bottom-space
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
                  </q-tab-panel>
                  <q-tab-panel dense name="list" class="q-pa-none">
                    <q-select
                      dense
                      borderless
                      v-model="condition.values"
                      :options="sortedFilteredListOptions"
                      :label="t('common.selectFilter')"
                      multiple
                      emit-value
                      map-options
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
                        <q-item v-bind="itemProps">
                          <q-item-section side>
                            <q-checkbox
                              dense
                              :model-value="selected"
                              @update:model-value="toggleOption(opt)"
                              data-test="dashboard-add-condition-list-item"
                            ></q-checkbox>
                          </q-item-section>
                          <q-item-section>
                            <SanitizedHtmlRenderer :html-content="opt" />
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                  </q-tab-panel>
                </q-tab-panels>
              </div>
            </div>
          </div>
        </q-menu>
      </q-btn>
      <q-btn
        size="xs"
        dense
        @click="$emit('remove-condition')"
        icon="close"
        data-test="dashboard-add-condition-remove"
      />
    </q-btn-group>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, toRef, watch, inject } from "vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useI18n } from "vue-i18n";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";

export default defineComponent({
  name: "AddCondition",
  components: {
    CommonAutoComplete,
    SanitizedHtmlRenderer,
    StreamFieldSelect,
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
    const { getAllSelectedStreams, getStreamNameFromStreamAlias, dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );
    const { t } = useI18n();
    const searchTerm = ref("");
    const { filterFn: filterStreamFn, filteredOptions: filteredSchemaOptions } =
      useSelectAutoComplete(toRef(props, "schemaOptions"), "label");

    const filteredListOptions = computed(() => {
      const options = props.dashboardPanelData.meta.filterValue
        .find(
          (it: any) =>
            it.column == props?.condition?.column?.field &&
            it.stream == getStreamNameFromStreamAlias(props?.condition?.column?.streamAlias),
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

    const filterOptions = ["AND", "OR"];

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

.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;
  .q-virtual-scroll__content {
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
  margin-top: 4px; /* Nudge up slightly to align with buttons */
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
