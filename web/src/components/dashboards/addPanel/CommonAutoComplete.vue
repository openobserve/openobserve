<template>
  <div class="relative" style="margin-top: 5px" data-no-autofocus>
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
      class="options-container"
      v-if="showOptions && fieldsFilteredOptions.length > 0"
      :style="{
        'background-color': store.state.theme === 'dark' ? '#2d2d2d' : 'white',
      }"
    >
      <div
        v-for="(option, index) in fieldsFilteredOptions"
        :key="index"
        class="option"
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
import { useStore } from "vuex";
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
    const store = useStore();
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
      store,
      onModelValueChanged,
      inputValue,
      hasSlot,
    };
  },
});
</script>

<style scoped>
.options-container {
  z-index: 10;
  position: absolute;
  left: 0;
  right: 0;
  border: 1px solid #ccc;
  max-height: 100px;
  overflow-y: auto;
  top: 42px;
}

.relative {
  position: relative;
  width: 100%;
}

.option {
  padding: 8px;
  cursor: pointer;
}

.option:hover {
  background-color: #f0f0f0b1;
}
</style>
