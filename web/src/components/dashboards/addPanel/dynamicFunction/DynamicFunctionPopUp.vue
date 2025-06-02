<template>
  <div class="tw-flex tw-gap-2">
    <div style="width: 134px; padding-right: 12px; padding-top: 12px">
      <div class="text-label-bold tw-pb-3">Property</div>
      <div style="display: flex; flex-direction: column; gap: 14px">
        <div>
          <div class="text-label-normal tw-text-sm">Label</div>
          <input
            v-model="fields.label"
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
          />
        </div>
        <div>
          <div class="text-label-normal tw-text-sm">Alias</div>
          <input
            v-model="fields.alias"
            disabled
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
          />
        </div>
        <div v-if="!customQuery && !fields.isDerived">
          <SortByBtnGrp :fieldObj="fields" />
        </div>
      </div>
    </div>

    <div v-if="!customQuery" style="width: calc(100% - 134px)">
      <!-- active-color="primary" -->
      <!-- narrow-indicator -->
      <!-- class="text-grey" -->
      <!-- indicator-color="primary" -->
      <q-tabs
        v-model="fields.type"
        @update:modelValue="onFieldTypeChange"
        dense
        data-test="dynamic-function-popup-tabs"
        :align="'left'"
      >
        <q-tab
          name="build"
          label="Build"
          data-test="dynamic-function-popup-tab-build"
          class="tab-item-bold"
        />
        <q-tab
          name="raw"
          label="Raw"
          data-test="dynamic-function-popup-tab-raw"
          class="tab-item-bold"
        />
      </q-tabs>

      <q-separator />

      <q-tab-panels v-model="fields.type" animated>
        <q-tab-panel name="build" style="padding: 0px; padding-top: 8px">
          <div style="display: flex">
            <div style="width: calc(100% - 134px)">
              <div class="text-label-bold tw-pb-3">Configuration</div>
              <SelectFunction
                v-model="fields"
                data-test="dynamic-function-popup-select-function"
                :allowAggregation="allowAggregation"
              />
            </div>
          </div>
        </q-tab-panel>
        <q-tab-panel name="raw" style="padding: 0px; padding-top: 8px">
          <div style="display: flex; width: 100%">
            <div style="width: 100%; padding-right: 12px">
              <RawQueryBuilder
                v-model="fields"
                data-test="dynamic-function-popup-raw-query-builder"
              />
            </div>
          </div>
        </q-tab-panel>
      </q-tab-panels>

      <div
        class="tw-flex tw-justify-between tw-items-center tw-pt-2 tw-pr-3"
        v-if="allowAggregation"
      >
        <span class="tw-block tw-mb-1 tw-font-bold">Having</span>

        <q-btn
          dense
          outline
          icon="add"
          label="Add"
          padding="sm sm"
          no-caps
          @click="toggleHavingFilter"
          v-if="!isHavingFilterVisible()"
        />

        <div
          class="tw-flex tw-space-x-2 tw-mt-2 tw-items-center"
          v-if="isHavingFilterVisible()"
        >
          <q-select
            dense
            filled
            v-model="getHavingCondition().operator"
            :options="havingOperators"
            style="width: 30%"
          />

          <q-input
            dense
            filled
            v-model.number="getHavingCondition().value"
            style="width: 50%"
            type="number"
            placeholder="Value"
          />

          <q-btn dense flat icon="close" @click="cancelHavingFilter" />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { ref, watch, nextTick } from "vue";
import RawQueryBuilder from "./RawQueryBuilder.vue";
import SelectFunction from "./SelectFunction.vue";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
export default {
  name: "DynamicFunctionPopUp",
  components: { RawQueryBuilder, SelectFunction, SortByBtnGrp },
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
    allowAggregation: {
      type: Boolean,
      required: false,
      default: false,
    },
    customQuery: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();
    //   const dashboardPanelDataPageKey = inject(
    //     "dashboardPanelDataPageKey",
    //     "dashboard",
    //   );
    //   const { dashboardPanelData } = useDashboardPanelData(
    //     dashboardPanelDataPageKey
    //   );

    const fields = ref(props.modelValue);

    const store = useStore();

    watch(
      () => fields.value,
      (value) => {
        emit("update:modelValue", value);
      },
      { deep: true },
    );

    const onFieldTypeChange = () => {
      // reset fields object
      if (fields.value.type === "build") {
        fields.value.rawQuery = "";
      } else {
        fields.value.functionName = null;
        fields.value.args = [
          {
            type: "field",
            value: {},
          },
        ];
      }
    };

    const havingOperators = ["=", "<>", ">=", "<=", ">", "<"];

    const isHavingFilterVisible = () => {
      const isVisible = !!fields.value?.havingConditions?.length;
      return isVisible;
    };

    const toggleHavingFilter = async () => {
      if (!fields.value?.havingConditions) {
        fields.value.havingConditions = [];
      }

      if (!fields.value.havingConditions.length) {
        fields.value.havingConditions.push({ operator: null, value: null });
      }

      await nextTick();
    };

    const cancelHavingFilter = async () => {
      fields.value.havingConditions = [];

      await nextTick();
    };

    const getHavingCondition = () => {
      return (
        fields.value.havingConditions?.[0] || { operator: null, value: null }
      );
    };

    return {
      store,
      t,
      fields,
      onFieldTypeChange,
      havingOperators,
      isHavingFilterVisible,
      toggleHavingFilter,
      cancelHavingFilter,
      getHavingCondition,
    };
  },
};
</script>
<style scoped>
.tab-item {
  flex: 0 1 auto !important;
  padding: 10px 16px !important;
}

.text-label-bold {
  font-family: "Nunito Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}

.text-label-normal {
  font-family: "Nunito Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
}

.edit-input {
  flex: 1;
  border: 1px solid var(--q-primary);
  border-radius: 4px;
  padding: 2px;
  outline: none;
  min-width: 0;
  width: 100%;

  &:focus {
    border-color: var(--q-secondary);
  }
}
</style>
