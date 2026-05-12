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
    class="q-pa-none float-left q-mr-xs transform-selector element-box-shadow tw:border tw:border-button-outline-border"
  >
    <!-- Wrap toggle + dropdown together so divide-x only creates one separator (before save) -->
    <div class="tw:flex tw:items-center">
      <div class="tw:flex tw:items-center">
        <q-toggle
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.showTransformEditor"
          class="o2-toggle-button-xs"
          size="xs"
          flat
          :disable="!searchObj.data.transformType"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-xs-dark'
              : 'o2-toggle-button-xs-light'
          "
        >
          <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">
            {{ getTransformLabelTooltip }}
          </q-tooltip>
        </q-toggle>
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
            <q-icon v-else :name="transformIcon" size="16px" />
            <q-icon name="arrow_drop_down" size="18px" class="tw:ms-0.5" />
            <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">{{
              transformsLabel
            }}</q-tooltip>
          </OButton>
        </template>
        <q-list data-test="logs-search-saved-function-list" class="tw:py-0">
          <!-- Search Input -->
          <div
            data-test="logs-search-bar-transform-type-select"
            class="logs-transform-type o2-input q-mx-sm"
            style="padding-top: 0"
          >
            <q-select
              v-if="isActionsEnabled"
              v-model="searchObj.data.transformType"
              :options="transformTypes"
              :label="t('search.transformType')"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop no-case"
              stack-label
              outlined
              emit-value
              filled
              dense
              clearable
              @update:model-value="updateTransforms()"
            />
          </div>
          <div>
            <q-input
              v-model="searchTerm"
              dense
              filled
              borderless
              clearable
              debounce="300"
              :placeholder="t('search.searchSavedFunction')"
              data-test="function-search-input"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>
            </q-input>
          </div>

          <div v-if="filteredTransformOptions.length">
            <q-item
              class="tw:border-b saved-view-item"
              clickable
              v-for="(item, i) in filteredTransformOptions"
              :key="'transform-' + item?.name"
              @click="selectTransform(item, true)"
            >
              <q-item-section>
                <q-item-label>{{ item.name }}</q-item-label>
              </q-item-section>
            </q-item>
          </div>
          <div v-else>
            <q-item>
              <q-item-section>
                <q-item-label
                  v-if="searchObj.data.transformType === 'function'"
                  >{{ t("search.savedFunctionNotFound") }}</q-item-label
                >
                <q-item-label
                  v-if="searchObj.data.transformType === 'action'"
                  >{{ t("search.actionsNotFound") }}</q-item-label
                >
                <q-item-label v-if="!searchObj.data.transformType">{{
                  t("search.selectTransformType")
                }}</q-item-label>
              </q-item-section>
            </q-item>
          </div>
        </q-list>
      </ODropdown>
    </div>
    <OButton
      data-test="logs-search-bar-save-transform-btn"
      variant="ghost"
      size="icon-toolbar"
      :disabled="searchObj.data.transformType !== 'function'"
      @click="fnSavedFunctionDialog"
    >
      <q-icon name="save" size="16px" />
      <q-tooltip class="tw:text-[12px]" :offset="[0, 6]">
        {{
          searchObj.data.transformType === "action"
            ? t("search.saveActionDisabled")
            : t("common.save")
        }}
      </q-tooltip>
    </OButton>
  </OButtonGroup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

const props = defineProps<{
  functionOptions: { name: string; function: string }[];
}>();

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18n();

const { searchObj } = searchState();

const { isActionsEnabled } = logsUtils();

const store = useStore();

const functionModel = ref(false);

const $q = useQuasar();

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
  $q.notify({
    message: `${item?.name} action applied successfully`,
    timeout: 3000,
    color: "secondary",
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
