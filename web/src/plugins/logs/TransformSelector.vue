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
    class="transform-selector element-box-shadow border-button-outline-border float-left mr-1 border p-0"
  >
    <!-- Wrap toggle + dropdown together so divide-x only creates one separator (before save) -->
    <div class="flex items-center">
      <div v-if="!hideToggle" class="flex items-center">
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
              :alt="t('logs.transformSelector.transform')"
              class="size-4"
            />
            <OIcon v-else :name="transformIcon" size="sm" />
            <OIcon name="arrow-drop-down" size="sm" class="ms-0.5" />
            <OTooltip :content="transformsLabel" :side-offset="2" />
          </OButton>
        </template>
        <div data-test="logs-search-saved-function-list" class="py-0">
          <!-- Search Input -->
          <div
            data-test="logs-search-bar-transform-type-select"
            class="logs-transform-type o2-input mx-2 pt-0"
          >
            <OSelect
              v-if="isActionsEnabled"
              v-model="searchObj.data.transformType"
              :options="transformTypes"
              :label="t('search.transformType')"
              class="py-1"
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

          <div v-if="filteredTransformOptions.length" class="max-h-72 overflow-y-auto">
            <ul class="m-0 flex list-none flex-col p-0">
              <li
                v-for="item in filteredTransformOptions"
                :key="'transform-' + item?.name"
                :data-test="`logs-search-saved-transform-item-${item?.name}`"
                class="saved-view-item hover:bg-muted/50 flex cursor-pointer items-center gap-2 border-b px-3 py-2"
                @click="selectTransform(item, true)"
              >
                <span class="min-w-0 flex-1 text-sm">{{ item.name }}</span>
              </li>
            </ul>
          </div>
          <div v-else>
            <div class="flex items-center gap-2 px-3 py-2">
              <div class="flex min-w-0 flex-1 flex-col">
                <span v-if="searchObj.data.transformType === 'function'" class="text-sm">{{
                  t("search.savedFunctionNotFound")
                }}</span>
                <span v-if="searchObj.data.transformType === 'action'" class="text-sm">{{
                  t("search.actionsNotFound")
                }}</span>
                <span v-if="!searchObj.data.transformType" class="text-sm">{{
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
        :content="
          searchObj.data.transformType === 'action'
            ? t('search.saveActionDisabled')
            : t('common.save')
        "
        :side-offset="6"
      />
    </OButton>
  </OButtonGroup>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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
import { useTheme } from "@/composables/useTheme";
import { toast } from "@/lib/feedback/Toast/useToast";

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

const { t } = useI18n();

const { searchObj } = searchState();

const { isActionsEnabled } = logsUtils();

const store = useStore();
const { isDark } = useTheme();

const functionModel = ref(false);

const transformTypes = computed(() => {
  return [
    { label: t("logs.transformSelector.function"), value: "function" },
    { label: t("logs.transformSelector.action"), value: "action" },
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

  if (searchObj.data.transformType === "action") return filteredActionOptions.value;

  if (searchObj.data.transformType === "function") return filteredFunctionOptions.value;

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
    getImageURL(isDark.value ? "images/common/function_dark.svg" : "images/common/function.svg")
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
  if (!isActionsEnabled.value)
    return (
      "img:" +
      getImageURL(isDark.value ? "images/common/function_dark.svg" : "images/common/function.svg")
    );

  if (searchObj.data.transformType === "function")
    return (
      "img:" +
      getImageURL(isDark.value ? "images/common/function_dark.svg" : "images/common/function.svg")
    );

  if (searchObj.data.transformType === "action") return "code";

  if (!searchObj.data.transformType)
    return (
      "img:" +
      getImageURL(isDark.value ? "images/common/transform_dark.svg" : "images/common/transform.svg")
    );

  return undefined;
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
    message: t("logs.transformSelector.actionApplied", { name: item?.name }),
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

<style scoped>
/* keep(lib-override:obuttongroup): rounds OButtonGroup's own root, which this
   component only receives as a class — not settable from the template without
   losing to the group's internal radius. */
.transform-selector {
  border-radius: 0.375rem;
}
</style>
