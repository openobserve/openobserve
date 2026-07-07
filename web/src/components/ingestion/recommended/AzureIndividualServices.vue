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
        placeholder="Search Azure services..."
        clearable
        class="max-w-md"
        data-test="azure-integration-search"
      />
    </div>

    <div class="mb-6">
      <OTabs
        v-model="activeCategory"
        dense
        class="text-gray-400"
        data-test="azure-integration-category-tabs"
      >
        <OTab name="all" label="All Services" />
        <OTab name="logs" label="Logs" />
        <OTab name="compute" label="Compute" />
        <OTab name="storage" label="Storage" />
        <OTab name="security" label="Security" />
        <OTab name="networking" label="Networking" />
      </OTabs>
    </div>

    <div
      v-if="filteredIntegrations.length === 0"
      class="text-center py-12 text-[#666] dark:text-[#999]"
    >
      <OIcon name="search-off" class="mb-2" style="width: 3rem; height: 3rem;" />
      <div class="text-base">No integrations found matching your search</div>
    </div>

    <div class="flex gap-3" v-else>
      <div
        v-for="integration in filteredIntegrations"
        :key="integration.id"
        class="w-full col-sm-6 col-md-4 col-lg-3"
      >
        <AzureIntegrationTile :integration="integration" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue'
import { defineComponent, ref, computed } from "vue";
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
      searchQuery,
      activeCategory,
      filteredIntegrations,
    };
  },
});
</script>
