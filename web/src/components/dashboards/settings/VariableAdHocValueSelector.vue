<template>
  <div class="flex flex-wrap items-center">
    <div
      class="flex flex-nowrap items-center mb-2 mr-4 gap-x-1"
      v-for="(item, index) in adhocVariables"
      :key="index"
    >
      <OInput
        v-model="adhocVariables[index].name"
        :debounce="1000"
        data-test="dashboard-variable-adhoc-name-selector"
        :placeholder="t('dashboard.variableAdHocValueSelector.enterName')"
        @update:model-value="updateModelValueOfSelect(index, $event)"
        class="flex-1"
      />
      <OSelect class="w-auto"
        v-model="adhocVariables[index].operator"
        :options="operatorOptions"
        data-test="dashboard-variable-adhoc-operator-selector"
      />
      <OInput class="w-31.25"
        v-model="adhocVariables[index].value"
        :placeholder="t('dashboard.variableAdHocValueSelector.enterValue')"
        :debounce="1000"
        data-test="dashboard-variable-adhoc-value-selector"
        @update:model-value="emitValue()"
      />
      <OButton
        variant="ghost"
        size="icon"
        class="ml-1"
        @click="removeField(index)"
        :data-test="`dashboard-variable-adhoc-close-${index}`"
        icon-left="close"
      >
      </OButton>
      <!-- <div v-if="index != adhocVariables.length - 1" class="ml-2 and-border" class="bg-surface-subtle-hover">AND</div> -->
    </div>
    <OButton
      variant="ghost"
      size="sm"
      class="ml-1 mb-2 hideOnPrintMode"
      @click="addFields"
      data-test="dashboard-variable-adhoc-add-selector"
    >
      <DynamicFilterIcon />
      <OTooltip :content="t('dashboard.variableAdHocValueSelector.addDynamicFilter')" />
    </OButton>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch, type Ref, toRefs } from "vue";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import DynamicFilterIcon from "../../icons/DynamicFilterIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default defineComponent({
  name: "VariableAdHocValueSelector",
  props: ["modelValue", "variableItem"],
  emits: ["update:modelValue"],
  components: { DynamicFilterIcon, OButton, OInput, OSelect, OTooltip },

  setup(props: any, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const operatorOptions = [
      { label: "=", value: "=" },
      { label: "!=", value: "!=" },
    ];
    const options = toRef(props.variableItem, "options");
    const { modelValue: adhocVariables } = toRefs(props);
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(options, "name");

    watch(props.variableItem, () => {
      options.value = props.variableItem?.options;
    });

    const addFields = () => {
      const adhocVariablesTemp = adhocVariables.value;
      adhocVariablesTemp.push({
        name: "",
        operator: operatorOptions[0].value,
        value: "",
        streams: [],
      });

      emitValue();
    };

    const updateModelValueOfSelect = (index: number, value: any) => {
      adhocVariables.value[index].name = value;
      emitValue();
    };

    const removeField = (index: number) => {
      const adhocVariablesTemp = adhocVariables.value;
      adhocVariablesTemp.splice(index, 1);
      emitValue();
    };

    const emitValue = () => {
      emit(
        "update:modelValue",
        JSON.parse(JSON.stringify(adhocVariables.value)),
      );
    };

    return {
      fieldsFilterFn,
      fieldsFilteredOptions,
      addFields,
      operatorOptions,
      adhocVariables,
      removeField,
      updateModelValueOfSelect,
      store,
      t,
    };
  },
});
</script>

