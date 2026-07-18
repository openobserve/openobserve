<template>
  <div
    data-test="dynamic-function-popup-root"
    :class="
      !customQuery && !fields.isDerived
        ? 'flex gap-2'
        : 'flex flex-col gap-y-2'
    "
  >
    <div style="width: auto; flex-shrink: 0;">
      <div class="font-semibold text-[13px] pb-3" data-test="dynamic-function-popup-property-label">{{ t('dashboard.dynamicFunctionPopUp.property') }}</div>
      <div style="display: flex; flex-direction: column; gap: 14px">
        <div>
          <div class="text-[13px] font-normal leading-[70%] pb-0.75" data-test="dynamic-function-popup-label-text">{{ t('dashboard.dynamicFunctionPopUp.label') }}</div>
          <OInput
            v-model="fields.label"
            size="sm"
            class="w-full"
            data-test="dynamic-function-popup-label-input"
          />
        </div>
        <div>
          <div class="text-[13px] font-normal leading-[70%] pb-0.75">{{ t('dashboard.dynamicFunctionPopUp.alias') }}</div>
          <OInput
            v-model="fields.alias"
            size="sm"
            disabled
            class="w-full"
            data-test="dynamic-function-popup-alias-input"
          />
        </div>
        <div v-if="!customQuery && !fields.isDerived">
          <SortByBtnGrp :fieldObj="fields" />
        </div>
      </div>
    </div>

    <div
      :style="
        !customQuery && !fields.isDerived
          ? 'flex: 1; min-width: 0; display: flex; flex-direction: column;'
          : 'width: max-content;'
      "
    >
      <OTabs
        v-if="!customQuery && !fields.isDerived"
        v-model="fields.type"
        @update:modelValue="onFieldTypeChange"
        dense
        data-test="dynamic-function-popup-tabs"
        :align="'left'"
      >
        <OTab
          name="build"
          :label="t('dashboard.dynamicFunctionPopUp.build')"
          class="flex-1"
          data-test="dynamic-function-popup-tab-build"
        />
        <OTab
          name="raw"
          :label="t('dashboard.dynamicFunctionPopUp.raw')"
          class="flex-1"
          data-test="dynamic-function-popup-tab-raw"
        />
      </OTabs>

      <OSeparator v-if="!customQuery && !fields.isDerived" />

      <OTabPanels
        v-if="!customQuery && !fields.isDerived"
        v-model="fields.type"
        animated
      >
        <OTabPanel name="build">
          <div class="pt-2" style="max-height: 26.25rem; overflow: auto;">
            <div class="font-semibold text-[13px] pb-3">{{ t('dashboard.dynamicFunctionPopUp.configuration') }}</div>
            <SelectFunction
              v-model="fields"
              data-test="dynamic-function-popup-select-function"
              :allowAggregation="allowAggregation"
            />
          </div>
        </OTabPanel>
        <OTabPanel name="raw">
          <div class="pt-2">
            <div style="display: flex; width: 100%">
              <div style="width: 100%; padding-right: 0.75rem">
                <RawQueryBuilder
                  v-model="fields"
                  data-test="dynamic-function-popup-raw-query-builder"
                />
              </div>
            </div>
          </div>
        </OTabPanel>
      </OTabPanels>

      <div
        class="pt-2 pr-3"
        v-if="!customQuery && !fields.isDerived && allowAggregation"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="font-bold">{{ t('dashboard.dynamicFunctionPopUp.having') }}</span>

          <OButton
            variant="outline"
            size="sm"
            @click="toggleHavingFilter"
            v-if="!isHavingFilterVisible()"
            data-test="dynamic-function-popup-having-add-btn"
            icon-left="add"
          >
            {{ t('dashboard.dynamicFunctionPopUp.add') }}
          </OButton>
        </div>

        <div
          class="flex space-x-2 items-center"
          v-if="isHavingFilterVisible()"
        >
          <OSelect
            v-model="getHavingCondition().operator"
            :options="havingOperators"
            class="w-[60px]"
            data-test="dynamic-function-popup-having-operator"
          />

          <OInput
            v-model.number="getHavingCondition().value"
            class="w-1/2"
            type="number"
            :placeholder="t('dashboard.dynamicFunctionPopUp.value')"
            data-test="dynamic-function-popup-having-value"
          />

          <OButton
            variant="ghost"
            size="icon"
            @click="cancelHavingFilter"
            data-test="dynamic-function-popup-having-cancel-btn"
            icon-left="close"
          >
          </OButton>
        </div>
      </div>
      <div v-if="chartType === 'table'" class="mt-2 mb-2">
        <div>
          <OCheckbox
            v-model="fields.treatAsNonTimestamp"
            :label="t('dashboard.dynamicFunctionPopUp.markAsNonTimestamp')"
            data-test="dynamic-function-popup-treat-as-non-timestamp"
          />
        </div>
        <div class="mt-1">
          <OCheckbox
            v-model="fields.showFieldAsJson"
            :label="t('dashboard.dynamicFunctionPopUp.renderDataAsJson')"
            data-test="dynamic-function-popup-show-field-as-json"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import { ref, watch, nextTick } from "vue";
import RawQueryBuilder from "./RawQueryBuilder.vue";
import SelectFunction from "./SelectFunction.vue";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
export default {
  name: "DynamicFunctionPopUp",
  components: {
    RawQueryBuilder,
    SelectFunction,
    SortByBtnGrp,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OButton,
    OSelect,
    OInput,
    OCheckbox,
    OSeparator,
  },
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
    if (
      fields.value &&
      fields.value.type === "build" &&
      !("functionName" in fields.value)
    ) {
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
        fields.value.havingConditions.push({ operator: "=", value: null });
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
