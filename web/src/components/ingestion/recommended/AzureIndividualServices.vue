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
  <div class="w-full">
    <div class="mb-4">
      <OSearchInput
        v-model="searchQuery"
        :placeholder="t('ingestion.azureSetup.searchPlaceholder')"
        clearable
        class="max-w-md"
        data-test="azure-integration-search"
      />
    </div>

    <div class="mb-6">
      <OTabs
        v-model="activeCategory"
        dense
        data-test="azure-integration-category-tabs"
      >
        <OTab name="all" :label="t('ingestion.azureSetup.categoryAll')" />
        <OTab name="logs" :label="t('ingestion.azureSetup.categoryLogs')" />
        <OTab name="compute" :label="t('ingestion.azureSetup.categoryCompute')" />
        <OTab name="storage" :label="t('ingestion.azureSetup.categoryStorage')" />
        <OTab name="security" :label="t('ingestion.azureSetup.categorySecurity')" />
        <OTab name="networking" :label="t('ingestion.azureSetup.categoryNetworking')" />
      </OTabs>
    </div>

    <div
      v-if="filteredIntegrations.length === 0"
      class="text-center py-12 text-text-secondary"
    >
      <OIcon name="search-off" class="mb-2 w-12 h-12" />
      <div class="text-base">{{ t("ingestion.azureSetup.noResults") }}</div>
    </div>

    <div
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      v-else
    >
      <AzureIntegrationTile
        v-for="integration in filteredIntegrations"
        :key="integration.id"
        :integration="integration"
      />
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue'
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { azureIntegrations } from "@/utils/azureIntegrations";
import AzureIntegrationTile from "./AzureIntegrationTile.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "AzureIndividualServices",
  components: {
    OTabs, OTab,
    AzureIntegrationTile,
    OSearchInput,
    OIcon,
},
  setup() {
    const { t } = useI18n();
    const searchQuery = ref("");
    const activeCategory = ref("all");

    const filteredIntegrations = computed(() => {
      let filtered = [...azureIntegrations];

      // Filter by search query
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        filtered = filtered.filter(
          (integration) =>
            integration.displayName.toLowerCase().includes(query) ||
            integration.description.toLowerCase().includes(query) ||
            integration.name.toLowerCase().includes(query)
        );
      }

      // Filter by category
      if (activeCategory.value !== "all") {
        filtered = filtered.filter(
          (integration) => integration.category === activeCategory.value
        );
      }

      // Sort by name
      filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));

      return filtered;
    });

    return {
      t,
      searchQuery,
      activeCategory,
      filteredIntegrations,
    };
  },
});
</script>
