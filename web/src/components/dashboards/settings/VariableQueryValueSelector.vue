<!-- Copyright 2026 OpenObserve Inc.

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
    <OSelect
      ref="selectRef"
      :model-value="oSelectModelValue"
      :label="variableItem?.label || variableItem?.name"
      label-position="inside"
      :options="computedOptions"
      labelKey="label"
      valueKey="value"
      class="textbox no-case o2-custom-select-dashboard flex max-w-160 min-w-37.5 flex-col"
      :loading="variableItem.isLoading && !isOpen"
      :data-test="`variable-selector-${variableItem.name}-inner`"
      :multiple="variableItem.multiSelect"
      @search="onSearch"
      @open="onPopupShow"
      @close="onPopupHide"
      @keydown="handleKeydown"
      @update:model-value="onUpdateValue"
    >
      <template #trigger>
        <span
          class="text-select-text flex-1 truncate text-start text-xs leading-4 font-semibold"
          :data-test="`variable-selector-${variableItem.name}-inner-value`"
          >{{ displayValue }}</span
        >
      </template>
      <template #before-options>
        <template v-if="hasVisibleFilteredOptions">
          <!-- multiSelect: show checkbox + Select All -->
          <div
            v-if="variableItem.multiSelect"
            class="flex cursor-pointer items-center gap-2 px-3 py-2"
            @click.stop="toggleSelectAll"
          >
            <OCheckbox
              :model-value="isAllSelected"
              @update:model-value="toggleSelectAll"
              @click.stop
            />
            <span>{{ t("dashboard.variableQueryValueSelector.selectAll") }}</span>
          </div>
          <!-- single-select: show plain All -->
          <div
            v-else
            class="flex cursor-pointer items-center gap-2 px-3 py-2"
            @click.stop="toggleSelectAll"
          >
            <span>{{ t("dashboard.variableQueryValueSelector.all") }}</span>
          </div>
          <OSeparator data-test="dashboard-variable-all-separator" />
        </template>
      </template>
      <!-- Custom suggestion rendered AFTER the matching options so real results
           take priority. The no-match case is handled by the #empty slot below. -->
      <template #after-options>
        <template
          v-if="hasVisibleFilteredOptions && currentSearchTerm && !isSearchTermExistingOption"
        >
          <OSeparator />
          <div
            class="flex cursor-pointer items-center gap-2 px-3 py-2"
            @click.stop="handleCustomValue(currentSearchTerm)"
          >
            {{ currentSearchTerm }}
            <span class="text-text-secondary text-xs italic">{{
              t("dashboard.variableQueryValueSelector.custom")
            }}</span>
          </div>
        </template>
        <div
          v-if="variableItem.isLoading && hasVisibleFilteredOptions"
          class="flex items-center justify-center py-2"
          data-test="variable-query-value-selector-loading-more"
        >
          <OSpinner size="sm" />
        </div>
      </template>
      <template #empty>
        <div v-if="variableItem.isLoading" class="flex items-center justify-center py-3">
          <OSpinner size="sm" />
        </div>
        <div
          v-else-if="currentSearchTerm && !isSearchTermExistingOption"
          class="text-select-text flex cursor-pointer items-center gap-2"
          @click.stop="handleCustomValue(currentSearchTerm)"
        >
          {{ currentSearchTerm }}
          <span class="text-text-secondary text-xs italic">{{
            t("dashboard.variableQueryValueSelector.custom")
          }}</span>
        </div>
        <div
          v-else
          class="text-text-muted flex items-center justify-center py-3 italic"
          data-test="variable-query-value-selector-no-data"
        >
          {{ t("dashboard.variableQueryValueSelector.noDataFound") }}
        </div>
      </template>
    </OSelect>
  </div>
</template>

<script lang="ts">
import { SELECT_ALL_VALUE, CUSTOM_VALUE } from "@/utils/dashboard/constants";
import { debounce } from "lodash-es";
import { defineComponent, ref, watch, computed, onUnmounted } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "VariableQueryValueSelector",
  components: { OSeparator, OSelect, OCheckbox, OSpinner },
  props: ["modelValue", "variableItem", "loadOptions"],
  emits: ["update:modelValue", "search"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
    const selectedValue = ref(props.variableItem?.value);
    const currentSearchTerm = ref("");
    const selectRef = ref(null);
    const isOpen = ref(false);

    const availableOptions = computed(() => props.variableItem?.options || []);

    // Options with (Custom) label transformation — OSelect handles local filtering
    const computedOptions = computed(() => {
      return availableOptions.value.map((opt: any) => {
        if (typeof opt.value === "string" && opt.value.endsWith(`${CUSTOM_VALUE}`)) {
          const base = opt.value.replace(new RegExp(`${CUSTOM_VALUE}$`), "");
          return { ...opt, label: `${base} ${t("dashboard.variableQueryValueSelector.custom")}` };
        }
        return opt;
      });
    });

    // Handler for OSelect @search event
    const onSearch = (val: string) => {
      currentSearchTerm.value = val;
      updateSearch(val);
    };

    // Kept for backwards compat with variableItem.options watch
    const filterText = currentSearchTerm;

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

    // True when the typed search term already exists as a regular or custom option,
    // so the #before-options "Custom" suggestion is suppressed to avoid duplicates.
    const isSearchTermExistingOption = computed(() => {
      const term = currentSearchTerm.value?.trim();
      if (!term) return false;
      return availableOptions.value.some((opt: any) => {
        if (typeof opt.label === "string" && opt.label.trim() === term) return true;
        if (typeof opt.value === "string" && opt.value.endsWith(`${CUSTOM_VALUE}`)) {
          const base = opt.value.replace(new RegExp(`${CUSTOM_VALUE}$`), "");
          if (base === term) return true;
        }
        return false;
      });
    });

    const hasVisibleFilteredOptions = computed(() => {
      const term = currentSearchTerm.value?.trim().toLowerCase();
      if (!term) return computedOptions.value.length > 0;
      return computedOptions.value.some(
        (opt: any) => typeof opt.label === "string" && opt.label.toLowerCase().includes(term),
      );
    });

    const isAllSelected = computed(() => {
      if (props.variableItem.multiSelect) {
        return Array.isArray(selectedValue.value) && selectedValue.value?.[0] === SELECT_ALL_VALUE;
      }
      return selectedValue.value === SELECT_ALL_VALUE;
    });

    // When "Select All" is active, feed OSelect all individual option values so
    // every checkbox appears ticked. Otherwise pass the real selection as-is.
    const oSelectModelValue = computed(() => {
      if (props.variableItem.multiSelect && isAllSelected.value) {
        return computedOptions.value.map((opt: any) => opt.value);
      }
      return selectedValue.value;
    });

    const closePopUpWhenValueIsSet = async () => {
      filterText.value = "";
      if (selectRef.value) {
        (selectRef.value as any).close();
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
      if (!props.variableItem.multiSelect) {
        await closePopUpWhenValueIsSet();
      }
    };

    const onUpdateValue = async (val: any) => {
      // If multiselect and user selects any regular value after SELECT_ALL, remove SELECT_ALL
      if (props.variableItem.multiSelect && Array.isArray(val) && val.length > 0) {
        // Remove SELECT_ALL if other values are selected
        if (val.includes(SELECT_ALL_VALUE) && val.length > 1) {
          val = val.filter((v) => v !== SELECT_ALL_VALUE);
        }
        // Remove custom value suffix if present
        val = val.filter((v: any) => !(typeof v === "string" && v.endsWith(`${CUSTOM_VALUE}`)));
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
                if (it === "") return t("dashboard.variableQueryValueSelector.blank");
                if (it === SELECT_ALL_VALUE)
                  return t("dashboard.variableQueryValueSelector.allSelected");
                if (typeof it === "string" && it.endsWith(`${CUSTOM_VALUE}`))
                  return `${it.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} ${t("dashboard.variableQueryValueSelector.custom")}`;
                return it;
              })
              .join(", ");
            const remainingCount = selectedValue.value.length - 2;
            return t("dashboard.variableQueryValueSelector.moreCount", {
              firstTwoValues,
              remainingCount,
            });
          } else if (
            props?.variableItem?.options?.length === 0 &&
            selectedValue.value.length === 0
          ) {
            return t("dashboard.variableQueryValueSelector.noDataFoundParen");
          } else {
            return selectedValue.value
              .map((it: any) => {
                if (it === "") return t("dashboard.variableQueryValueSelector.blank");
                if (it === SELECT_ALL_VALUE)
                  return t("dashboard.variableQueryValueSelector.allSelected");
                if (typeof it === "string" && it.endsWith(`${CUSTOM_VALUE}`))
                  return `${it.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} ${t("dashboard.variableQueryValueSelector.custom")}`;
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
            return t("dashboard.variableQueryValueSelector.blank");
          }
          // Otherwise treat empty-string as unset
          return t("dashboard.variableQueryValueSelector.noDataFoundParen");
        } else if (selectedValue.value === SELECT_ALL_VALUE) {
          return t("dashboard.variableQueryValueSelector.allSelected");
        } else if (
          typeof selectedValue.value === "string" &&
          selectedValue.value.endsWith(`${CUSTOM_VALUE}`)
        ) {
          return `${selectedValue.value.replace(new RegExp(`${CUSTOM_VALUE}$`), "")} ${t("dashboard.variableQueryValueSelector.custom")}`;
        } else {
          return selectedValue.value;
        }
      } else {
        return t("dashboard.variableQueryValueSelector.noDataFoundParen");
      }
    });

    watch(
      () => props.variableItem.options,
      () => {
        // OSelect handles its own display — nothing to do when options reload
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
        (opt: any) => typeof opt.label === "string" && opt.label.trim() === inputValue,
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
      isOpen,
      hasVisibleFilteredOptions,
      selectedValue,
      oSelectModelValue,
      computedOptions,
      onSearch,
      currentSearchTerm,
      isSearchTermExistingOption,
      isAllSelected,
      toggleSelectAll,
      displayValue,
      onUpdateValue,
      onPopupShow,
      onPopupHide,
      selectRef,
      handleKeydown,
      handleCustomValue,
      CUSTOM_VALUE,
      t,
    };
  },
});
</script>
