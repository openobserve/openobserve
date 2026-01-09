<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <q-select
      style="min-width: 150px"
      dense
      borderless
      hide-bottom-space
      v-model="selectedValue"
      :display-value="displayValue"
      :label="variableItem?.label || variableItem?.name"
      :options="filteredOptions"
      input-debounce="0"
      emit-value
      option-value="value"
      option-label="label"
      behavior="menu"
      use-input
      stack-label
      @filter="filterOptions"
      class="textbox col no-case o2-custom-select-dashboard"
      :loading="variableItem.isLoading"
      :data-test="`variable-selector-${variableItem.name}-inner`"
      :multiple="variableItem.multiSelect"
      popup-no-route-dismiss
      popup-content-style="z-index: 10001"
      @popup-show="onPopupShow"
      @popup-hide="onPopupHide"
      @update:model-value="onUpdateValue"
      @keydown="handleKeydown"
      ref="selectRef"
    >
      <template v-slot:no-option>
        <template v-if="filterText">
          <q-item clickable @click="handleCustomValue(filterText)">
            <q-item-section>
              <q-item-label>
                {{ filterText }}
                <span class="text-grey-6 q-ml-xs tw:text-xs tw:italic"
                  >(Custom)</span
                >
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-separator />
        </template>
        <q-item v-else>
          <q-item-section class="text-italic text-grey">
            No Data Found
          </q-item-section>
        </q-item>
      </template>

      <template v-if="filteredOptions.length > 0" v-slot:before-options>
        <q-item>
          <q-item-section v-if="variableItem.multiSelect" side>
            <q-checkbox
              v-model="isAllSelected"
              @update:model-value="toggleSelectAll"
              dense
              class="q-ma-none"
              @click.stop
            />
          </q-item-section>
          <q-item-section @click.stop="toggleSelectAll" style="cursor: pointer">
            <q-item-label>{{
              variableItem.multiSelect ? "Select All" : "All"
            }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator />
        <template v-if="filterText">
          <q-item clickable @click="handleCustomValue(filterText)">
            <q-item-section>
              <q-item-label>
                {{ filterText }}
                <span class="text-grey-6 q-ml-xs tw:text-xs tw:italic"
                  >(Custom)</span
                >
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-separator />
        </template>
      </template>
      <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
        <q-item v-bind="itemProps">
          <q-item-section side v-if="variableItem.multiSelect">
            <q-checkbox
              :model-value="selected || isAllSelected"
              @update:model-value="toggleOption(opt)"
              class="q-ma-none"
              dense
            />
          </q-item-section>
          <q-item-section>
            <q-item-label>
              <span
                v-html="
                  typeof opt.value === 'string' &&
                  opt.value.endsWith(`${CUSTOM_VALUE}`)
                    ? `${opt.value.replace(new RegExp(`${CUSTOM_VALUE}$`), '')} (Custom)`
                    : opt.label
                "
              ></span>
            </q-item-label>
          </q-item-section>
        </q-item>
      </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { SELECT_ALL_VALUE, CUSTOM_VALUE } from "@/utils/dashboard/constants";
import { debounce } from "lodash-es";
import {
  defineComponent,
  ref,
  watch,
  computed,
  nextTick,
  onUnmounted,
} from "vue";

export default defineComponent({
  name: "VariableQueryValueSelector",
  props: ["modelValue", "variableItem", "loadOptions"],
  emits: ["update:modelValue", "search"],
  setup(props: any, { emit }) {
    const selectedValue = ref(props.variableItem?.value);
    const filterText = ref("");
    const selectRef = ref(null);
    const isOpen = ref(false);

    const availableOptions = computed(() => props.variableItem?.options || []);

    // Show searchResults if filterText is active, else normal options
    const filteredOptions = computed(() => {
      let opts = availableOptions.value.map((opt: any) => {
        if (
          typeof opt.value === "string" &&
          opt.value.endsWith(`${CUSTOM_VALUE}`)
        ) {
          const base = opt.value.replace(new RegExp(`${CUSTOM_VALUE}$`), "");
          return { ...opt, label: `${base} (Custom)` };
        }
        return opt;
      });
      if (!filterText.value) return opts;
      return opts.filter((opt: any) =>
        opt.label.toLowerCase().includes(filterText.value.toLowerCase()),
      );
    });
    const filterOptions = (val: string, update: Function) => {
      filterText.value = val;
      update();
    };

    // set debouced filterText value that can trigger search
    const searchText = ref("");
    const updateSearch = debounce((val: string) => {
      searchText.value = val;
    }, 500);

    // --- Typeahead debounce and emit search event ---
    watch(
      () => filterText.value,
      (newVal) => {
        // set search text
        updateSearch(newVal);
      },
    );

    // emit when searchText changes
    watch(
      () => searchText.value,
      (newVal) => {
        if (newVal == null || newVal == undefined) {
          return;
        }

        // no need to update results if the menu is hidden
        if (!isOpen.value) {
          return;
        }

        emit("search", {
          variableItem: props.variableItem,
          filterText: newVal,
        });
      },
    );

    // Cleanup debounce timeout when component is unmounted
    onUnmounted(() => {
      updateSearch.cancel();
    });

    const isAllSelected = computed(() => {
      if (props.variableItem.multiSelect) {
        return (
          Array.isArray(selectedValue.value) &&
          selectedValue.value?.[0] === SELECT_ALL_VALUE
        );
      }
      return selectedValue.value === SELECT_ALL_VALUE;
    });

    const closePopUpWhenValueIsSet = async () => {
      filterText.value = "";
      if (selectRef.value) {
        (selectRef.value as any).updateInputValue("");
        (selectRef.value as any).blur();
        await nextTick();
        (selectRef.value as any).hidePopup();
      }
    };

    const toggleSelectAll = async () => {
      const newValue = props.variableItem.multiSelect
        ? isAllSelected.value
          ? []
          : [SELECT_ALL_VALUE]
        : SELECT_ALL_VALUE;

      selectedValue.value = newValue;
      emit("update:modelValue", newValue);
      await closePopUpWhenValueIsSet();
    };

    const onUpdateValue = async (val: any) => {
      // If multiselect and user selects any regular value after SELECT_ALL, remove SELECT_ALL
      if (
        props.variableItem.multiSelect &&
        Array.isArray(val) &&
        val.length > 0
      ) {
        // Remove SELECT_ALL if other values are selected
        if (val.includes(SELECT_ALL_VALUE) && val.length > 1) {
          val = val.filter((v) => v !== SELECT_ALL_VALUE);
        }
        // Remove custom value suffix if present
        val = val.filter(
          (v) => !(typeof v === "string" && v.endsWith(`${CUSTOM_VALUE}`)),
        );
      }
      selectedValue.value = val;
      if (!props.variableItem.multiSelect) {
        emit("update:modelValue", val);
        // Close dropdown immediately for single-select to prevent it staying open during child variable loading
        await closePopUpWhenValueIsSet();
      }
    };

    const onPopupShow = () => {
      isOpen.value = true;

      if (props.loadOptions) {
        props.loadOptions(props.variableItem);
      }
    };

    const onPopupHide = () => {
      isOpen.value = false;

      filterText.value = "";
      if (props.variableItem.multiSelect) {
        emit("update:modelValue", selectedValue.value);
      }
    };

    const displayValue = computed(() => {
      if (selectedValue.value || selectedValue.value === "") {
        if (Array.isArray(selectedValue.value)) {
          if (selectedValue.value.length > 2) {
            const firstTwoValues = selectedValue.value
              .slice(0, 2)
              .map((it: any) => {
                if (it === "") return "<blank>";
                if (it === SELECT_ALL_VALUE) return "<ALL>";
                if (typeof it === "string" && it.endsWith(`${CUSTOM_VALUE}`))
                  return `${it.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} (Custom)`;
                return it;
              })
              .join(", ");
            const remainingCount = selectedValue.value.length - 2;
            return `${firstTwoValues} ...+${remainingCount} more`;
          } else if (
            props.variableItem.options.length === 0 &&
            selectedValue.value.length === 0
          ) {
            return "(No Data Found)";
          } else {
            return selectedValue.value
              .map((it: any) => {
                if (it === "") return "<blank>";
                if (it === SELECT_ALL_VALUE) return "<ALL>";
                if (typeof it === "string" && it.endsWith(`${CUSTOM_VALUE}`))
                  return `${it.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} (Custom)`;
                return it;
              })
              .join(", ");
          }
        } else if (selectedValue.value === "") {
          // Only display <blank> if an actual option with empty-string value exists
          if (
            props.variableItem.options &&
            props.variableItem.options.some((o: any) => o.value === "")
          ) {
            return "<blank>";
          }
          // Otherwise treat empty-string as unset
          return "(No Data Found)";
        } else if (selectedValue.value === SELECT_ALL_VALUE) {
          return "<ALL>";
        } else if (
          typeof selectedValue.value === "string" &&
          selectedValue.value.endsWith(`${CUSTOM_VALUE}`)
        ) {
          return `${selectedValue.value.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} (Custom)`;
        } else {
          return selectedValue.value;
        }
      } else if (!props.variableItem.isLoading) {
        return "(No Data Found)";
      } else {
        return "";
      }
    });

    watch(
      () => props.variableItem.options,
      () => {
        // Only update input if dropdown is open AND it's a multiSelect
        // For single-select, don't interfere as the dropdown should close after selection
        if (isOpen.value && selectRef.value && props.variableItem.multiSelect) {
          nextTick(() => {
            if (selectRef.value) {
              if (!filterText.value) {
                (selectRef.value as any).updateInputValue();
              } else {
                filterOptions(filterText.value, () => {});
              }
            }
          });
        }
      },
      { deep: true },
    );

    // Add watch for modelValue changes
    watch(
      () => props.modelValue,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );

    // Add watch for variableItem value changes
    watch(
      () => props.variableItem.value,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );
    const handleCustomValue = async (value: string) => {
      if (!value?.trim()) return;
      const inputValue = value.trim();
      // Check if value already exists in options (case-sensitive)
      const existingOption = availableOptions.value.find(
        (opt: any) =>
          typeof opt.label === "string" && opt.label.trim() === inputValue,
      );
      if (existingOption) {
        // Select the existing option
        if (props.variableItem.multiSelect) {
          selectedValue.value = [existingOption.value];
          emit("update:modelValue", [existingOption.value]);
        } else {
          selectedValue.value = existingOption.value;
          emit("update:modelValue", existingOption.value);
        }
      } else {
        // Add as custom value
        const customValue = `${inputValue}${CUSTOM_VALUE}`;
        if (props.variableItem.multiSelect) {
          selectedValue.value = [customValue];
          emit("update:modelValue", [customValue]);
        } else {
          selectedValue.value = customValue;
          emit("update:modelValue", customValue);
        }
      }
      await closePopUpWhenValueIsSet();
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && filterText.value?.trim()) {
        event.preventDefault();
        event.stopPropagation();
        handleCustomValue(filterText.value);
      }
    };

    return {
      selectedValue,
      filteredOptions,
      filterOptions,
      isAllSelected,
      toggleSelectAll,
      displayValue,
      onUpdateValue,
      onPopupShow,
      onPopupHide,
      selectRef,
      handleKeydown,
      handleCustomValue,
      filterText,
      CUSTOM_VALUE,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-select {
  max-width: 600px;
}

:deep(.q-field__native) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
