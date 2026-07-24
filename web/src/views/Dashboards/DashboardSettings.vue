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
  <ODrawer
    data-test="dashboard-settings-drawer"
    bleed
    :open="open"
    :width="74"
    :title="t('dashboard.setting')"
    @update:open="$emit('update:open', $event)"
  >
    <div data-test="dashboard-settings-main-container" class="h-full [min-height:inherit] p-0">
      <OSplitter class="h-full" v-model="splitterModel" unit="px" disabled>
        <template v-slot:before>
          <div class="functions-tabs w-full">
            <OTabs v-model="activeTab" orientation="vertical">
              <OTab
                name="generalSettings"
                icon="settings"
                :label="t('dashboard.generalSettings')"
                class="justify-start py-0 capitalize"
                data-test="dashboard-settings-general-tab"
              />
              <OTab
                name="variableSettings"
                icon="data-array"
                :label="t('dashboard.variableSettings')"
                class="justify-start py-0 capitalize"
                data-test="dashboard-settings-variable-tab"
              />
              <OTab
                name="tabSettings"
                icon="tab"
                :label="t('dashboard.tabSettings')"
                class="justify-start py-0 capitalize"
                data-test="dashboard-settings-tab-tab"
              />
            </OTabs>
          </div>
        </template>
        <template v-slot:after>
          <div class="scroll settings-content-scroll">
            <OTabPanels v-model="activeTab" animated>
              <OTabPanel name="generalSettings" class="!p-0" data-test="general-tab-panels-default">
                <GeneralSettings @save="refreshRequired" @close="$emit('close')" />
              </OTabPanel>

              <OTabPanel
                name="variableSettings"
                class="!p-0"
                data-test="variable-tab-panels-default"
              >
                <VariableSettings @save="refreshRequired" />
              </OTabPanel>

              <OTabPanel name="tabSettings" class="!p-0" data-test="tab-tab-panels-default">
                <TabsSettings @refresh="refreshRequired" />
              </OTabPanel>
            </OTabPanels>
          </div>
        </template>
      </OSplitter>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import GeneralSettings from "../../components/dashboards/settings/GeneralSettings.vue";
import VariableSettings from "../../components/dashboards/settings/VariableSettings.vue";
import TabsSettings from "../../components/dashboards/settings/TabsSettings.vue";
import { getImageURL } from "../../utils/zincutils";

export default defineComponent({
  name: "AppSettings",
  components: {
    ODrawer,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OSplitter,
    VariableSettings,
    GeneralSettings,
    TabsSettings,
  },
  emits: ["refresh", "close", "update:open"],
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const activeTab: any = ref("generalSettings");
    const templates = ref([]);
    const splitterModel = ref(220);

    const refreshRequired = () => {
      emit("refresh");
    };

    return {
      t,
      store,
      router,
      splitterModel,
      activeTab,
      templates,
      getImageURL,
      refreshRequired,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:o2-tabs.o2-splitter): vertical-tab label/active styling, the
   splitter before-pane divider, and full-height tab panels — all target O2
   component internals reached via :deep(). */
.functions-tabs :deep(.o-tabs--vertical .o-tab__content.tab_content .o-tab__icon + .o-tab__label) {
  padding-left: 0.875rem;
  font-weight: 600;
}

.functions-tabs :deep(.o-tabs--vertical .o-tab--active) {
  color: var(--color-tab-text-color);
  background-color: var(--color-theme-tab-bg);
}

:deep(.o-splitter__before) {
  border-right: 1px solid var(--color-border-default);
}

/* Let the settings tab content fill the splitter's full height so panels with a
   sticky footer (e.g. Add Variable) can pin it to the bottom instead of leaving
   dead space when the form is shorter than the drawer. */
.settings-content-scroll,
.settings-content-scroll > :deep(.o-tab-panels),
.settings-content-scroll > :deep(.o-tab-panels > .o-tab-panel) {
  height: 100%;
}
</style>
