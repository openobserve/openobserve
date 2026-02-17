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
  <div class="azure-integration-grid">
    <div class="tw:mb-4">
      <q-input
        v-model="searchQuery"
        placeholder="Search Azure services..."
        dense
        outlined
        clearable
        class="tw:max-w-md"
        data-test="azure-integration-search"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <div class="tw:mb-6">
      <q-tabs
        v-model="activeCategory"
        dense
        inline-label
        class="text-grey-7"
        active-color="primary"
        indicator-color="primary"
        data-test="azure-integration-category-tabs"
      >
        <q-tab name="all" label="All Services" />
        <q-tab name="compute" label="Compute" />
        <q-tab name="storage" label="Storage" />
        <q-tab name="security" label="Security" />
        <q-tab name="networking" label="Networking" />
      </q-tabs>
    </div>

    <div
      v-if="filteredIntegrations.length === 0"
      class="tw:text-center tw:py-12 empty-state"
    >
      <q-icon name="search_off" size="3rem" class="tw:mb-2" />
      <div class="tw:text-base">No integrations found matching your search</div>
    </div>

    <div class="row q-col-gutter-md" v-else>
      <div
        v-for="integration in filteredIntegrations"
        :key="integration.id"
        class="col-12 col-sm-6 col-md-4 col-lg-3"
      >
        <AzureIntegrationTile :integration="integration" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { azureIntegrations } from "@/utils/azureIntegrations";
import AzureIntegrationTile from "./AzureIntegrationTile.vue";

export default defineComponent({
  name: "AzureIndividualServices",
  components: {
    AzureIntegrationTile,
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

<style scoped lang="scss">
.azure-integration-grid {
  width: 100%;

  .empty-state {
    .body--light & {
      color: #666;
    }

    .body--dark & {
      color: #999;
    }
  }
}
</style>
