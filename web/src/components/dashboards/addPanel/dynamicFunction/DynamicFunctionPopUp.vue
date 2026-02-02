<template>
  <div class="tw:flex tw:gap-2">
    <div style="width: 134px; padding-right: 12px; padding-top: 12px">
      <div class="text-label-bold tw:pb-3">Property</div>
      <div style="display: flex; flex-direction: column; gap: 14px">
        <div>
          <div class="text-label-normal tw:text-sm">Label</div>
          <input
            v-model="fields.label"
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
            data-test="dynamic-function-popup-label-input"
          />
        </div>
        <div>
          <div class="text-label-normal tw:text-sm">Alias</div>
          <input
            v-model="fields.alias"
            disabled
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
            data-test="dynamic-function-popup-alias-input"
          />
        </div>
        <div v-if="!customQuery && !fields.isDerived">
          <SortByBtnGrp :fieldObj="fields" />
        </div>
      </div>
    </div>

    <div
      v-if="!customQuery && !fields.isDerived"
      style="width: calc(100% - 134px)"
    >
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
              <div class="text-label-bold tw:pb-3">Configuration</div>
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

      <div class="tw:pt-2 tw:pr-3" v-if="allowAggregation">
        <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
          <span class="tw:font-bold">Having</span>

          <q-btn
            dense
            outline
            icon="add"
            label="Add"
            padding="xs sm"
            class="el-border"
            no-caps
            @click="toggleHavingFilter"
            v-if="!isHavingFilterVisible()"
            data-test="dynamic-function-popup-having-add-btn"
          />
        </div>

        <div
          class="tw:flex tw:space-x-2 tw:items-center"
          v-if="isHavingFilterVisible()"
        >
          <q-select
            dense
            filled
            v-model="getHavingCondition().operator"
            :options="havingOperators"
            borderless
            style="width: 60px"
            data-test="dynamic-function-popup-having-operator"
          />

          <q-input
            dense
            filled
            v-model.number="getHavingCondition().value"
            style="width: 50%"
            type="number"
            placeholder="Value"
            data-test="dynamic-function-popup-having-value"
          />

          <q-btn
            dense
            flat
            icon="close"
            @click="cancelHavingFilter"
            data-test="dynamic-function-popup-having-cancel-btn"
          />
        </div>
      </div>
      <div v-if="chartType === 'table'" class="q-mt-sm q-mb-sm">
        <div>
          <q-checkbox
            v-model="fields.treatAsNonTimestamp"
            :label="'Mark this field as non-timestamp'"
            dense
            data-test="dynamic-function-popup-treat-as-non-timestamp"
          />
        </div>
        <div class="q-mt-xs">
          <q-checkbox
            v-model="fields.showFieldAsJson"
            :label="'Render Data as JSON / Array'"
            dense
            data-test="dynamic-function-popup-show-field-as-json"
          />
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
    chartType: {
      type: String,
      required: true,
      default: "bar",
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const fields = ref(props.modelValue);

    // if functionName property is missing for build type, selected function Name will be None -> null
    // Ensure functionName property exists for build type fields
    if (fields.value && fields.value.type === 'build' && !('functionName' in fields.value)) {
      fields.value.functionName = null;
    }

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
}

.text-label-normal {
  font-family: "Nunito Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 400;
  line-height: 70%;
  padding-bottom: 3px;
}

.edit-input {
  flex: 1;
  border: 1px solid #e0e0e0;
  line-height: 0px;
  border-radius: 4px;
  padding: 2px;
  outline: none;
  min-width: 0;
  width: 100%;

  &:focus {
    border-color: var(--q-primary);
  }
}
</style>
