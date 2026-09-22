<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex flex-col">
    <!-- Function selector -->
    <div class="w-60 flex-none">
      <OSelect
        v-model="fields.functionName"
        :options="filteredFunctions"
        data-test="dashboard-function-dropdown"
        class="w-full"
        @search="onFunctionSearch"
      >
        <template #icon-left>
          <OIcon name="function" size="sm" />
        </template>
      </OSelect>
    </div>

    <!-- Argument tree -->
    <div class="mt-2 w-full">
      <div class="w-full">
        <div
          v-for="(arg, argIndex) in argRows"
          :key="argIndex + '-' + arg.type"
          class="flex w-full flex-col"
        >
          <div class="flex" :style="{ marginLeft: isChild ? '-3rem' : '0' }">
            <div class="relative me-1.5 min-h-12.5 w-2.5">
              <!-- Vertical Line using top & bottom instead of height -->
              <div
                class="bg-accent absolute top-0 w-px opacity-50"
                :style="{
                  bottom: argIndex === fields.args.length - 1 ? 'calc(100% - 2rem)' : '0',
                  left: '0.3125rem',
                }"
              ></div>

              <!-- SubTask Arrow -->
              <div class="text-text-secondary absolute top-7.5 left-1">
                <SubTaskArrow />
              </div>
            </div>

            <div class="flex min-w-0 flex-1 flex-col">
              <div class="flex items-center gap-x-2">
                <label :for="'arg-' + argIndex">{{
                  getParameterLabel(fields.functionName, argIndex)
                }}</label>
              </div>
              <div class="flex items-start gap-1">
                <!-- Argument type switcher -->
                <OSelect
                  v-if="hasArgTypeChoice(fields.functionName, argIndex)"
                  v-model="fields.args[argIndex].type"
                  @update:model-value="onArgTypeChange(fields.args[argIndex])"
                  :options="
                    getSupportedTypeBasedOnFunctionNameAndIndex(fields.functionName, argIndex)
                  "
                  icon-key="icon"
                  label-position="inside"
                  class="o2-custom-select-dashboard arg-type-select me-0.5 w-fit! flex-none!"
                  :required="isRequired(fields.functionName, argIndex)"
                  :data-test="`dashboard-function-dropdown-arg-type-selector-${argIndex}`"
                >
                  <template #icon-left>
                    <OIcon :name="getIconBasedOnArgType(fields.args[argIndex].type)" size="sm" />
                  </template>
                  <!-- empty slot keeps the trigger icon-only -->
                  <template #trigger><span class="sr-only"></span></template>
                </OSelect>

                <!-- Field selector -->
                <div class="w-52 flex-none" v-if="fields.args[argIndex]?.type === 'field'">
                  <StreamFieldSelect
                    :streams="getAllSelectedStreams()"
                    v-model="fields.args[argIndex].value"
                    :data-test="`dashboard-function-dropdown-arg-field-selector-${argIndex}`"
                  />
                </div>

                <div v-if="fields.args[argIndex]?.type === 'string'" class="w-52 flex-none">
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
                  class="w-52 flex-none"
                  :data-test="`dashboard-function-dropdown-arg-number-input-${argIndex}`"
                />

                <!-- Cast target type -->
                <div v-if="fields.args[argIndex]?.type === 'castType'" class="w-52 flex-none">
                  <OSelect
                    v-model="fields.args[argIndex].value"
                    :options="castTypeOptions"
                    :label="t('dashboard.selectFunction.selectCastType')"
                    label-position="inside"
                    class="o2-custom-select-dashboard"
                    :data-test="`dashboard-function-dropdown-arg-cast-type-select-${argIndex}`"
                  />
                </div>

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
                  class="shrink-0"
                  @click="removeArgument(argIndex)"
                  :data-test="`dashboard-function-dropdown-arg-remove-button-${argIndex}`"
                  icon-left="close"
                >
                </OButton>
              </div>

              <OBanner
                v-if="castSuggestions[argIndex]"
                variant="warning"
                icon="warning"
                dense
                class="mt-2"
                :data-test="`dashboard-function-dropdown-arg-cast-suggestion-${argIndex}`"
              >
                <span class="text-xs">{{ castSuggestions[argIndex].message }}</span>
                <template #actions>
                  <div class="flex items-center gap-2">
                    <OButton
                      variant="outline"
                      size="sm"
                      @click="applyCast(argIndex, suggestedCastType)"
                      :data-test="`dashboard-function-dropdown-arg-cast-apply-${argIndex}`"
                    >
                      {{
                        t("dashboard.selectFunction.castSuggestion.castTo", {
                          type: castTypeLabels[suggestedCastType],
                        })
                      }}
                    </OButton>
                    <OButton
                      variant="ghost"
                      size="sm"
                      @click="dismissCastSuggestion(argIndex)"
                      :data-test="`dashboard-function-dropdown-arg-cast-dismiss-${argIndex}`"
                    >
                      {{ t("dashboard.selectFunction.castSuggestion.dismiss") }}
                    </OButton>
                  </div>
                </template>
              </OBanner>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add more arguments if allowed -->
    <OButton
      v-if="canAddArgument(fields.functionName)"
      variant="outline"
      size="sm"
      @click="addArgument()"
      class="mt-3 w-fit border-dashed"
      icon-left="add"
      :data-test="`dashboard-function-dropdown-add-argument-button`"
    >
      {{ t("dashboard.selectFunction.add") }}
    </OButton>
  </div>
</template>

<script lang="ts">
import { ref, watch, computed, inject } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import type { I18nText } from "@/types/i18n";
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import {
  CAST_TARGET_TYPES,
  DEFAULT_CAST_TARGET_TYPE,
  getCastSeverity,
  resolveFieldType,
  wrapArgInCast,
  type CastTargetType,
} from "@/utils/dashboard/castSuggestion";

/** SQL type names shown to the user; not copy, so never translated. */
const CAST_TYPE_LABELS: Record<CastTargetType, string> = {
  DOUBLE: "Double",
  BIGINT: "Bigint",
};

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
    OBanner,
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
    interface FunctionArg {
      type: string;
      value: unknown;
    }

    const { t } = useI18nTyped();
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { getAllSelectedStreams, dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
      t,
    );

    const fields = ref(addMissingArgs(props.modelValue));

    // Typed view of the args used only for template iteration, so the v-for
    // index resolves to `number` (v-model still writes through `fields`).
    const argRows = computed<FunctionArg[]>(() => fields.value.args ?? []);

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
    const dismissedSuggestions = ref<string[]>([]);

    const castTypeOptions = CAST_TARGET_TYPES.map((castType) => ({
      label: raw(CAST_TYPE_LABELS[castType]),
      value: castType,
    }));

    // Initialize filteredFunctions with all available options
    const initializeFunctions = () => {
      let filteredFunctionsValidation = functionValidation;
      // if allowAggregation is false, filter out aggregation functions
      if (props.allowAggregation === false) {
        filteredFunctionsValidation = filteredFunctionsValidation.filter((v) => !v.isAggregation);
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
          filteredFunctionsValidation = filteredFunctionsValidation.filter((v) => !v.isAggregation);
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
        filteredFunctionsValidation = filteredFunctionsValidation.filter((v) => !v.isAggregation);
      }
      const searchVal = val?.toLowerCase() ?? "";
      filteredFunctions.value = filteredFunctionsValidation
        .map((v) => ({
          label: v.functionLabel,
          value: v.functionName,
        }))
        .filter((v) => v.label.toLowerCase().indexOf(searchVal) > -1);
    };

    const getValidationForFunction = (functionName: string) => {
      return functionValidation.find((v) => v.functionName === (functionName ?? null)) ?? {};
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
      const adjustedIndex = getAdjustedIndex(argsValidation, argIndex, allowAddArgAt);

      const minArg = argsValidation[adjustedIndex]?.min ?? 0;
      const functionTotalArgs = argsValidation.length;
      const addedArgCount = argIndex + 1 - (functionTotalArgs - 1);

      return addedArgCount > minArg;
    };

    const addArgument = () => {
      const funcValidation: any = getValidationForFunction(fields.value.functionName);

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
    const getAdjustedIndex = (argsValidation: any, argIndex: number, allowAddArgAt: any) => {
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
      const adjustedIndex = getAdjustedIndex(argsValidation, argIndex, allowAddArgAt);

      // Return the type for the adjusted index, or an empty array if the index is out of bounds
      const types = argsValidation[adjustedIndex]?.type || [];
      // Inject icon name for each option so the switcher buttons show icons
      return types.map((t: any) => ({
        ...t,
        icon: getIconBasedOnArgType(t.value),
      }));
    };

    // watcher on functionName
    watch(
      () => fields.value.functionName,
      () => {
        // Save the old args
        const oldArgs = [...fields.value.args];

        // get the validation for the selected function
        const funcValidation: any = getValidationForFunction(fields.value.functionName);

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

          // Allowed types per new arg slot, in the same order as newArgs.
          const allowedTypes = (funcValidation?.args ?? []).flatMap((arg: any) =>
            Array.from({ length: arg.min ?? 1 }).map(() =>
              (arg.type ?? []).map((argType: any) => argType.value),
            ),
          );

          // Carry the old argument over whenever the new slot accepts its type.
          // Preserving only field→field discarded any nested expression — most
          // visibly a cast, which changing sum to avg would silently undo.
          for (let i = 0; i < newArgs.length && i < oldArgs.length; i++) {
            if (allowedTypes[i]?.includes(oldArgs[i].type)) {
              newArgs[i] = { type: oldArgs[i].type, value: oldArgs[i].value };
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

    const setArgType = (argIndex: number, type: string) => {
      const arg = fields.value.args[argIndex];
      if (!arg || arg.type === type) return;
      arg.type = type;
      onArgTypeChange(arg);
    };

    // Keyed by field as well as index so changing the field re-offers the cast.
    const suggestionKey = (argIndex: number) => {
      const fieldRef = fields.value.args?.[argIndex]?.value as { field?: string } | undefined;
      return `${fields.value.functionName}:${argIndex}:${fieldRef?.field ?? ""}`;
    };

    const castSuggestions = computed(() => {
      const groupedFields = dashboardPanelData.meta?.streamFields?.groupedFields;
      const functionName = fields.value.functionName;
      const funcValidation: any = getValidationForFunction(functionName);
      const result: Record<number, { message: I18nText }> = {};

      (fields.value.args ?? []).forEach((arg: FunctionArg, argIndex: number) => {
        if (arg?.type !== "field") return;

        const fieldRef = arg.value as { field?: string; streamAlias?: string } | undefined;
        const fieldType = resolveFieldType(groupedFields, fieldRef);

        if (!getCastSeverity(functionName, fieldType)) return;
        if (dismissedSuggestions.value.includes(suggestionKey(argIndex))) return;

        result[argIndex] = {
          message: t("dashboard.selectFunction.castSuggestion.error", {
            fn: funcValidation?.functionLabel ?? functionName,
            field: fieldRef?.field ?? "",
            type: fieldType ?? "",
          }),
        };
      });

      return result;
    });

    const applyCast = (argIndex: number, targetType: CastTargetType) => {
      const arg = fields.value.args?.[argIndex];
      if (!arg) return;
      fields.value.args[argIndex] = wrapArgInCast(arg, targetType);
    };

    const dismissCastSuggestion = (argIndex: number) => {
      dismissedSuggestions.value.push(suggestionKey(argIndex));
    };

    const hasArgTypeChoice = (functionName: string, argIndex: number) =>
      getSupportedTypeBasedOnFunctionNameAndIndex(functionName, argIndex).length > 1;

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
        case "castType":
          return "transform";
        default:
          return undefined;
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
      const adjustedIndex = getAdjustedIndex(argsValidation, argIndex, allowAddArgAt);

      // Return the label from validation, or fallback to default
      return (
        argsValidation[adjustedIndex]?.label ||
        t("dashboard.selectFunction.parameter", { n: argIndex + 1 })
      );
    };

    return {
      t,
      fields,
      argRows,
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
      setArgType,
      getAllSelectedStreams,
      getIconBasedOnArgType,
      getParameterLabel,
      castSuggestions,
      castTypeOptions,
      suggestedCastType: DEFAULT_CAST_TARGET_TYPE,
      castTypeLabels: CAST_TYPE_LABELS,
      applyCast,
      dismissCastSuggestion,
      hasArgTypeChoice,
    };
  },
};
</script>
