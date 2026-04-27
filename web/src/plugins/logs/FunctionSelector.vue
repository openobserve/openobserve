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
  <div
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="function-selector tw:inline-flex tw:items-center tw:h-[30px] tw:rounded-[5px] tw:border tw:border-[var(--o2-border-color)] tw:shrink-0"
    data-test="logs-search-bar-function-selector"
  >
    <!-- Editor toggle -->
    <div
      class="tw:flex tw:items-center tw:px-1 tw:h-full tw:border-r tw:border-[var(--o2-border-color)] tw:cursor-pointer fn-toggle-section"
    >
      <q-toggle
        data-test="logs-search-bar-show-query-toggle-btn"
        v-model="searchObj.meta.showTransformEditor"
        class="o2-toggle-button-xs"
        size="xs"
        flat
        :class="
          store.state.theme === 'dark'
            ? 'o2-toggle-button-xs-dark'
            : 'o2-toggle-button-xs-light'
        "
      >
        <q-tooltip class="tw:text-[12px]" :offset="[0, 4]">
          {{ t('search.toggleFunctionEditor') }}
        </q-tooltip>
      </q-toggle>
    </div>

    <!-- Trigger button — opens rich panel -->
    <button
      class="fn-trigger tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:h-full tw:text-[11px] tw:font-medium tw:cursor-pointer tw:bg-transparent tw:border-none tw:outline-none tw:min-w-0 tw:max-w-[120px]"
      data-test="logs-search-bar-function-dropdown"
    >
      <img :src="fnIcon" class="tw:size-3.5 tw:shrink-0 tw:opacity-80" alt="fn" />
      <span class="tw:truncate tw:max-w-[72px]">{{ triggerLabel }}</span>
      <ChevronDown class="tw:size-3 tw:shrink-0 tw:opacity-40" />
      <q-tooltip class="tw:text-[12px]">{{ selectedFunctionTooltip }}</q-tooltip>

      <!-- Rich dropdown panel -->
      <q-menu
        anchor="bottom left"
        self="top left"
        class="fn-dropdown-panel"
        :offset="[0, 4]"
        style="min-width: 460px; border-radius: 8px; overflow: hidden"
      >
        <div class="tw:flex" style="min-height: 260px">

          <!-- Left: info column -->
          <div
            class="fn-panel-info tw:flex tw:flex-col tw:gap-3 tw:p-4 tw:shrink-0"
            style="width: 160px; border-right: 1px solid var(--o2-border-color)"
          >
            <div>
              <div class="tw:font-semibold tw:text-[12px] tw:mb-1.5">
                {{ t('search.functionLabel') }}
              </div>
              <div class="tw:text-[11px] tw:leading-relaxed fn-panel-desc">
                Use <strong class="tw:font-semibold" style="opacity: 0.9">Vector Remap Language (VRL)</strong> to parse, transform, and enrich your data before it's queried.
              </div>
              <div class="tw:flex tw:flex-col tw:gap-1.5 tw:mt-2">
                <a
                  href="https://vector.dev/docs/reference/vrl/examples/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="fn-panel-doc-link tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-medium tw:px-2.5 tw:py-1 tw:rounded-[4px] tw:whitespace-nowrap fn-panel-doc-link--primary"
                >
                  VRL examples
                  <svg xmlns="http://www.w3.org/2000/svg" class="tw:size-3 tw:shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                </a>
                <a
                  href="https://openobserve.ai/docs/user-guide/data-processing/functions/functions-in-openobserve/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="fn-panel-doc-link tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-medium tw:px-2.5 tw:py-1 tw:rounded-[4px] tw:whitespace-nowrap"
                >
                  Functions docs
                  <svg xmlns="http://www.w3.org/2000/svg" class="tw:size-3 tw:shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                </a>
                <a
                  href="https://openobserve.ai/docs/user-guide/data-processing/pipelines/pipelines/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="fn-panel-doc-link tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-medium tw:px-2.5 tw:py-1 tw:rounded-[4px] tw:whitespace-nowrap"
                >
                  Pipelines docs
                  <svg xmlns="http://www.w3.org/2000/svg" class="tw:size-3 tw:shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                </a>
              </div>
            </div>

            <!-- Editor toggle inside panel too -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:mt-auto tw:pb-1">
              <q-toggle
                v-model="searchObj.meta.showTransformEditor"
                size="xs"
                class="o2-toggle-button-xs"
                :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
                @click.stop
              />
              <span class="tw:text-[11px] fn-panel-desc">Show editor</span>
            </div>
          </div>

          <!-- Right: function list -->
          <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">

            <!-- Search -->
            <div style="border-bottom: 1px solid var(--o2-border-color); padding: 6px 8px">
              <q-input
                v-model="searchTerm"
                dense
                filled
                borderless
                clearable
                debounce="300"
                :placeholder="t('search.searchSavedFunction')"
                data-test="function-search-input"
                style="font-size: 11px"
                @click.stop
              >
                <template #prepend>
                  <q-icon name="search" size="14px" />
                </template>
              </q-input>
            </div>

            <!-- Function list -->
            <div
              class="fn-list tw:flex-1 tw:overflow-y-auto"
              style="max-height: 195px"
              data-test="logs-search-saved-function-list"
            >
              <template v-if="filteredFunctionOptions.length">
                <div
                  v-for="item in filteredFunctionOptions"
                  :key="item.name"
                  v-close-popup
                  class="fn-list-item tw:flex tw:items-center tw:px-3 tw:py-2 tw:cursor-pointer tw:text-[12px]"
                  @click.stop="applyFunction(item)"
                >
                  <span class="tw:flex-1 tw:truncate">{{ item.name }}</span>
                </div>
              </template>
              <div v-else class="tw:px-3 tw:py-6 tw:text-[11px] tw:text-center fn-panel-desc">
                {{ t("search.savedFunctionNotFound") }}
              </div>
            </div>

            <!-- Footer: Save -->
            <div style="border-top: 1px solid var(--o2-border-color); padding: 6px 8px">
              <button
                data-test="logs-search-bar-save-function-btn"
                class="fn-save-btn tw:flex tw:items-center tw:gap-1.5 tw:w-full tw:px-2.5 tw:py-1.5 tw:text-[11px] tw:font-medium tw:rounded-[5px] tw:cursor-pointer tw:transition-colors"
                @click.stop="fnSavedFunctionDialog"
              >
                <q-icon name="save" size="13px" />
                {{ t('common.save') }} {{ t('search.functionLabel').toLowerCase() }}
              </button>
            </div>

          </div>
        </div>
      </q-menu>
    </button>

    <!-- Inline save button — visible when editor is open -->
    <button
      v-if="searchObj.meta.showTransformEditor"
      data-test="logs-search-bar-save-function-btn"
      class="fn-save-inline tw:inline-flex tw:items-center tw:justify-center tw:h-full tw:px-2 tw:cursor-pointer tw:bg-transparent tw:border-none tw:outline-none"
      style="border-left: 1px solid var(--o2-border-color)"
      :title="t('common.save')"
      @click="fnSavedFunctionDialog"
    >
      <q-icon name="save" size="14px" />
      <q-tooltip class="tw:text-[12px]" :offset="[0, 4]">
        {{ t('common.save') }} {{ t('search.functionLabel').toLowerCase() }}
      </q-tooltip>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { ChevronDown } from "lucide-vue-next";

const props = defineProps<{
  functionOptions: { name: string; function: string }[];
}>();

const emit = defineEmits(["select:function", "save:function"]);

const { t } = useI18n();
const { searchObj } = searchState();
const store = useStore();

const searchTerm = ref("");

const fnIcon = computed(() =>
  getImageURL(
    store.state.theme === "dark"
      ? "images/common/function_dark.svg"
      : "images/common/function.svg",
  )
);

const triggerLabel = computed(() => {
  if (searchObj.data.tempFunctionName) return searchObj.data.tempFunctionName;
  return t("search.functionLabel");
});

const selectedFunctionTooltip = computed(() => {
  if (searchObj.data.tempFunctionName) {
    return `${t("search.functionLabel")}: ${searchObj.data.tempFunctionName}`;
  }
  return t("search.functionPlaceholder");
});

const filteredFunctionOptions = computed(() => {
  if (!searchTerm.value) return props.functionOptions;
  return props.functionOptions.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  );
});

const applyFunction = (item: { name: string; function: string }) => {
  emit("select:function", item, true);
};

const fnSavedFunctionDialog = () => {
  emit("save:function");
};
</script>

<style scoped lang="scss">
.fn-trigger {
  color: var(--o2-tab-text-color, #374151);
  &:hover {
    background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
    border-radius: 4px;
  }
}

.fn-toggle-section:hover {
  background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
}

.fn-panel-desc {
  color: var(--o2-tab-text-color, #374151);
  opacity: 0.6;
}

.fn-panel-doc-link {
  text-decoration: none;
  border: 1px solid var(--o2-border-color);
  color: var(--o2-tab-text-color, #374151);
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
  }

  &--primary {
    background-color: var(--o2-primary-btn-bg, var(--q-primary));
    color: var(--o2-primary-btn-text, #fff);
    border-color: transparent;

    &:hover {
      opacity: 0.88;
      background-color: var(--o2-primary-btn-bg, var(--q-primary));
    }
  }
}

.fn-list-item {
  color: var(--o2-tab-text-color, #374151);
  transition: background-color 0.15s ease;
  border-bottom: 1px solid var(--o2-border-color);

  &:hover {
    background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
  }

}

.fn-save-btn {
  background: transparent;
  border: 1px solid var(--o2-border-color);
  color: var(--o2-tab-text-color, #374151);

  &:hover {
    background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
  }
}

.fn-save-inline {
  color: var(--o2-tab-text-color, #374151);
  border-radius: 0 5px 5px 0;

  &:hover {
    background-color: var(--o2-hover-accent, rgba(0, 0, 0, 0.04));
  }
}

// Dark theme panel background
.dark-theme .fn-dropdown-panel,
.body--dark .fn-dropdown-panel {
  background-color: var(--o2-card-background);
}
</style>
