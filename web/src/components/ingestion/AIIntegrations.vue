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
  <div class="tw:flex tw:h-[calc(100vh-var(--navbar-height)-100px)] tw:gap-0">
    <div class="tw:w-[200px] tw:pl-[0.625rem] tw:pb-[0.625rem] tw:flex tw:flex-col">
      <div class="card-container tw:flex-1 el-border-radius">
        <div class="tw:overflow-y-auto tw:h-[calc(100vh-var(--navbar-height)-100px)]">
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

    <div class="tw:w-[250px] tw:pb-[0.625rem] tw:flex tw:flex-col">
      <div class="card-container tw:flex-1 el-border-radius">
        <div class="tw:flex tw:flex-col tw:h-full">
          <q-input
            data-test="ai-integrations-search-input"
            v-model="integrationFilter"
            borderless
            dense
            clearable
            class="tw:px-[0.625rem] tw:pt-[0.625rem] indexlist-search-input"
            :placeholder="t('common.search')"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
          <div class="tw:overflow-y-auto tw:h-[calc(100vh-var(--navbar-height)-150px)]">
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

    <div class="tw:flex-1 tw:pr-[0.625rem] tw:pb-[0.625rem] tw:flex tw:flex-col">
      <div class="card-container tw:flex-1 el-border-radius">
        <div class="tw:flex tw:flex-col tw:h-full">
          <div class="tw:flex-1 tw:overflow-auto tw:min-h-0">
            <router-view />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { aiCategories } from "./ai/data";
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';
import OTab from '@/lib/navigation/Tabs/OTab.vue';

export default defineComponent({
  name: "AIIntegrationsPage",
  components: { OTabs, OTab },
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
      navigateToFirstIntegration(newCategory);
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
    };
  },
});
</script>


