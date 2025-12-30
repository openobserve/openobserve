<template>
  <div class="row">
    <q-select
      v-model="fields.functionName"
      label="Select Function"
      :options="filteredFunctions"
      data-test="dashboard-function-dropdown"
      input-debounce="0"
      behavior="menu"
      use-input
      borderless
      dense
      hide-selected
      fill-input
      @filter="filterFunctionsOptions"
      option-label="label"
      option-value="value"
      emit-value
      map-options
      class="tw:w-72 o2-custom-select-dashboard"
    >
    </q-select>
    <div class="tw:w-full tw:p-3 tw:flex tw:gap-2">
      <!-- Loop through the args for the first n-1 arguments -->
      <div class="tw:w-full">
        <div
          v-for="(arg, argIndex) in fields.args"
          :key="argIndex + '-' + arg.type"
          class="tw:w-full tw:flex tw:flex-col"
        >
          <div
            class="tw:flex"
            :style="{
              marginLeft: isChild ? '-60px' : '0px',
            }"
          >
            <div class="tw:mr-2 tw:relative" style="min-height: 50px">
              <!-- Vertical Line using top & bottom instead of height -->
              <div
                class="tw:absolute tw:top-0 tw:w-[1px] tw:bg-[#001495] tw:opacity-50"
                :style="{
                  bottom:
                    argIndex === fields.args.length - 1
                      ? 'calc(100% - 32px)'
                      : '0',
                  left: '0px',
                }"
              ></div>

              <!-- SubTask Arrow -->
              <div class="tw:absolute" style="top: 30px; left: -1px">
                <SubTaskArrow />
              </div>
            </div>

            <div>
              <div class="tw:flex tw:items-center tw:gap-x-2">
                <label :for="'arg-' + argIndex">{{
                  getParameterLabel(fields.functionName, argIndex)
                }}</label>
              </div>
              <div class="tw:flex">
                <!-- type selector -->
                <q-select
                  v-model="fields.args[argIndex].type"
                  @update:model-value="onArgTypeChange(fields.args[argIndex])"
                  :options="
                    getSupportedTypeBasedOnFunctionNameAndIndex(
                      fields.functionName,
                      argIndex,
                    )
                  "
                  option-label="label"
                  option-value="value"
                  behavior="menu"
                  map-options
                  emit-value
                  dense
                  filled
                  :display-value="''"
                  class="o2-custom-select-dashboard arg-type-select tw:mr-0.5"
                  :required="isRequired(fields.functionName, argIndex)"
                  :data-test="`dashboard-function-dropdown-arg-type-selector-${argIndex}`"
                >
                  <template v-slot:prepend>
                    <q-icon
                      :name="getIconBasedOnArgType(fields.args[argIndex].type)"
                      padding="sm"
                    />
                  </template>
                </q-select>
                <!-- Left field selector using StreamFieldSelect -->
                <div
                  class="tw:w-52"
                  v-if="fields.args[argIndex]?.type === 'field'"
                >
                  <StreamFieldSelect
                    :streams="getAllSelectedStreams()"
                    v-model="fields.args[argIndex].value"
                    :data-test="`dashboard-function-dropdown-arg-field-selector-${argIndex}`"
                  />
                </div>

                <q-input
                  v-if="fields.args[argIndex]?.type === 'string'"
                  type="text"
                  v-model="fields.args[argIndex].value"
                  placeholder="Enter string"
                  :required="isRequired(fields.functionName, argIndex)"
                  class="tw:w-52"
                  dense
                  :data-test="`dashboard-function-dropdown-arg-string-input-${argIndex}`"
                />

                <q-input
                  v-if="fields.args[argIndex]?.type === 'number'"
                  type="number"
                  v-model.number="fields.args[argIndex].value"
                  placeholder="Enter number"
                  :required="isRequired(fields.functionName, argIndex)"
                  class="tw:w-52"
                  dense
                  :data-test="`dashboard-function-dropdown-arg-number-input-${argIndex}`"
                />

                <SelectFunction
                  v-if="fields.args[argIndex]?.type === 'function'"
                  v-model="fields.args[argIndex].value"
                  :allowAggregation="allowAggregation"
                  :isChild="true"
                  :data-test="`dashboard-function-dropdown-arg-function-input-${argIndex}`"
                />

                <!-- histogram interval for sql queries -->
                <HistogramIntervalDropDown
                  v-if="fields.args[argIndex]?.type === 'histogramInterval'"
                  :model-value="fields.args[argIndex].value"
                  @update:modelValue="
                    (newValue: any) => {
                      fields.args[argIndex].value = newValue.value;
                    }
                  "
                  class="tw:w-52"
                  :data-test="`dashboard-function-dropdown-arg-histogram-interval-input-${argIndex}`"
                />

                <!-- Remove argument button -->
                <q-btn
                  v-if="canRemoveArgument(fields.functionName, argIndex)"
                  icon="close"
                  dense
                  flat
                  round
                  @click="removeArgument(argIndex)"
                  class="tw:h-10 tw:w-10"
                  :data-test="`dashboard-function-dropdown-arg-remove-button-${argIndex}`"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Add more arguments if allowed -->
      </div>
    </div>
    <q-btn
      v-if="canAddArgument(fields.functionName)"
      @click="addArgument()"
      color="primary"
      label="+ Add"
      padding="5px 14px"
      class="tw:mt-3"
      no-caps
      dense
      :data-test="`dashboard-function-dropdown-add-argument-button`"
    />
  </div>
</template>

<script lang="ts">
import { ref, watch, toRef, computed, inject } from "vue";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import HistogramIntervalDropDown from "../HistogramIntervalDropDown.vue";
import { addMissingArgs } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import SubTaskArrow from "@/components/icons/SubTaskArrow.vue";
import {
  symOutlinedFunction,
  symOutlinedTitle,
  symOutlined123,
  symOutlinedList,
} from "@quasar/extras/material-symbols-outlined";

export default {
  name: "SelectFunction",
  components: { HistogramIntervalDropDown, StreamFieldSelect, SubTaskArrow },
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
    isChild: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { getAllSelectedStreams } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const fields = ref(addMissingArgs(props.modelValue));

    watch(
      () => fields.value,
      () => {
        emit("update:modelValue", fields.value);
      },
      {
        deep: true,
      },
    );

    const filteredFunctions: any = ref([]);

    // Initialize filteredFunctions with all available options
    const initializeFunctions = () => {
      let filteredFunctionsValidation = functionValidation;
      // if allowAggregation is false, filter out aggregation functions
      if (props.allowAggregation === false) {
        filteredFunctionsValidation = filteredFunctionsValidation.filter(
          (v) => !v.isAggregation,
        );
      }

      // None is already included in functionValidation.json, just map all functions
      filteredFunctions.value = filteredFunctionsValidation.map((v) => ({
        label: v.functionLabel,
        value: v.functionName,
      }));
    };

    // Initialize on mount
    initializeFunctions();

    const filterFunctionsOptions = (val: string, update: any) => {
      update(() => {
        let filteredFunctionsValidation = functionValidation;
        // if allowAggregation is false, filter out aggregation functions
        if (props.allowAggregation === false) {
          filteredFunctionsValidation = filteredFunctionsValidation.filter(
            (v) => !v.isAggregation,
          );
        }

        const searchVal = val?.toLowerCase();

        // Filter all functions including None (which is in functionValidation.json)
        filteredFunctions.value = filteredFunctionsValidation
          .map((v) => ({
            label: v.functionLabel,
            value: v.functionName,
          }))
          .filter((v) => v.label.toLowerCase().indexOf(searchVal) > -1);
      });
    };

    // const availableFunctions = ref(["arrzip", "concat", "count", "sum"]);

    const getValidationForFunction = (functionName: string) => {
      return (
        functionValidation.find(
          (v) => v.functionName === (functionName ?? null),
        ) ?? {}
      );
    };

    const canAddArgument = (functionName: string) => {
      const funcValidation: any = getValidationForFunction(functionName);
      return funcValidation?.allowAddArgAt != undefined;
    };

    const canRemoveArgument = (functionName: string, argIndex: number) => {
      const funcValidation: any = getValidationForFunction(functionName);

      // if add arg not allowd, then do not allow to remove argument
      if (funcValidation?.allowAddArgAt === undefined) return false;

      const argsValidation = funcValidation?.args || [];
      const allowAddArgAt = funcValidation?.allowAddArgAt;

      // Determine the actual index based on allowAddArgAt
      const adjustedIndex = getAdjustedIndex(
        argsValidation,
        argIndex,
        allowAddArgAt,
      );

      const minArg = argsValidation[adjustedIndex]?.min ?? 0;
      const functionTotalArgs = argsValidation.length;
      const addedArgCount = argIndex + 1 - (functionTotalArgs - 1);

      return addedArgCount > minArg;
    };

    const addArgument = () => {
      const funcValidation: any = getValidationForFunction(
        fields.value.functionName,
      );

      const adjustedIndex = getAdjustedIndex(
        funcValidation?.args || [],
        fields.value.args.length - 1,
        funcValidation?.allowAddArgAt,
      );

      if (canAddArgument(fields.value.functionName)) {
        if (funcValidation.allowAddArgAt === "n") {
          fields.value.args.push({
            type: funcValidation?.args?.[adjustedIndex]?.type?.[0]?.value,
            value: "",
          });
        } else if (funcValidation.allowAddArgAt === "n-1") {
          // Add an argument before the separator
          fields.value.args.splice(fields.value.args.length - 1, 0, {
            type: funcValidation?.args?.[adjustedIndex]?.type?.[0]?.value, // Add default type (e.g., field, string, etc.)
            value: "",
          });
        }
      }
    };

    const removeArgument = (argIndex: number) => {
      fields.value.args.splice(argIndex, 1);
    };

    const isRequired = (functionName: string, argIndex: number) => {
      const funcValidation: any = getValidationForFunction(functionName);

      // NOTE: get relavent arg from validation
      return funcValidation?.args?.[argIndex]?.required ?? false;
    };

    const getNonSeparatorArgs = (field: any) => {
      // Return the first n-1 arguments (non-separator)
      return field.args.slice(0, field.args.length - 1);
    };

    const getSeparatorArg = (field: any) => {
      // Return the last argument (separator)
      return field.args[field.args.length - 1];
    };

    // Helper function to adjust the index based on allowAddArgAt
    const getAdjustedIndex = (
      argsValidation: any,
      argIndex: number,
      allowAddArgAt: any,
    ) => {
      const totalArgs = argsValidation.length;

      // Handle different cases for allowAddArgAt
      if (allowAddArgAt === "n") {
        // 'n' means the argument is added at the end
        return totalArgs - 1;
      } else if (allowAddArgAt === "n-1") {
        // 'n-1' means the argument should be added before the last argument
        // if it is last argument
        if (argIndex === totalArgs - 1) {
          return totalArgs - 1;
        } else {
          return Math.min(argIndex, totalArgs - 2);
        }
      } else if (typeof allowAddArgAt === "number") {
        // If allowAddArgAt is a specific index, return that index
        // NOTE: NEED TO REWORK ON THIS CASE
        return Math.min(allowAddArgAt, totalArgs); // Ensure we don't exceed the total number of args
      } else {
        // Default case: return the provided argIndex without adjustment
        return argIndex;
      }
    };

    const getSupportedTypeBasedOnFunctionNameAndIndex = (
      functionName: string,
      argIndex: number,
    ) => {
      const funcValidation: any = getValidationForFunction(functionName);

      if (!funcValidation) {
        return [];
      }

      const argsValidation = funcValidation?.args || [];
      const allowAddArgAt = funcValidation?.allowAddArgAt;

      // Determine the actual index based on allowAddArgAt
      const adjustedIndex = getAdjustedIndex(
        argsValidation,
        argIndex,
        allowAddArgAt,
      );

      // Return the type for the adjusted index, or an empty array if the index is out of bounds
      return argsValidation[adjustedIndex]?.type || [];
    };

    // watcher on functionName
    watch(
      () => fields.value.functionName,
      (newVal) => {
        // Save the old args
        const oldArgs = [...fields.value.args];

        // get the validation for the selected function
        const funcValidation: any = getValidationForFunction(
          fields.value.functionName,
        );

        // rebuild fields.value.args based on funcValidation.args
        if (funcValidation) {
          // Create new args array based on validation
          const newArgs = (funcValidation?.args ?? []).flatMap((arg: any) =>
            // need to consider `min` config for each arg
            Array.from({ length: arg.min ?? 1 }).map(() => ({
              type: arg.type[0]?.value,
              value: arg.type[0]?.value === "field" ? {} : arg?.defaultValue,
            })),
          );

          // Preserve field values where both old and new types are "field"
          for (let i = 0; i < newArgs.length && i < oldArgs.length; i++) {
            if (newArgs[i].type === "field" && oldArgs[i].type === "field") {
              newArgs[i].value = oldArgs[i].value;
            }
          }

          fields.value.args = newArgs;
        }
      },
    );

    const onArgTypeChange = (arg: any) => {
      if (arg.type === "field") {
        arg.value = {};
      } else if (arg.type === "string") {
        arg.value = "";
      } else if (arg.type === "number") {
        arg.value = 0;
      } else if (arg.type === "boolean") {
        arg.value = false;
      } else if (arg.type === "function") {
        arg.value = {
          functionName: null,
          args: [],
          value: "",
        };
      } else if (arg.type === "histogramInterval") {
        arg.value = null;
      }
    };

    const getIconBasedOnArgType = (type: string) => {
      switch (type) {
        case "field":
          return symOutlinedList;
        case "function":
          return symOutlinedFunction;
        case "string":
          return symOutlinedTitle;
        case "number":
          return symOutlined123;
        case "histogramInterval":
          return "bar_chart";
      }
    };

    const getParameterLabel = (functionName: string, argIndex: number) => {
      const funcValidation: any = getValidationForFunction(functionName);

      if (!funcValidation) {
        return `Parameter ${argIndex + 1}`;
      }

      const argsValidation = funcValidation?.args || [];
      const allowAddArgAt = funcValidation?.allowAddArgAt;

      // Determine the actual index based on allowAddArgAt
      const adjustedIndex = getAdjustedIndex(
        argsValidation,
        argIndex,
        allowAddArgAt,
      );

      // Return the label from validation, or fallback to default
      return (
        argsValidation[adjustedIndex]?.label || `Parameter ${argIndex + 1}`
      );
    };

    return {
      fields,
      // availableFunctions,
      getValidationForFunction,
      canAddArgument,
      canRemoveArgument,
      addArgument,
      removeArgument,
      isRequired,
      getNonSeparatorArgs,
      getSeparatorArg,
      getSupportedTypeBasedOnFunctionNameAndIndex,
      filteredFunctions,
      filterFunctionsOptions,
      initializeFunctions,
      onArgTypeChange,
      getAllSelectedStreams,
      getIconBasedOnArgType,
      getParameterLabel,
    };
  },
};
</script>

<style lang="scss" scoped>
.arg-type-select {
  :deep(.q-field__control) {
    background-color: transparent !important;
    border: 1px solid var(--o2-border-color) !important;
    border-radius: 4px !important;
    align-items: center !important;
  }

  :deep(.q-field__control):before,
  :deep(.q-field__control):after {
    display: none !important;
  }

  :deep(.q-field):before,
  :deep(.q-field):after {
    display: none !important;
  }

  :deep(.q-field__append) {
    align-items: center !important;
  }

  :deep(.q-field__prepend) {
    align-items: center !important;
  }

  :deep(.q-field__append .q-icon) {
    color: var(--o2-primary-btn-bg) !important;
    font-size: 18px !important;
  }

  :deep(.q-field__prepend .q-icon) {
    color: var(--o2-primary-btn-bg) !important;
    font-size: 18px !important;
  }
}
</style>
