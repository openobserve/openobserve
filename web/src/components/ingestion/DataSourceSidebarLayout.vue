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

<!--
  Shared left-sidebar shell for the Data Sources (ingestion) category pages.

  It owns the splitter, the gray side-nav panel + its right-border separator,
  the optional search box, and the dense vertical tab list. Every data-source
  category page (Database, Languages, Custom, …) renders this and supplies its
  own tab list + content. Tune the panel / spacing / tab density HERE to retune
  every data-source side-nav at once.

  Usage: render DataSourceSidebarLayout with v-model bound to the active tab,
  a :tabs array, a :splitter-width, and (optionally) `searchable` +
  search-data-test. The default slot is the content pane (e.g. a router-view).

  For a fully custom tab list (e.g. OTab instead of ORouteTab), use the
  #tabs slot — it receives { tabs, filter } so you can render/filter yourself.
-->
<template>
  <div v-if="compact" class="flex h-full min-h-0 flex-col">
    <div
      v-if="compactMode === 'strip'"
      class="border-border-default shrink-0 border-b px-2"
      :data-test="panelDataTest || undefined"
    >
      <OTabs
        :model-value="modelValue"
        dense
        :class="tabsClass"
        @update:model-value="(v) => emit('update:modelValue', v)"
      >
        <slot name="tabs" :tabs="filteredTabs" :filter="filter">
          <ORouteTab
            v-for="(tab, index) in filteredTabs"
            :key="tab.name"
            :title="tab.title || tab.name"
            :default="index === 0"
            :name="tab.name"
            :to="tab.to"
            :icon="tab.icon"
            :label="tab.label"
            :data-test="
              tab.dataTest || (tabDataTestPrefix ? tabDataTestPrefix + tab.name : undefined)
            "
          />
        </slot>
      </OTabs>
    </div>
    <div
      v-else
      class="border-border-default flex shrink-0 items-center border-b px-2 py-1"
      data-drawer-anchor="data-source-sidebar"
    >
      <OButton
        variant="ghost"
        size="sm"
        data-test="data-source-sidebar-mobile-btn"
        @click="mobileSidebarOpen = true"
      >
        <template #icon-left><OIcon name="menu" size="sm" /></template>
        {{ triggerLabel }}
      </OButton>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <slot />
    </div>
    <ODrawer
      v-if="compactMode !== 'strip'"
      v-model:open="mobileSidebarOpen"
      side="left"
      size="sm"
      bleed
      seamless
      anchor='[data-drawer-anchor="data-source-sidebar"]'
      data-test="data-source-sidebar-mobile-drawer"
    >
      <div
        :class="['h-full overflow-hidden', { 'pt-1.5': !searchable }]"
        :data-test="panelDataTest || undefined"
      >
        <div v-if="searchable" class="p-2">
          <OSearchInput
            v-model="filter"
            :data-test="searchDataTest || undefined"
            clearable
            class="indexlist-search-input w-full"
            :placeholder="searchPlaceholder || t('common.search')"
          />
        </div>
        <OTabs
          :model-value="modelValue"
          orientation="vertical"
          dense
          :class="['px-1', tabsClass]"
          @update:model-value="
            (v) => {
              emit('update:modelValue', v);
              mobileSidebarOpen = false;
            }
          "
        >
          <slot name="tabs" :tabs="filteredTabs" :filter="filter">
            <ORouteTab
              v-for="(tab, index) in filteredTabs"
              :key="tab.name"
              :title="tab.title || tab.name"
              :default="index === 0"
              :name="tab.name"
              :to="tab.to"
              :icon="tab.icon"
              :label="tab.label"
              :data-test="
                tab.dataTest || (tabDataTestPrefix ? tabDataTestPrefix + tab.name : undefined)
              "
            />
          </slot>
        </OTabs>
      </div>
    </ODrawer>
  </div>

  <OSplitter v-else v-model="splitterWidthModel" unit="px" :horizontal="false" class="h-full">
    <template #before>
      <div class="h-full w-full">
        <div class="bg-surface-panel border-border-default h-full border-e">
          <div
            :class="['h-full overflow-hidden', { 'pt-1.5': !searchable }]"
            :data-test="panelDataTest || undefined"
          >
            <div v-if="searchable" class="p-2">
              <OSearchInput
                v-model="filter"
                :data-test="searchDataTest || undefined"
                clearable
                class="indexlist-search-input w-full"
                :placeholder="searchPlaceholder || t('common.search')"
              />
            </div>
            <OTabs
              :model-value="modelValue"
              orientation="vertical"
              dense
              :class="['px-1', tabsClass]"
              @update:model-value="(v) => emit('update:modelValue', v)"
            >
              <slot name="tabs" :tabs="filteredTabs" :filter="filter">
                <ORouteTab
                  v-for="(tab, index) in filteredTabs"
                  :key="tab.name"
                  :title="tab.title || tab.name"
                  :default="index === 0"
                  :name="tab.name"
                  :to="tab.to"
                  :icon="tab.icon"
                  :label="tab.label"
                  :data-test="
                    tab.dataTest || (tabDataTestPrefix ? tabDataTestPrefix + tab.name : undefined)
                  "
                />
              </slot>
            </OTabs>
          </div>
        </div>
      </div>
    </template>

    <template #after>
      <slot />
    </template>
  </OSplitter>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useBreakpoint from "@/composables/useBreakpoint";

interface DataSourceTab {
  name: string;
  to: Record<string, any>;
  label: I18nText;
  icon?: string;
  title?: I18nText;
  dataTest?: string;
}

const props = withDefaults(
  defineProps<{
    /** Active tab name (v-model) — drives the highlighted tab. */
    modelValue?: string;
    /** Tab definitions rendered as ORouteTab rows (ignored if #tabs slot used). */
    tabs?: DataSourceTab[];
    /** Initial side-nav width in px. */
    splitterWidth?: number;
    /** Show the search box above the tab list. */
    searchable?: boolean;
    /** data-test for the search input. */
    searchDataTest?: string;
    /** Placeholder for the search input (defaults to common.search). */
    searchPlaceholder?: I18nText;
    /** Extra class(es) for the OTabs element. */
    tabsClass?: string;
    /** data-test for the tab-list wrapper. */
    panelDataTest?: string;
    /** Prefix to derive each tab's data-test as `${prefix}${tab.name}` (when tab.dataTest is unset). */
    tabDataTestPrefix?: string;
    /** < lg: "drawer" hides the rail behind a trigger; "strip" renders it as a horizontal tab row. */
    compactMode?: "drawer" | "strip";
  }>(),
  {
    modelValue: "",
    tabs: () => [],
    splitterWidth: 250,
    searchable: false,
    searchDataTest: "",
    searchPlaceholder: raw(""),
    tabsClass: "",
    panelDataTest: "",
    tabDataTestPrefix: "",
    compactMode: "drawer",
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string | number): void;
}>();

const { t } = useI18nTyped();

// Splitter width is local state seeded from the prop; resizing stays internal.
const splitterWidthModel = ref(props.splitterWidth);
watch(
  () => props.splitterWidth,
  (w) => {
    splitterWidthModel.value = w;
  },
);

const filter = ref("");

const { lgUp } = useBreakpoint();
const compact = computed(() => !lgUp.value);
const mobileSidebarOpen = ref(false);
// Nested layouts (signal rail + tool rail) each show a trigger; the active tab's label tells them apart.
const triggerLabel = computed(() => {
  const active = props.tabs.find((tab) => tab.name === props.modelValue);
  return active ? active.label : t("common.sidePanel");
});
const filteredTabs = computed(() => {
  if (!props.searchable || !filter.value) {
    return props.tabs;
  }
  const q = filter.value.toLowerCase();
  return props.tabs.filter((tab) => tab.label.toLowerCase().includes(q));
});
</script>
