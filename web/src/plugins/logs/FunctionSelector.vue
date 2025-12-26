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
    <div class="toolbar-toggle-container float-left tw:mr-1">
    <q-toggle
      data-test="logs-search-bar-show-query-toggle-btn"
      v-model="searchObj.meta.showTransformEditor"
      title="Toggle Function Editor"
      class="float-left tw:cursor-pointer o2-toggle-button-xs tw:flex tw:items-center tw:justify-center element-box-shadow"
      size="xs"
      :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
      >
      <q-icon :name="functionToggleIcon" class="toolbar-icon-in-toggle" />
    </q-toggle>
  </div>
  <q-btn-group
    class="no-outline q-pa-none no-border float-left function-selector element-box-shadow tw:h-[32px]"
    :disable="!searchObj.meta.showTransformEditor"
  >
    <q-btn-dropdown
      data-test="logs-search-bar-function-dropdown"
      v-model="functionModel"
      size="12px"
      icon="save"
      :icon-right="iconRight"
      :title="t('search.functionPlaceholder')"
      split
      class="saved-views-dropdown btn-function el-border"
      @click="fnSavedFunctionDialog"
    >
      <q-list data-test="logs-search-saved-function-list">
        <!-- Search Input -->
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

        <div v-if="filteredFunctionOptions.length">
          <q-item
            class="tw:border-b saved-view-item"
            clickable
            v-for="(item, i) in filteredFunctionOptions"
            :key="'saved-view-' + i"
            v-close-popup
          >
            <q-item-section
              @click.stop="applyFunction(item, true)"
              v-close-popup
            >
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
    </q-btn-dropdown>
  </q-btn-group>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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
    (store.state.theme == 'dark' ?
      getImageURL("images/common/function_dark.svg") :
      getImageURL("images/common/function.svg"))
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

const fnSavedFunctionDialog = () => {
  emit("save:function");
};

const filteredFunctionOptions = computed(() => {
  if (!searchTerm.value) return props.functionOptions;
  return props.functionOptions.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  );
});

const applyFunction = (
  item: { name: string; function: string },
  flag = false,
) => {
  emit("select:function", item, flag);
};
</script>

<style scoped lang="scss">
@import '@/styles/logs/function-selector.scss';
</style>
