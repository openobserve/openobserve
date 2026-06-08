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
  <OSplitter
    v-model="categorySplitterModel"
    unit="px"
    class="tw:h-full"
  >
    <template v-slot:before>
      <div class="tw:w-full tw:h-full">
        <div class="tw:h-full tw:bg-surface-panel tw:border-r tw:border-border-default">
          <div class="tw:overflow-y-auto tw:h-full tw:pt-1.5">
            <OTabs
              v-model="selectedCategory"
              orientation="vertical"
            >
              <OTab
                v-for="cat in aiCategories"
                :key="cat.slug"
                :name="cat.slug"
                :label="cat.name"
                :data-test="`ai-integrations-category-${cat.slug}`"
              />
            </OTabs>
          </div>
        </div>
      </div>
    </template>

    <template v-slot:after>
      <OSplitter
        v-model="integrationSplitterModel"
        unit="px"
        class="tw:h-full"
      >
        <template v-slot:before>
          <div class="tw:w-full tw:h-full">
            <div class="tw:h-full tw:bg-surface-panel el-border-radius">
              <div class="tw:flex tw:flex-col tw:h-full">
                <div class="tw:pt-[0.625rem] tw:pl-1 tw:pr-4">
                  <OSearchInput
                    data-test="ai-integrations-search-input"
                    v-model="integrationFilter"
                    clearable
                    class="tw:w-full indexlist-search-input"
                    :placeholder="t('common.search')"
                  />
                </div>
                <div class="tw:overflow-y-auto tw:flex-1 tw:min-h-0">
                  <OTabs
                    v-model="selectedIntegration"
                    orientation="vertical"
                    @update:model-value="navigateToIntegration"
                  >
                    <OTab
                      v-for="integration in filteredIntegrations"
                      :key="integration.slug"
                      :name="integration.routeName"
                      :label="integration.name"
                      :data-test="`ai-integrations-item-${integration.slug}`"
                    />
                  </OTabs>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-slot:after>
          <div class="tw:w-full tw:h-full">
            <div class="card-container tw:h-full">
              <div class="tw:overflow-auto tw:h-full tw:pt-0.5">
                <router-view />
              </div>
            </div>
          </div>
        </template>
      </OSplitter>
    </template>
  </OSplitter>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { aiCategories } from "./ai/data";
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';
import OTab from '@/lib/navigation/Tabs/OTab.vue';
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';
import OSplitter from '@/lib/core/Splitter/OSplitter.vue';

export default defineComponent({
  name: "AIIntegrationsPage",
  components: { OTabs, OTab, OSearchInput, OSplitter },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();

    const selectedCategory = ref(aiCategories[0].slug);
    const selectedIntegration = ref(aiCategories[0].integrations[0].routeName);
    const integrationFilter = ref("");

    const currentIntegrations = computed(() => {
      const cat = aiCategories.find((c) => c.slug === selectedCategory.value);
      return cat?.integrations ?? [];
    });

    const filteredIntegrations = computed(() => {
      if (!integrationFilter.value) {
        return currentIntegrations.value;
      }
      return currentIntegrations.value.filter((integration) =>
        integration.name
          .toLowerCase()
          .includes(integrationFilter.value.toLowerCase()),
      );
    });

    const navigateToIntegration = (routeName: string) => {
      router.replace({
        name: routeName,
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const navigateToFirstIntegration = (categorySlug: string) => {
      const cat = aiCategories.find((c) => c.slug === categorySlug);
      if (cat && cat.integrations.length > 0) {
        const firstIntegration = cat.integrations[0];
        selectedIntegration.value = firstIntegration.routeName;
        navigateToIntegration(firstIntegration.routeName);
      }
    };

    watch(selectedCategory, (newCategory) => {
      integrationFilter.value = "";
      // Only navigate to first integration if the current route doesn't already
      // belong to this category (avoids overriding route sync in onBeforeMount)
      const cat = aiCategories.find((c) => c.slug === newCategory);
      const alreadyInCategory = cat?.integrations.some(
        (i) => i.routeName === (router.currentRoute.value.name as string),
      );
      if (!alreadyInCategory) {
        navigateToFirstIntegration(newCategory);
      }
    });

    onBeforeMount(() => {
      const routeName = router.currentRoute.value.name as string;
      if (routeName === "ai-integrations") {
        navigateToFirstIntegration(aiCategories[0].slug);
      } else {
        // Sync selectedCategory and selectedIntegration from current route
        for (const cat of aiCategories) {
          const matchingIntegration = cat.integrations.find(
            (i) => i.routeName === routeName,
          );
          if (matchingIntegration) {
            selectedCategory.value = cat.slug;
            selectedIntegration.value = matchingIntegration.routeName;
            break;
          }
        }
      }
    });

    // Handle re-clicking the AI Integrations main tab while already on a child
    // route. The route config redirect ("" → first integration) resolves to the
    // same route the user is already on, so Vue Router cancels it as a duplicate
    // navigation and the <router-view> can go blank.
    watch(() => route.name, (newName) => {
      if (newName === "ai-integrations") {
        navigateToFirstIntegration(selectedCategory.value);
      }
    });

    return {
      t,
      store,
      aiCategories,
      selectedCategory,
      selectedIntegration,
      integrationFilter,
      filteredIntegrations,
      navigateToIntegration,
      categorySplitterModel: ref(200),
      integrationSplitterModel: ref(250),
    };
  },
});
</script>


