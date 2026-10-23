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
    :title="t('fleet.title')"
    :subtitle="t('fleet.subtitle')"
    icon="workspaces"
    bleed
    tabs-below
    data-test="fleet-manager-page"
  >
    <template #actions>
      <OButton
        v-if="createLabel"
        variant="primary"
        size="sm"
        :data-test="`fleet-manager-create-${activeTab}`"
        @click="onCreate"
      >
        {{ createLabel }}
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs :model-value="activeTab" align="left" @change="go($event as FleetTab)">
        <OTab
          v-for="tab in tabs"
          :key="tab.name"
          :name="tab.name"
          :data-test="`fleet-manager-tab-${tab.name}`"
        >
          <OIcon :name="tab.icon" size="sm" class="max-md:hidden" />
          <span>{{ tab.label }}</span>
        </OTab>
      </OTabs>
    </template>

    <FleetOverview
      v-if="activeTab === 'overview'"
      data-test="fleet-manager-overview"
      @navigate="(tab, query) => go(tab, query)"
    />
    <FleetFleets v-else-if="activeTab === 'fleets'" ref="createTarget" />
    <FleetConfigurations v-else-if="activeTab === 'configurations'" ref="createTarget" />
    <FleetSettings v-else-if="activeTab === 'settings'" />
    <FleetAudit v-else-if="activeTab === 'audit'" />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import FleetOverview from "@/components/fleet/FleetOverview.vue";
import FleetFleets from "@/components/fleet/FleetFleets.vue";
import FleetConfigurations from "@/components/fleet/FleetConfigurations.vue";
import FleetSettings from "@/components/fleet/FleetSettings.vue";
import FleetAudit from "@/components/fleet/FleetAudit.vue";
import { fleetLocation, resolveFleetTab, type FleetTab } from "@/components/fleet/fleetRoute";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();

const createTarget = ref<{ create: () => void } | null>(null);

const tabs = computed<{ name: FleetTab; label: I18nText; icon: IconName }[]>(() => [
  { name: "overview", label: t("fleet.tabs.overview"), icon: "dashboard" },
  { name: "fleets", label: t("fleet.tabs.fleets"), icon: "folder" },
  { name: "configurations", label: t("fleet.tabs.configurations"), icon: "tune" },
  { name: "settings", label: t("fleet.tabs.settings"), icon: "admin-panel-settings" },
  { name: "audit", label: t("fleet.tabs.audit"), icon: "receipt-long" },
]);

const activeTab = computed(() => resolveFleetTab(route.query));

const createLabel = computed<I18nText | null>(() => {
  switch (activeTab.value) {
    case "fleets":
      return t("fleet.fleets.newFleet");
    case "configurations":
      return t("fleet.configs.newConfig");
    default:
      return null;
  }
});

function onCreate() {
  createTarget.value?.create();
}

function go(tab: FleetTab, extra: Record<string, string> = {}) {
  router.replace(fleetLocation(tab, extra, route.query));
}
</script>
