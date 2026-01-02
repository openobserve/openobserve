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
  <div class="toolbar-toggle-container float-left">
    <q-toggle
      data-test="logs-search-bar-show-query-toggle-btn"
      v-model="searchObj.meta.showTransformEditor"
      class="o2-toggle-button-xs element-box-shadow"
      size="xs"
      flat
      :disable="
        !searchObj.data.transformType ||
        searchObj.meta.logsVisualizeToggle === 'visualize'
      "
    >
      <q-icon :name="transformIcon" class="toolbar-icon-in-toggle" :class="transformsLabel" />
      <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">
        {{ getTransformLabelTooltip }}
      </q-tooltip>
    </q-toggle>
  </div>

  <q-btn-group
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="q-pa-none float-left q-mr-xs tw:h-[32px] transform-selector element-box-shadow el-border"
  >
    <div>
      <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">{{
        transformsLabel
      }}</q-tooltip>
      <q-btn-dropdown
        data-test="logs-search-bar-function-dropdown"
        v-model="functionModel"
        size="12px"
        :icon="transformIcon"
        :label="transformsLabel"
        no-caps
        class="btn-function no-case q-pl-sm q-pr-none no-border no-outline tw:border-none"
        :class="`${searchObj.data.transformType || 'transform'}-icon`"
        label-class="no-case"
        :disable="searchObj.meta.logsVisualizeToggle === 'visualize'"
      >
        <q-list data-test="logs-search-saved-function-list">
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
              v-close-popup
            >
              <q-item-section
                @click.stop="selectTransform(item, true)"
                v-close-popup
              >
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
      </q-btn-dropdown>
    </div>
    <q-btn
      data-test="logs-search-bar-save-transform-btn"
      class=" save-transform-btn q-px-sm"
      icon="save"
      :disable="searchObj.data.transformType !== 'function' || searchObj.meta.logsVisualizeToggle === 'visualize'"
      @click="fnSavedFunctionDialog"

    >
      <q-tooltip class="tw:text-[12px]" :offset="[0, 6]">
        {{
          searchObj.data.transformType === "action"
            ? t("search.saveActionDisabled")
            : searchObj.meta.logsVisualizeToggle === 'visualize' ? 'Not supported for visualization' : t("common.save")
        }}
      </q-tooltip>
    </q-btn>
  </q-btn-group>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

  if (searchObj.meta.logsVisualizeToggle === 'visualize') return t("search.functionSelectionNotSupportedVisualization");

  if (!isActionsEnabled.value) return t("search.functionLabel");

  return searchObj.data.transformType === "action"
    ? t("search.actionLabel")
    : searchObj.data.transformType === "function"
      ? t("search.functionLabel")
      : t("search.transformLabel");
});

const transformIcon = computed(() => {
  if (!isActionsEnabled.value)
    return "img:" + getImageURL("images/common/function.svg");

  if (searchObj.data.transformType === "function")
    return "img:" + getImageURL("images/common/function.svg");

  if (searchObj.data.transformType === "action") return "code";

  if (!searchObj.data.transformType)
    return "img:" + getImageURL("images/common/transform.svg");
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

  // function selection is not supported for visualization
  if (searchObj.meta.logsVisualizeToggle === 'visualize') return t("search.functionSelectionNotSupportedVisualization");

  if (!isActionsEnabled.value) return t("search.toggleFunctionEditor");

  const editorType = searchObj.data.transformType === "action"
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
@import '@/styles/logs/transform-selector.scss';
.save-transform-btn{
  border-left: 1px solid var(--o2-border-color);
}
</style>
