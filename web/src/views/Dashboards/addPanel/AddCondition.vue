<template>
  <div class="condition">
    <q-select
      v-if="conditionIndex !== 0"
      v-model="condition.logicalOperator"
      dense
      options-dense
      filled
      :options="filterOptions"
      @update:model-value="emitLogicalOperatorChange"
      class="condition-logical-operator"
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
      >
        <q-menu
          class="q-pa-md"
          @show="(e: any) => loadFilterItem(condition.column)"
        >
          <div style="display: flex">
            <q-select
              v-model="condition.column"
              :options="filteredSchemaOptions"
              label="Filters on Field"
              input-debounce="0"
              behavior="menu"
              dense
              filled
              style="width: 100%"
              use-input
              borderless
              hide-selected
              fill-input
              emit-value
              @filter="filterStreamFn"
              @update:model-value="handleFieldChange"
            />
            <q-btn size="xs" dense @click="removeColumnName" icon="close" />
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
                  ></q-tab>
                  <q-tab
                    dense
                    name="condition"
                    :label="t('common.condition')"
                    style="width: auto"
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
                        filled
                        v-model="condition.operator"
                        :options="operators"
                        :label="t('common.operator')"
                        style="width: 100%"
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
                      filled
                      v-model="condition.values"
                      :options="filteredListOptions"
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
      <q-btn size="xs" dense @click="$emit('remove-condition')" icon="close" />
    </q-btn-group>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, toRef, watch } from "vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useI18n } from "vue-i18n";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";

export default defineComponent({
  name: "AddCondition",
  components: {
    CommonAutoComplete,
    SanitizedHtmlRenderer,
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
    const { t } = useI18n();
    const searchTerm = ref("");
    const { filterFn: filterStreamFn, filteredOptions: filteredSchemaOptions } =
      useSelectAutoComplete(toRef(props, "schemaOptions"), "label");

    const filteredListOptions = computed(() => {
      return props.dashboardPanelData.meta.filterValue
        .find((it: any) => it.column == props.condition.column)
        ?.value.filter((option: any) =>
          option.toLowerCase().includes(searchTerm.value.toLowerCase()),
        );
    });

    const filterListFn = (search: any, update: any) => {
      searchTerm.value = search;
      update(() => filteredListOptions);
    };

    const operators = [
      "=",
      "<>",
      ">=",
      "<=",
      ">",
      "<",
      "IN",
      "Match ALL",
      "Contains",
      "Not Contains",
      "Is Null",
      "Is Not Null",
    ];

    const filterOptions = ["AND", "OR"];

    const computedLabel = (condition: any) => {
      return props.condition.column;
    };

    const emitLogicalOperatorChange = (newOperator: string) => {
      emit("logical-operator-change", newOperator);
    };

    const handleFieldChange = (newValue: string) => {
      props.loadFilterItem(newValue);
    };

    const removeColumnName = () => {
      props.condition.column = "";
    };

    watch(
      () => props.condition.column,
      (newColumn, oldColumn) => {
        if (newColumn !== oldColumn) {
          props.condition.values = [];
        }
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
      filteredListOptions,
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
  width: 55px;
}

:deep(.condition-logical-operator .q-field__control) {
  min-height: 23px !important;
  height: 23px !important;
  padding: 0px 0px 0px 5px !important;
}

:deep(.condition-logical-operator .q-field__native) {
  min-height: 23px !important;
  height: 23px !important;
  padding: 0px 0px 0px 0px !important;
}

:deep(.condition-logical-operator .q-field__append) {
  min-height: 23px !important;
  height: 23px !important;
  padding: 0px 0px 0px 0px !important;
}
</style>
