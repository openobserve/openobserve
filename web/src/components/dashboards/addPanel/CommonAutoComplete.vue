<template>
  <div
    class="relative mt-1.25"
    data-no-autofocus
    data-test="common-auto-complete-container"
  >
    <OInput
      v-model="inputValue"
      @update:model-value="onModelValueChanged"
      :label="label"
      @focus="onFocus"
      @blur="hideOptions"
      v-bind="$attrs"
      data-test="common-auto-complete"
    >
      <template v-if="hasSlot('label')" v-slot:label>
        <slot name="label"></slot>
      </template>
    </OInput>
    <div
      class="options-container z-10 absolute left-0 right-0 top-10.5 max-h-25 overflow-y-auto border border-dropdown-border bg-dropdown-bg"
      data-test="common-auto-complete-options-container"
      v-if="showOptions && fieldsFilteredOptions.length > 0"
    >
      <div
        v-for="(option, index) in fieldsFilteredOptions"
        :key="index"
        class="p-2 cursor-pointer hover:bg-dropdown-item-hover-bg"
        @mousedown="selectOption(option)"
        data-test="common-auto-complete-option"
      >
        {{ option.label }}
      </div>
    </div>
  </div>
</template>

<script>
import { ref, toRef, defineComponent, watch } from "vue";
import { useSearchInputUsingRegex } from "@/composables/useSearchInputUsingRegex";
import { useSlots } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";

export default defineComponent({
  name: "CommonAutoComplete",
  components: { OInput },
  props: {
    modelValue: {
      type: String,
    },
    label: {
      type: String,
    },
    items: {
      // always expected to be in [ { label: "", value: ""}] format, search in label, and replace the value
      type: Array,
    },
    searchRegex: {
      type: String,
    },
    valueReplaceFn: {
      // special treatment needed to any value replacing function, then this can be used
      type: Function,
      default: (selectedValue) => selectedValue,
    },
  },
  emits: ["update:modelValue", "select"],
  setup(props, { emit }) {
    const showOptions = ref(false);

    // this is used to sync with modelvalue and q-input's v-model
    const inputValue = ref(props.modelValue);

    watch(
      () => props.modelValue,
      (newValue) => {
        inputValue.value = newValue;
      },
    );

    watch(inputValue, (newValue) => {
      fieldsFilterFn(newValue);
    });
    // when q-input's model value updated, update the model value which will be synced back to input value
    const onModelValueChanged = (value) => {
      emit("update:modelValue", value);
      fieldsFilterFn(value);
    };

    const itemsRef = toRef(props, "items");
    // apply filter on label
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSearchInputUsingRegex(itemsRef, "label", props.searchRegex);

    const hideOptions = () => {
      showOptions.value = false;
    };

    const onFocus = () => {
      showOptions.value = true;
      // Show all options when focusing (pass empty string to reset filter)
      // This allows users to see and select from all available options
      fieldsFilterFn("");
    };

    // when any item is selected, replace it with the value and hide the options
    const selectOption = (option) => {
      const value = props.valueReplaceFn(option?.value);
      emit("update:modelValue", value);
      emit("select", value);
      showOptions.value = false;
    };

    const slots = useSlots();
    const hasSlot = (name) => {
      return !!slots[name];
    };

    return {
      showOptions,
      fieldsFilterFn,
      fieldsFilteredOptions,
      hideOptions,
      onFocus,
      selectOption,
      onModelValueChanged,
      inputValue,
      hasSlot,
    };
  },
});
</script>
