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
    :icon="functionToggleIcon"
    title="Toggle Function Editor"
    class="float-left tw-cursor-pointer o2-toggle-button-xs tw-flex tw-items-center tw-justify-center"
    size="xs"
    :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
  />
  <q-btn-group
    class="no-outline q-pa-none no-border float-left function-selector"
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
      class="saved-views-dropdown btn-function"
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
            class="tw-border-b saved-view-item"
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
    getImageURL(
         "images/common/function.svg",
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
.toolbar-toggle-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.175rem; // 0 ~2.8px
  margin-left: 0.25rem; // 4px
  border: 0.0625rem solid rgba(0, 0, 0, 0.12); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  :deep(.q-toggle__inner) {
    padding: 0;
  }
}

.dark-theme .toolbar-toggle-container {
  border: 0.0625rem solid rgb(196, 196, 196);
}

.toolbar-icon-in-toggle {
  font-size: 0.9rem; // ~14.4px
}

.function-selector {
  margin-right: 0.5rem; // 8px
  border-radius: 0.375rem; // 6px

  :deep(.btn-function) {
    transition: all 0.2s ease;
    padding-right: 0.5rem; // 8px
    margin-right: 0.125rem; // 2px

    &:hover {
      background-color: var(--o2-hover-accent);
    }

    .q-btn__content {
      .q-icon {
        font-size: 1.125rem; // 18px
      }
    }
  }

  :deep(.q-btn-dropdown__arrow-container) {
    transition: all 0.2s ease;
    padding-left: 0.5rem; // 8px
    margin-left: 0.125rem; // 2px

    &:hover {
      background-color: var(--o2-hover-accent);
    }
  }
}
</style>
