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
  <!-- The bordered box takes the row height (S2); the group inside holds sm buttons so 32 includes the border. -->
  <div
    class="function-selector border-button-outline-border rounded-default h-control-md float-left me-1 flex items-center overflow-hidden border"
  >
    <OButtonGroup size="sm">
      <div v-if="!hideToggle" class="flex items-center px-1">
        <OSwitch
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.showTransformEditor"
        />
        <OTooltip :content="t('search.toggleFunctionEditor')" />
      </div>
      <ODropdown v-model:open="functionModel" side="bottom" align="start">
        <template #trigger>
          <OButton
            icon-only
            data-test="logs-search-bar-function-dropdown"
            variant="ghost"
            class="ms-1!"
          >
            <img :src="functionIconUrl" :alt="t('logs.functionSelector.function')" class="size-4" />
            <OIcon name="arrow-drop-down" size="sm" class="-ms-0.5" />
            <OTooltip :content="raw(selectedFunctionTooltip)" />
          </OButton>
        </template>
        <div data-test="logs-search-saved-function-list" class="py-0">
          <!-- Search Input -->
          <div>
            <OSearchInput
              size="sm"
              v-model="searchTerm"
              :debounce="300"
              :placeholder="t('search.searchSavedFunction')"
              data-test="function-search-input"
            />
          </div>

          <div v-if="filteredFunctionOptions.length" class="max-h-72 overflow-y-auto">
            <ODropdownItem
              v-for="(item, i) in filteredFunctionOptions"
              :key="'saved-view-' + i"
              :data-test="`logs-search-saved-function-${item.name}`"
              class="saved-view-item border-card-glass-border rounded-none border-b last:border-none"
              @select="applyFunction(item, true)"
            >
              {{ item.name }}
            </ODropdownItem>
          </div>
          <div v-else>
            <div class="flex items-center gap-2 px-3 py-2">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm">{{ t("search.savedFunctionNotFound") }}</span>
              </div>
            </div>
          </div>
        </div>
      </ODropdown>
      <OButton
        icon-only
        data-test="logs-search-bar-save-function-btn"
        variant="ghost"
        @click="fnSavedFunctionDialog"
      >
        <OIcon name="save" size="sm" />
        <OTooltip :content="t('common.save')" />
      </OButton>
    </OButtonGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { getImageURL } from "@/utils/zincutils";
import { useTheme } from "@/composables/useTheme";
const props = withDefaults(
  defineProps<{
    functionOptions: { name: string; function: string }[];
    hideToggle?: boolean;
  }>(),
  {
    hideToggle: false,
  },
);

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18nTyped();

const { searchObj } = searchState();

const { isDark } = useTheme();

const iconRight = computed(() => {
  return (
    "img:" +
    getImageURL(isDark.value ? "images/common/function_dark.svg" : "images/common/function.svg")
  );
});

const functionModel = ref(false);

const searchTerm = ref("");

const functionIconUrl = computed(() => iconRight.value.replace("img:", ""));

const fnSavedFunctionDialog = () => {
  emit("save:function");
};

const filteredFunctionOptions = computed(() => {
  if (!searchTerm.value) return props.functionOptions;
  return props.functionOptions.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  );
});

const selectedFunctionTooltip = computed(() => {
  if (searchObj.data.selectedFunction?.name) {
    return t("search.selectedFunctionTooltip", {
      name: searchObj.data.selectedFunction.name,
    });
  }
  return t("search.functionPlaceholder");
});

const applyFunction = (item: { name: string; function: string }, flag = false) => {
  functionModel.value = false;
  emit("select:function", item, flag);
};
</script>
