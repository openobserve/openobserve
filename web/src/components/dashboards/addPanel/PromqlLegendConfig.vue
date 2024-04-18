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
      @update:model-value="fieldsFilterFn"
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
      :style="{
        'background-color': store.state.theme === 'dark' ? '#2d2d2d' : 'white',
      }"
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
import { ref, defineComponent, toRef, watch } from "vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { useI18n } from "vue-i18n";
import { useAutoCompleteForPromql } from "@/composables/useAutoCompleteForPromql";
import { useStore } from "vuex";

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData();
    const { t } = useI18n();
    const showOptions = ref(false);
    let hideOptionsTimeout: any;
    const store = useStore();
    const optionName = ref(
      dashboardPanelData.meta.stream.selectedStreamFields.map(
        (item: any) => item?.name
      )
    );

    // Watch for changes in the selectedStreamFields and update the optionName
    watch(
      () => dashboardPanelData.meta.stream.selectedStreamFields,
      () => {
        optionName.value =
          dashboardPanelData.meta.stream.selectedStreamFields.map(
            (item: any) => item?.name
          );

        fieldsFilteredOptions.value = useAutoCompleteForPromql(
          toRef(optionName),
          "name"
        ).filteredOptions;
      }
    );

    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useAutoCompleteForPromql(toRef(optionName), "name");

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

      const openingBraceIndex = inputValue.lastIndexOf("{");
      const newValue =
        inputValue.slice(0, openingBraceIndex + 1) + option + "}";

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
      store,
    };
  },
});
</script>

<style lang="scss" scoped>
.options-container {
  z-index: 10;
  position: absolute;
  left: 0;
  right: 0;
  border: 1px solid #ccc;
  max-height: 100px;
  overflow-y: auto;
}

.relative {
  position: relative;
}

.option {
  padding: 8px;
  cursor: pointer;
}

.option:hover {
  background-color: #f0f0f0b1;
}
</style>
