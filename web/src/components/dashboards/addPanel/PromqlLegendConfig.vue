<template>
  <div class="relative">
    <q-input
      v-if="promqlMode"
      v-model="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.promql_legend
      "
      :label="t('common.legend')"
      color="input-border"
      bg-color="input-bg"
      class="q-pt-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      data-test="dashboard-config-promql-legend"
      @change="fieldsFilterFn"
      @focus="showOptions = true"
      @blur="hideOptionsWithDelay"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          {{ t("dashboard.legendLabel") }}
          <div>
            <q-icon
              class="q-ml-xs"
              size="20px"
              name="info"
              data-test="dashboard-config-promql-legend-info"
            />
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              {{ t("dashboard.overrideMessage") }}
            </q-tooltip>
          </div>
        </div>
      </template>
    </q-input>
    <div
      class="options-container"
      v-if="promqlMode && showOptions && fieldsFilteredOptions.length > 0"
    >
      <div
        v-for="(option, index) in fieldsFilteredOptions"
        :key="index"
        class="option"
        @click="selectOption(option)"
      >
        {{ option }}
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { ref, defineComponent, toRef } from "vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { useI18n } from "vue-i18n";
import { useSelectAutoComplete2 } from "@/composables/useSelectAutoComplete2";

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData();
    const { t } = useI18n();
    const showOptions = ref(false);
    let hideOptionsTimeout: any;

    const optionName = dashboardPanelData.meta.stream.selectedStreamFields.map(
      (item: any) => item?.name
    );
    console.log("optionName", optionName);

    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete2(toRef(optionName), "name");

    console.log("fieldsFilteredOptions", fieldsFilteredOptions.value);

    const hideOptionsWithDelay = () => {
      hideOptionsTimeout = setTimeout(() => {
        showOptions.value = false;
      }, 200);
    };

    const selectOption = (option: any) => {
      const inputValue =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.promql_legend;

      const newValue = inputValue + option;
      console.log("newValue", newValue);

      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].config.promql_legend = newValue;

      showOptions.value = false;
    };

    return {
      t,
      dashboardPanelData,
      promqlMode,
      fieldsFilterFn,
      fieldsFilteredOptions,
      selectOption,
      showOptions,
      hideOptionsWithDelay,
    };
  },
});
</script>

<style lang="scss" scoped>
.options-container {
  border: 1px solid #ccc;
  max-height: 100px;
  overflow-y: auto;
}

.option {
  padding: 8px;
  cursor: pointer;
}

.option:hover {
  background-color: #f0f0f0b1;
}
</style>
