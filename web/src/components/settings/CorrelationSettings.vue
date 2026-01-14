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
  <div class="tw:w-full tw:h-full">
    <div class="q-px-md q-py-md">
      <div class="general-page-title">
        {{ t("settings.correlation.title") }}
      </div>
      <div class="general-page-subtitle">
        {{ t("settings.correlation.subtitle") }}
      </div>
    </div>

    <div class="tw:px-4">
      <div class="flex justify-start">
        <q-tabs v-model="activeTab" inline-label dense @update:model-value="onTabChange">
          <q-tab
            name="identity"
            :label="t('settings.correlation.serviceIdentityTab')"
            no-caps
          />
          <q-tab
            name="services"
            :label="t('settings.correlation.discoveredServicesTab')"
            no-caps
          />
          <q-tab
            name="alert-correlation"
            :label="t('settings.correlation.alertCorrelationTab')"
            no-caps
          />
        </q-tabs>
      </div>

      <div class="tw:overflow-hidden">
        <ServiceIdentityConfig
          v-if="activeTab === 'identity'"
          :org-id="store.state.selectedOrganization.identifier"
          :config="store.state.organizationSettings?.deduplication_config"
          @saved="onCorrelationSettingsSaved"
        />

        <DiscoveredServices v-if="activeTab === 'services'" />

        <OrganizationDeduplicationSettings
          v-if="activeTab === 'alert-correlation'"
          :org-id="store.state.selectedOrganization.identifier"
          :config="store.state.organizationSettings?.deduplication_config"
          @saved="onCorrelationSettingsSaved"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import OrganizationDeduplicationSettings from "@/components/alerts/OrganizationDeduplicationSettings.vue";
import DiscoveredServices from "@/components/settings/DiscoveredServices.vue";
import ServiceIdentityConfig from "@/components/settings/ServiceIdentityConfig.vue";
import AppTabs from "@/components/common/AppTabs.vue";

export default defineComponent({
  name: "CorrelationSettings",
  components: {
    OrganizationDeduplicationSettings,
    DiscoveredServices,
    ServiceIdentityConfig,
    AppTabs,
  },
  setup() {
    const store = useStore();
    const q = useQuasar();
    const { t } = useI18n();
    const activeTab = ref("identity");

    const tabs = computed(() => [
      {
        label: t("settings.correlation.serviceIdentityTab"),
        value: "identity",
      },
      {
        label: t("settings.correlation.discoveredServicesTab"),
        value: "services",
      },
      {
        label: t("settings.correlation.alertCorrelationTab"),
        value: "alert-correlation",
      },
    ]);

    const onTabChange = (tab: string) => {
      activeTab.value = tab;
    };

    const onCorrelationSettingsSaved = () => {
      // Child components handle their own notifications and data refresh
      // No global store update needed as settings are managed via settings v2 API
    };

    return {
      store,
      activeTab,
      tabs,
      onTabChange,
      onCorrelationSettingsSaved,
      t,
    };
  },
});
</script>

<style scoped lang="scss">
.general-page-title {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.5rem;
}
.general-page-subtitle {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
}
</style>
