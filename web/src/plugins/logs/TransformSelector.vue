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
  <q-toggle
    data-test="logs-search-bar-show-query-toggle-btn"
    v-model="searchObj.meta.showTransformEditor"
    :icon="transformIcon"
    class="float-left tw-cursor-pointer"
    size="32px"
    :disable="!searchObj.data.transformType"
  >
    <q-tooltip class="tw-text-[12px]" :offset="[0, 2]">
      {{ getTransformLabelTooltip }}
    </q-tooltip>
  </q-toggle>

  <q-btn-group
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="no-outline q-pa-none no-border float-left q-mr-xs transform-selector"
  >
    <div>
      <q-tooltip class="tw-text-[12px]" :offset="[0, 2]">{{
        transformsLabel
      }}</q-tooltip>
      <q-btn-dropdown
        data-test="logs-search-bar-function-dropdown"
        v-model="functionModel"
        size="12px"
        :icon="transformIcon"
        :label="transformsLabel"
        no-caps
        class="saved-views-dropdown btn-function no-case q-pl-sm q-pr-none"
        :class="`${searchObj.data.transformType || 'transform'}-icon`"
        label-class="no-case"
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
              class="tw-border-b saved-view-item"
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
      class="q-mr-xs save-transform-btn q-px-sm"
      size="sm"
      icon="save"
      :disable="searchObj.data.transformType !== 'function'"
      @click="fnSavedFunctionDialog"
    >
      <q-tooltip class="tw-text-[12px]" :offset="[0, 6]">
        {{
          searchObj.data.transformType === "action"
            ? t("search.saveActionDisabled")
            : t("common.save")
        }}
      </q-tooltip>
    </q-btn>
  </q-btn-group>
</template>

<script setup lang="ts">
import { computed, ref, inject } from "vue";
import { useI18n } from "vue-i18n";
import useLogs from "@/composables/useLogs";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

const props = defineProps<{
  functionOptions: { name: string; function: string }[];
}>();

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18n();

const searchObj = inject("searchObj") as any;

const { isActionsEnabled } = useLogs(searchObj);

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

  if (!isActionsEnabled.value) return "Function";

  return searchObj.data.transformType === "action"
    ? "Action"
    : searchObj.data.transformType === "function"
      ? "Function"
      : "Transform";
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
  if (!isActionsEnabled.value) return "Toggle Function Editor";

  return searchObj.meta.showTransformEditor
    ? "Hide"
    : "Show" + searchObj.data.transformType === "action"
      ? "Action"
      : searchObj.data.transformType === "function"
        ? "Function"
        : "Transform" + "Editor";
});
</script>

<style scoped lang="scss">
.dark-theme {
  :deep(.transform-icon),
  :deep(.function-icon) {
    .q-icon {
      &.on-left {
        filter: invert(1);
      }
    }
  }
}

.transform-selector {
  :deep(.btn-function) {
    width: 140px;

    .q-btn__content {
      justify-content: start !important;

      span {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        width: 80px;
      }

      .q-btn-dropdown__arrow {
        margin-left: 4px !important;
      }
    }
  }
}
</style>
