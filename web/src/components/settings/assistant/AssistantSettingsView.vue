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
  <OPageLayout
    :title="t('assistant.settings.pageTitle', name)"
    :icon="assistantGlyph.assistant"
    title-data-test="settings-assistant-page-title"
    tabs-below
    scroll
  >
    <template #header-tabs>
      <OTabs :model-value="activeTab" align="left" data-test="settings-assistant-tabs">
        <ORouteTab
          v-for="entry in TABS"
          :key="entry.id"
          :name="entry.id"
          :label="t(entry.labelKey)"
          :to="{
            name: 'assistantSettings',
            params: { tab: entry.id },
            query: { org_identifier: page.org.value },
          }"
          :data-test="`settings-assistant-tab-${entry.id}`"
        />
      </OTabs>
    </template>
    <template #actions>
      <ORefreshButton
        :loading="refreshing"
        data-test="settings-assistant-refresh"
        @click="refresh"
      />
    </template>
    <div
      class="flex max-w-240 flex-col gap-4 p-4 max-md:p-3"
      :data-test="`settings-assistant-panel-${activeTab}`"
    >
      <div
        v-if="adminHelper"
        class="border-border-default rounded-surface flex flex-wrap items-center gap-3 border p-3"
        data-test="settings-assistant-admin-only"
      >
        <p class="text-text-body min-w-0 flex-1 text-sm">
          {{ t("assistant.settings.adminOnly") }}
        </p>
        <AssistantAskAdminPopover kind="settings" :org="page.org.value">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm-action"
              class="max-md:min-h-11"
              data-test="settings-assistant-ask-admin"
              >{{ t("assistant.gate.noPermission.askAdmin") }}</OButton
            >
          </template>
        </AssistantAskAdminPopover>
      </div>
      <p
        v-if="!page.aiEnabled.value && activeTab !== 'status'"
        class="text-text-secondary text-sm"
        data-test="settings-assistant-off-in-deployment"
      >
        {{ t("assistant.settings.offInDeployment") }}
      </p>
      <component
        :is="TAB_COMPONENTS[activeTab]"
        :key="`${page.org.value}:${activeTab}`"
        ref="panel"
      />
    </div>
  </OPageLayout>
</template>

<script lang="ts">
import type { I18nKey } from "@/types/i18n";

export type AssistantSettingsTab =
  "status" | "access" | "data" | "history" | "usage" | "toolsets" | "permissions" | "activity";

export interface AssistantSettingsViewProps {
  tab?: AssistantSettingsTab;
}

/** The tabs this build renders, in strip order; an unknown or unbuilt tab id lands on Status. */
export const SETTINGS_TABS: { id: AssistantSettingsTab; labelKey: I18nKey; writes: boolean }[] = [
  { id: "status", labelKey: "assistant.settings.tabs.status", writes: true },
  { id: "access", labelKey: "assistant.settings.tabs.access", writes: true },
  { id: "data", labelKey: "assistant.settings.tabs.data", writes: true },
  { id: "history", labelKey: "assistant.settings.tabs.history", writes: false },
  { id: "usage", labelKey: "assistant.settings.tabs.usage", writes: false },
  { id: "toolsets", labelKey: "assistant.settings.tabs.toolsets", writes: false },
  { id: "permissions", labelKey: "assistant.settings.tabs.permissions", writes: false },
  { id: "activity", labelKey: "assistant.settings.tabs.activity", writes: false },
];
</script>

<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import { useAssistantName } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { useI18nTyped } from "@/types/i18n";

import AccessTab from "./AccessTab.vue";
import ActivityTab from "./ActivityTab.vue";
import DataTab from "./DataTab.vue";
import HistoryTab from "./HistoryTab.vue";
import PermissionsTab from "./PermissionsTab.vue";
import StatusTab from "./StatusTab.vue";
import ToolsetsTab from "./ToolsetsTab.vue";
import UsageTab from "./UsageTab.vue";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const TABS = SETTINGS_TABS;

const TAB_COMPONENTS: Partial<Record<AssistantSettingsTab, Component>> = {
  status: StatusTab,
  access: AccessTab,
  data: DataTab,
  history: HistoryTab,
  usage: UsageTab,
  toolsets: ToolsetsTab,
  permissions: PermissionsTab,
  activity: ActivityTab,
};

const props = withDefaults(defineProps<AssistantSettingsViewProps>(), { tab: undefined });

const { t } = useI18nTyped();
const name = useAssistantName();
const router = useRouter();
const page = useAssistantSettingsPage();

const panel = ref<{ refresh?: () => Promise<unknown> | undefined } | null>(null);
const refreshing = ref(false);

const known = computed(() => TABS.find((entry) => entry.id === props.tab));
const activeTab = computed<AssistantSettingsTab>(() => known.value?.id ?? "status");
const adminHelper = computed(() => !page.isAdmin.value && (known.value?.writes ?? true));

watch(
  () => props.tab,
  (tab) => {
    if (tab && known.value) return;
    void router.replace({
      name: "assistantSettings",
      params: { tab: "status" },
      query: router.currentRoute.value.query,
    });
  },
  { immediate: true },
);

async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await panel.value?.refresh?.();
  } finally {
    refreshing.value = false;
  }
}
</script>
