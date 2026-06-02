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
  <OButtonGroup
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="tw:p-0 float-left tw:mr-1 transform-selector element-box-shadow tw:border tw:border-button-outline-border"
  >
    <!-- Wrap toggle + dropdown together so divide-x only creates one separator (before save) -->
    <div class="tw:flex tw:items-center">
      <div v-if="!hideToggle" class="tw:flex tw:items-center">
        <OSwitch
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.showTransformEditor"
          size="sm"
          :disabled="!searchObj.data.transformType"
        />
        <OTooltip :content="getTransformLabelTooltip" :side-offset="2" />
      </div>
      <ODropdown v-model:open="functionModel" side="bottom" align="start">
        <template #trigger>
          <OButton
            data-test="logs-search-bar-function-dropdown"
            variant="ghost"
            size="icon-toolbar"
          >
            <img
              v-if="transformIcon?.startsWith('img:')"
              :src="transformIcon.slice(4)"
              alt="Transform"
              class="tw:size-4"
            />
            <OIcon v-else :name="transformIcon" size="sm" />
            <OIcon name="arrow-drop-down" size="sm" class="tw:ms-0.5" />
            <OTooltip :content="transformsLabel" :side-offset="2" />
          </OButton>
        </template>
        <div data-test="logs-search-saved-function-list" class="tw:py-0">
          <!-- Search Input -->
          <div
            data-test="logs-search-bar-transform-type-select"
            class="logs-transform-type o2-input tw:mx-2"
            style="padding-top: 0"
          >
            <OSelect
              v-if="isActionsEnabled"
              v-model="searchObj.data.transformType"
              :options="transformTypes"
              :label="t('search.transformType')"
              class="tw:py-1"
              clearable
              @update:model-value="updateTransforms()"
            />
          </div>
          <div>
            <OSearchInput
              v-model="searchTerm"
              clearable
              :debounce="300"
              :placeholder="t('search.searchSavedFunction')"
              data-test="function-search-input"
            />
          </div>

          <div v-if="filteredTransformOptions.length" class="tw:max-h-72 tw:overflow-y-auto">
            <ul class="tw:flex tw:flex-col tw:m-0 tw:p-0 tw:list-none">
              <li
                v-for="(item, i) in filteredTransformOptions"
                :key="'transform-' + item?.name"
                :data-test="`logs-search-saved-transform-item-${item?.name}`"
                class="tw:border-b saved-view-item tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:bg-muted/50"
                @click="selectTransform(item, true)"
              >
                <span class="tw:text-sm tw:flex-1 tw:min-w-0">{{ item.name }}</span>
              </li>
            </ul>
          </div>
          <div v-else>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2">
              <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                <span
                  v-if="searchObj.data.transformType === 'function'"
                  class="tw:text-sm"
                  >{{ t("search.savedFunctionNotFound") }}</span
                >
                <span
                  v-if="searchObj.data.transformType === 'action'"
                  class="tw:text-sm"
                  >{{ t("search.actionsNotFound") }}</span
                >
                <span v-if="!searchObj.data.transformType" class="tw:text-sm">{{
                  t("search.selectTransformType")
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </ODropdown>
    </div>
    <OButton
      data-test="logs-search-bar-save-transform-btn"
      variant="ghost"
      size="icon-toolbar"
      :disabled="searchObj.data.transformType !== 'function'"
      @click="fnSavedFunctionDialog"
    >
      <OIcon name="save" size="sm" />
      <OTooltip
        :content="searchObj.data.transformType === 'action' ? t('search.saveActionDisabled') : t('common.save')"
        :side-offset="6"
      />
    </OButton>
  </OButtonGroup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = withDefaults(defineProps<{
  functionOptions: { name: string; function: string }[];
  hideToggle?: boolean;
}>(), {
  hideToggle: false,
});

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18n();

const { searchObj } = searchState();

const { isActionsEnabled } = logsUtils();

const store = useStore();

const functionModel = ref(false);


const transformTypes = computed(() => {
  return [
    { label: "Function", value: "function" },
    { label: "Action", value: "action" },
  ];
});

const searchTerm = ref("");

const filteredFunctionOptions = computed(() => {
  if (searchObj.data.transformType !== "function") return [];
  if (!searchTerm.value) return props.functionOptions;
  return props.functionOptions.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  );
});

const filteredActionOptions = computed(() => {
  if (searchObj.data.transformType !== "action") return [];
  if (!searchTerm.value) return searchObj.data.actions;
  return searchObj.data.actions.filter((item: { name: string }) =>
    item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  );
});

const filteredTransformOptions = computed(() => {
  if (!searchObj.data.transformType) return [];

  if (searchObj.data.transformType === "action")
    return filteredActionOptions.value;

  if (searchObj.data.transformType === "function")
    return filteredFunctionOptions.value;

  return [];
});

const functionToggleIcon = computed(() => {
  return (
    "img:" +
    getImageURL(
      searchObj.meta.toggleFunction
        ? "images/common/function_dark.svg"
        : "images/common/function.svg",
    )
  );
});

const iconRight = computed(() => {
  return (
    "img:" +
    getImageURL(
      store.state.theme === "dark"
        ? "images/common/function_dark.svg"
        : "images/common/function.svg",
    )
  );
});

const transformsLabel = computed(() => {
  if (
    searchObj.data.selectedTransform?.type === searchObj.data.transformType &&
    searchObj.data.transformType
  ) {
    return searchObj.data.selectedTransform.name;
  }

  if (!isActionsEnabled.value) return t("search.functionLabel");

  return searchObj.data.transformType === "action"
    ? t("search.actionLabel")
    : searchObj.data.transformType === "function"
      ? t("search.functionLabel")
      : t("search.transformLabel");
});

const transformIcon = computed(() => {
  const isDark = store.state.theme === "dark";
  if (!isActionsEnabled.value)
    return (
      "img:" +
      getImageURL(
        isDark
          ? "images/common/function_dark.svg"
          : "images/common/function.svg",
      )
    );

  if (searchObj.data.transformType === "function")
    return (
      "img:" +
      getImageURL(
        isDark
          ? "images/common/function_dark.svg"
          : "images/common/function.svg",
      )
    );

  if (searchObj.data.transformType === "action") return "code";

  if (!searchObj.data.transformType)
    return (
      "img:" +
      getImageURL(
        isDark
          ? "images/common/transform_dark.svg"
          : "images/common/transform.svg",
      )
    );
});

const updateTransforms = () => {
  updateEditorWidth();
};

const updateEditorWidth = () => {
  if (searchObj.data.transformType) {
    if (searchObj.meta.showTransformEditor) {
      searchObj.config.fnSplitterModel = 60;
    } else {
      searchObj.config.fnSplitterModel = 99.5;
    }
  } else {
    searchObj.config.fnSplitterModel = 99.5;
  }
};

const selectTransform = (item: any, isSelected: boolean) => {
  functionModel.value = false;
  if (searchObj.data.transformType === "function") {
    emit("select:function", item, isSelected);
  }

  // If action is selected notify the user
  if (searchObj.data.transformType === "action") {
    updateActionSelection(item);
  }

  if (typeof item === "object")
    searchObj.data.selectedTransform = {
      ...item,
      type: searchObj.data.transformType,
    };
};

const updateActionSelection = (item: any) => {
  toast({
    message: `${item?.name} action applied successfully`,
    variant: "success",
  });
};

const fnSavedFunctionDialog = () => {
  emit("save:function");
};

const getTransformLabelTooltip = computed(() => {
  if (!isActionsEnabled.value) return t("search.toggleFunctionEditor");

  const editorType =
    searchObj.data.transformType === "action"
      ? t("search.actionLabel")
      : searchObj.data.transformType === "function"
        ? t("search.functionLabel")
        : t("search.transformLabel");

  return searchObj.meta.showTransformEditor
    ? t("search.hide")
    : `${t("search.show")} ${editorType} ${t("search.editor")}`;
});
</script>

<style scoped lang="scss">
@import "@/styles/logs/transform-selector.scss";
.save-transform-btn {
  border-left: 1px solid var(--o2-border-color);
}
</style>
