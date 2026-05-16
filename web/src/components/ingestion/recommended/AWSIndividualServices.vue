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
  <div class="aws-integration-grid">
    <div class="tw:mb-4">
      <OInput
        v-model="searchQuery"
        placeholder="Search AWS services..."
        clearable
        class="tw:max-w-md"
        data-test="aws-integration-search"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </OInput>
    </div>

    <div class="tw:mb-6">
      <OTabs
        v-model="activeCategory"
        dense
        class="text-grey-7"
        data-test="aws-integration-category-tabs"
      >
        <OTab name="all" label="All Services" />
        <OTab name="logs" label="Logs" />
        <OTab name="metrics" label="Metrics" />
        <OTab name="security" label="Security" />
        <OTab name="networking" label="Networking" />
      </OTabs>
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
        <AWSIntegrationTile :integration="integration" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import { defineComponent, ref, computed, watch } from "vue";
import { useRoute } from "vue-router";
import { awsIntegrations } from "@/utils/awsIntegrations";
import AWSIntegrationTile from "./AWSIntegrationTile.vue";

export default defineComponent({
  name: "AWSIndividualServices",
  components: {
    OTabs, OTab,
    AWSIntegrationTile,
    OInput,
  },
  props: {
    initialSearch: {
      type: String,
      default: "",
    },
  },
  setup(props) {
    const route = useRoute();
    const searchQuery = ref((route.query.search as string) || props.initialSearch || "");
    const activeCategory = ref("all");

    // Watch for changes in route query parameter
    watch(() => route.query.search, (newSearch) => {
      if (newSearch && typeof newSearch === 'string') {
        searchQuery.value = newSearch;
      } else if (newSearch === undefined) {
        // Clear search when query param is removed
        searchQuery.value = "";
      }
    });

    // Watch for changes in initialSearch prop
    watch(() => props.initialSearch, (newSearch) => {
      if (newSearch !== undefined) {
        searchQuery.value = newSearch;
      }
    });

    const filteredIntegrations = computed(() => {
      let filtered = [...awsIntegrations];

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
.aws-integration-grid {
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
