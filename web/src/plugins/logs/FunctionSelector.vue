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
    class="q-pa-none float-left q-mr-xs function-selector element-box-shadow tw:border tw:border-button-outline-border"
  >
    <div class="tw:flex tw:items-center tw:mx-1">
      <OSwitch
        data-test="logs-search-bar-show-query-toggle-btn"
        v-model="searchObj.meta.showTransformEditor"
        size="lg"
      >
        <template #tooltip>
          <OTooltip :content="t('search.toggleFunctionEditor')" :side-offset="2" />
        </template>
      </OSwitch>
    </div>
    <ODropdown v-model:open="functionModel" side="bottom" align="start">
      <template #trigger>
        <OButton
          data-test="logs-search-bar-function-dropdown"
          variant="ghost"
          size="icon-toolbar"
        >
          <img :src="functionIconUrl" alt="Function" class="tw:size-4" />
          <q-icon name="arrow_drop_down" size="14px" class="tw:-ms-1" />
          <OTooltip :content="selectedFunctionTooltip" :side-offset="2" />
        </OButton>
      </template>
      <q-list data-test="logs-search-saved-function-list" class="tw:py-0">
        <!-- Search Input -->
        <div>
          <OInput
            v-model="searchTerm"
            clearable
            :debounce="300"
            :placeholder="t('search.searchSavedFunction')"
            data-test="function-search-input"
          >
            <template #icon-left>
              <q-icon name="search" />
            </template>
          </OInput>
        </div>

        <div v-if="filteredFunctionOptions.length">
          <q-item
            class="tw:border-b saved-view-item"
            clickable
            v-for="(item, i) in filteredFunctionOptions"
            :key="'saved-view-' + i"
            @click="applyFunction(item, true)"
          >
            <q-item-section>
              <q-item-label>{{ item.name }}</q-item-label>
            </q-item-section>
          </q-item>
        </div>
        <div v-else>
          <q-item>
            <q-item-section>
              <q-item-label>{{
                t("search.savedFunctionNotFound")
              }}</q-item-label>
            </q-item-section>
          </q-item>
        </div>
      </q-list>
    </ODropdown>
    <OButton
      data-test="logs-search-bar-save-function-btn"
      variant="ghost"
      size="icon-toolbar"
      @click="fnSavedFunctionDialog"
    >
      <q-icon name="save" size="16px" />
      <OTooltip :content="t('common.save')" :side-offset="6" />
    </OButton>
  </OButtonGroup>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
const props = defineProps<{
  functionOptions: { name: string; function: string }[];
}>();

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18n();

const { searchObj } = searchState();

const store = useStore();

const functionToggleIcon = computed(() => {
  return (
    "img:" +
    (store.state.theme == "dark"
      ? getImageURL("images/common/function_dark.svg")
      : getImageURL("images/common/function.svg"))
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
    return `${t("search.functionLabel")}: ${searchObj.data.selectedFunction.name}`;
  }
  return t("search.functionPlaceholder");
});

const applyFunction = (
  item: { name: string; function: string },
  flag = false,
) => {
  functionModel.value = false;
  emit("select:function", item, flag);
};
</script>

<style scoped lang="scss">
@import "@/styles/logs/function-selector.scss";
.save-function-btn {
  border-left: 1px solid var(--o2-border-color);
}
</style>
