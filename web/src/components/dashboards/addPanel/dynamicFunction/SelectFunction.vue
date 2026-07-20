<template>
  <div class="flex flex-col">
    <div class="w-60 flex-none">
      <OSelect
        v-model="fields.functionName"
        :label="t('dashboard.selectFunction.selectFunction')"
        label-position="inside"
        :options="filteredFunctions"
        data-test="dashboard-function-dropdown"
        class="w-full"
        @search="onFunctionSearch"
      />
    </div>
    <div class="w-full mt-2">
      <!-- Loop through the args for the first n-1 arguments -->
      <div class="w-full">
        <div
          v-for="(arg, argIndex) in fields.args"
          :key="argIndex + '-' + arg.type"
          class="w-full flex flex-col"
        >
          <div
            class="flex"
            :style="{ marginLeft: isChild ? '-48px' : '0px' }"
          >
            <div class="mr-2 relative w-3 min-h-12.5">
              <!-- Vertical Line using top & bottom instead of height -->
              <div
                class="absolute top-0 w-px bg-accent opacity-50"
                :style="{
                  bottom:
                    argIndex === fields.args.length - 1
                      ? 'calc(100% - 32px)'
                      : '0',
                  left: '6px',
                }"
              ></div>

              <!-- SubTask Arrow -->
              <div class="absolute top-7.5 left-1.25 text-text-secondary">
                <SubTaskArrow />
              </div>
            </div>

            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center gap-x-2">
                <label :for="'arg-' + argIndex">{{
                  getParameterLabel(fields.functionName, argIndex)
                }}</label>
              </div>
              <div class="flex items-start">
                <!-- type selector -->
                <OSelect
                  v-model="fields.args[argIndex].type"
                  @update:model-value="onArgTypeChange(fields.args[argIndex])"
                  :options="
                    getSupportedTypeBasedOnFunctionNameAndIndex(
                      fields.functionName,
                      argIndex,
                    )
                  "
                  icon-key="icon"
                  label-position="inside"
                  class="o2-custom-select-dashboard arg-type-select mr-0.5 w-fit! flex-none!"
                  :required="isRequired(fields.functionName, argIndex)"
                  :data-test="`dashboard-function-dropdown-arg-type-selector-${argIndex}`"
                >
                  <template #icon-left>
                    <OIcon
                      :name="getIconBasedOnArgType(fields.args[argIndex].type)"
                      size="sm"
                    />
                  </template>
                  <template #trigger><!-- icon-only --></template>
                </OSelect>
                <!-- Left field selector using StreamFieldSelect -->
                <div
                  class="w-52"
                  v-if="fields.args[argIndex]?.type === 'field'"
                >
                  <StreamFieldSelect
                    :streams="getAllSelectedStreams()"
                    v-model="fields.args[argIndex].value"
                    :data-test="`dashboard-function-dropdown-arg-field-selector-${argIndex}`"
                  />
                </div>

                <div
                  v-if="fields.args[argIndex]?.type === 'string'"
                  class="w-52 flex-none"
                >
                  <OInput
                    type="text"
                    v-model="fields.args[argIndex].value"
                    :placeholder="t('dashboard.selectFunction.enterString')"
                    class="w-full"
                    :data-test="`dashboard-function-dropdown-arg-string-input-${argIndex}`"
                  />
                </div>

                <OInput
                  v-if="fields.args[argIndex]?.type === 'number'"
                  type="number"
                  v-model.number="fields.args[argIndex].value"
                  :placeholder="t('dashboard.selectFunction.enterNumber')"
                  class="w-52"
                  :data-test="`dashboard-function-dropdown-arg-number-input-${argIndex}`"
                />

                <!-- histogram interval for sql queries -->
                <div
                  v-if="fields.args[argIndex]?.type === 'histogramInterval'"
                  class="w-52 flex-none"
                >
                  <HistogramIntervalDropDown
                    :model-value="fields.args[argIndex].value"
                    @update:modelValue="
                      (newValue: any) => {
                        fields.args[argIndex].value = newValue;
                      }
                    "
                    class="w-full"
                    :data-test="`dashboard-function-dropdown-arg-histogram-interval-input-${argIndex}`"
                  />
                </div>

                <!-- Nested function inline with type selector -->
                <SelectFunction
                  v-if="fields.args[argIndex]?.type === 'function'"
                  v-model="fields.args[argIndex].value"
                  :allowAggregation="allowAggregation"
                  :isChild="true"
                  :data-test="`dashboard-function-dropdown-arg-function-input-${argIndex}`"
                />

                <!-- Remove argument button -->
                <OButton
                  v-if="canRemoveArgument(fields.functionName, argIndex)"
                  variant="ghost"
                  size="icon"
                  @click="removeArgument(argIndex)"
                  :data-test="`dashboard-function-dropdown-arg-remove-button-${argIndex}`"
                  icon-left="close"
                >
                </OButton>
              </div>
            </div>
          </div>
        </div>

        <!-- Add more arguments if allowed -->
      </div>
    </div>
    <OButton
      v-if="canAddArgument(fields.functionName)"
      variant="outline"
      size="sm"
      @click="addArgument()"
      class="mt-3"
      :data-test="`dashboard-function-dropdown-add-argument-button`"
    >
      + {{ t('dashboard.selectFunction.add') }}
    </OButton>
  </div>
</template>

<script lang="ts">
import { ref, watch, toRef, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import HistogramIntervalDropDown from "../HistogramIntervalDropDown.vue";
import { addMissingArgs } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import SubTaskArrow from "@/components/icons/SubTaskArrow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default {
  name: "SelectFunction",
  components: {
    HistogramIntervalDropDown,
    StreamFieldSelect,
    SubTaskArrow,
    OButton,
    OSelect,
    OInput,
    OIcon,
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
    isChild: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
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

    const onFunctionSearch = (val: string) => {
      let filteredFunctionsValidation = functionValidation;
      if (props.allowAggregation === false) {
        filteredFunctionsValidation = filteredFunctionsValidation.filter(
          (v) => !v.isAggregation,
        );
      }
      const searchVal = val?.toLowerCase() ?? "";
      filteredFunctions.value = filteredFunctionsValidation
        .map((v) => ({
          label: v.functionLabel,
          value: v.functionName,
        }))
        .filter((v) => v.label.toLowerCase().indexOf(searchVal) > -1);
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
      const types = argsValidation[adjustedIndex]?.type || [];
      // Inject icon name for each option so dropdown items show icons
      return types.map((t: any) => ({
        ...t,
        icon: getIconBasedOnArgType(t.value),
      }));
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
          return "list";
        case "function":
          return "function";
        case "string":
          return "title";
        case "number":
          return "123";
        case "histogramInterval":
          return "bar-chart";
      }
    };

    const getParameterLabel = (functionName: string, argIndex: number) => {
      const funcValidation: any = getValidationForFunction(functionName);

      if (!funcValidation) {
        return t("dashboard.selectFunction.parameter", { n: argIndex + 1 });
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
        argsValidation[adjustedIndex]?.label ||
        t("dashboard.selectFunction.parameter", { n: argIndex + 1 })
      );
    };

    return {
      t,
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
      onFunctionSearch,
      initializeFunctions,
      onArgTypeChange,
      getAllSelectedStreams,
      getIconBasedOnArgType,
      getParameterLabel,
    };
  },
};
</script>

<style scoped>
/* keep(lib-override:OSelect): compact the arg-type OSelect trigger to icon +
   chevron only — hides the internal label span and tightens the trigger button,
   which live in the select's own DOM and aren't reachable via utilities. */
.arg-type-select :deep(span[class~="flex-1"][class~="truncate"]) {
  display: none !important;
}

.arg-type-select :deep(button[type="button"]) {
  min-width: 2rem;
  padding-inline-end: 1.5rem !important;
}
</style>
