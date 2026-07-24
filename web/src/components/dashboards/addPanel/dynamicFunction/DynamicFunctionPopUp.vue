<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div data-test="dynamic-function-popup-root" class="flex flex-col">
    <!-- Body -->
    <div :class="fullMode ? 'flex min-h-0' : 'flex flex-col'">
      <!-- Property pane -->
      <div
        class="flex w-52 shrink-0 flex-col gap-3.5 p-3"
        :class="fullMode ? 'border-e border-border-default' : ''"
      >
        <div
          class="text-compact font-semibold"
          data-test="dynamic-function-popup-property-label"
        >
          {{ t('dashboard.dynamicFunctionPopUp.property') }}
        </div>

        <div class="flex flex-col gap-1">
          <div
            class="text-2xs font-semibold text-text-secondary"
            data-test="dynamic-function-popup-label-text"
          >
            {{ t('dashboard.dynamicFunctionPopUp.label') }}
          </div>
          <OInput
            v-model="fields.label"
            size="sm"
            class="w-full"
            data-test="dynamic-function-popup-label-input"
          />
        </div>

        <div class="flex flex-col gap-1">
          <div
            class="text-2xs font-semibold text-text-secondary"
          >
            {{ t('dashboard.dynamicFunctionPopUp.alias') }}
          </div>
          <OInput
            v-model="fields.alias"
            size="sm"
            disabled
            class="w-full"
            data-test="dynamic-function-popup-alias-input"
          >
            <template #icon-right>
              <OIcon name="lock" size="xs" class="text-text-secondary" />
            </template>
          </OInput>
        </div>

        <div v-if="fullMode" class="flex flex-col gap-1">
          <div
            class="text-compact font-semibold"
            data-test="dynamic-function-popup-sort-by-label"
          >
            {{ t('dashboard.dynamicFunctionPopUp.sortBy') }}
          </div>
          <SortByBtnGrp :fieldObj="fields" />
        </div>
      </div>

      <!-- Configuration pane. Rendered in fullMode, and also for table charts so
           the non-timestamp / JSON toggles stay reachable in custom-query/derived mode. -->
      <div
        v-if="fullMode || chartType === 'table'"
        class="flex min-w-0 flex-1 flex-col p-3"
      >
        <template v-if="fullMode">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="text-compact font-semibold">
            {{
              fields.type === 'build'
                ? t('dashboard.dynamicFunctionPopUp.configuration')
                : t('dashboard.rawQueryBuilder.query')
            }}
          </div>
          <OButtonGroup
            data-test="dynamic-function-popup-tabs"
            class="ms-auto shrink-0"
          >
            <OButton
              :active="fields.type === 'build'"
              variant="outline"
              size="sm"
              data-test="dynamic-function-popup-tab-build"
              @click="setFieldType('build')"
            >
              {{ t('dashboard.dynamicFunctionPopUp.build') }}
            </OButton>
            <OButton
              :active="fields.type === 'raw'"
              variant="outline"
              size="sm"
              data-test="dynamic-function-popup-tab-raw"
              @click="setFieldType('raw')"
            >
              {{ t('dashboard.dynamicFunctionPopUp.raw') }}
            </OButton>
          </OButtonGroup>
        </div>

        <!-- -m-1 p-1: padding so focus rings aren't clipped, margin keeps alignment -->
        <div class="min-h-0 max-h-105 overflow-auto -m-1 p-1">
          <SelectFunction
            v-if="fields.type === 'build'"
            v-model="fields"
            data-test="dynamic-function-popup-select-function"
            :allowAggregation="allowAggregation"
          />
          <RawQueryBuilder
            v-else
            v-model="fields"
            data-test="dynamic-function-popup-raw-query-builder"
          />
        </div>

        <div
          v-if="allowAggregation"
          class="mt-3 border-t border-border-default pt-3"
        >
          <div class="mb-2 flex items-baseline gap-2">
            <span class="text-compact font-semibold">{{
              t('dashboard.dynamicFunctionPopUp.having')
            }}</span>
            <span class="text-xs text-text-secondary">{{
              t('dashboard.dynamicFunctionPopUp.havingHint')
            }}</span>

            <OButton
              v-if="!isHavingFilterVisible()"
              variant="outline"
              size="sm"
              class="ms-auto"
              data-test="dynamic-function-popup-having-add-btn"
              icon-left="add"
              @click="toggleHavingFilter"
            >
              {{ t('dashboard.dynamicFunctionPopUp.add') }}
            </OButton>
          </div>

          <div
            v-if="isHavingFilterVisible()"
            class="flex items-center gap-2"
          >
            <div class="w-24 shrink-0">
              <OSelect
                v-model="getHavingCondition().operator"
                :options="havingOperators"
                data-test="dynamic-function-popup-having-operator"
              />
            </div>

            <div class="min-w-0 flex-1">
              <OInput
                v-model.number="getHavingCondition().value"
                type="number"
                :placeholder="t('dashboard.dynamicFunctionPopUp.value')"
                data-test="dynamic-function-popup-having-value"
              />
            </div>

            <OButton
              variant="outline"
              size="icon"
              class="shrink-0"
              data-test="dynamic-function-popup-having-cancel-btn"
              icon-left="close"
              @click="cancelHavingFilter"
            >
            </OButton>
          </div>
        </div>
        </template>

        <div v-if="chartType === 'table'" class="mt-3 flex flex-col gap-1">
          <OCheckbox
            v-model="fields.treatAsNonTimestamp"
            :label="t('dashboard.dynamicFunctionPopUp.markAsNonTimestamp')"
            data-test="dynamic-function-popup-treat-as-non-timestamp"
          />
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
import { ref, computed, watch, nextTick } from "vue";
import RawQueryBuilder from "./RawQueryBuilder.vue";
import SelectFunction from "./SelectFunction.vue";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

export default {
  name: "DynamicFunctionPopUp",
  components: {
    RawQueryBuilder,
    SelectFunction,
    SortByBtnGrp,
    OButton,
    OButtonGroup,
    OSelect,
    OInput,
    OIcon,
    OCheckbox,
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

    const fullMode = computed(
      () => !props.customQuery && !fields.value?.isDerived,
    );

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

    const setFieldType = (type: string) => {
      if (fields.value.type === type) return;
      fields.value.type = type;
      onFieldTypeChange();
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
      fullMode,
      setFieldType,
      havingOperators,
      isHavingFilterVisible,
      toggleHavingFilter,
      cancelHavingFilter,
      getHavingCondition,
    };
  },
};
</script>
