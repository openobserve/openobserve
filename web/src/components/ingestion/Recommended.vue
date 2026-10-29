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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <DataSourceSidebarLayout
    v-model="ingestTabType"
    :tabs="recommendedTabs"
    :splitter-width="270"
    searchable
    search-data-test="recommended-list-search-input"
    panel-data-test="data-sources-recommended-tabs"
    tab-data-test-prefix="ingestion-recommended-tab-"
  >
    <template #tabs="{ tabs, filter }">
      <!-- The rail only navigates, so a license-locked guide still lets the reader move to a free one. -->
      <FeatureLockExempt class="contents">
        <FirstSourcePickGroup
          v-if="pickTab && pickMatches(filter)"
          rail="recommended"
          :tab="pickTab"
          :rest-label="t('ingestion.firstSource.recommended')"
        />
        <ORouteTab
          v-for="tab in tabs.filter((tab) => tab.name !== pickTab?.name)"
          :key="tab.name"
          :title="pickTab ? tab.title || tab.name : undefined"
          :name="tab.name"
          :to="tab.to"
          :icon="tab.icon"
          :label="tab.label"
          :suffix-icon="lockedTabs.has(tab.name) ? 'lock' : undefined"
          :data-test="`ingestion-recommended-tab-${tab.name}`"
        />
      </FeatureLockExempt>
    </template>
    <div class="h-full w-full">
      <div class="bg-card-glass-bg h-full">
        <div class="h-full overflow-auto pt-1.5">
          <router-view :currOrgIdentifier="currOrgIdentifier" :currUserEmail="currentUserEmail">
          </router-view>
        </div>
      </div>
    </div>
  </DataSourceSidebarLayout>
</template>

<script lang="ts">
import DataSourceSidebarLayout from "@/components/ingestion/DataSourceSidebarLayout.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import FirstSourcePickGroup from "@/components/ingestion/FirstSourcePickGroup.vue";
// @ts-ignore
import { defineComponent, ref, computed, onBeforeMount, onUpdated } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";
import { firstSourceOption, readFirstSource } from "@/components/login/firstSourceOptions";
import { featureState } from "@/utils/featureGate";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";

export default defineComponent({
  name: "RecommendedPage",
  components: { DataSourceSidebarLayout, ORouteTab, FirstSourcePickGroup, FeatureLockExempt },
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(store.state.selectedOrganization.identifier);

    const ingestTabType = ref(
      resolveTab("recommended", router.currentRoute.value.name as string, "ingestFromKubernetes"),
    );

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "recommended") {
        router.push({
          name: "ingestFromKubernetes",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "recommended") {
        router.push({
          name: "ingestFromKubernetes",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const recommendedTabs = [
      {
        name: "ingestFromKubernetes",
        to: {
          name: "ingestFromKubernetes",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/common/kubernetes.svg"),
        label: raw("Kubernetes"),
        contentClass: "tab_content",
      },
      {
        name: "ingestFromWindows",
        to: {
          name: "ingestFromWindows",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/common/windows.svg"),
        label: raw("Windows"),
        contentClass: "tab_content",
      },
      {
        name: "ingestFromLinux",
        to: {
          name: "ingestFromLinux",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/common/linux.svg"),
        label: raw("Linux"),
        contentClass: "tab_content",
      },
      {
        name: "ingestFromMacOS",
        to: {
          name: "ingestFromMacOS",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/common/macos.png"),
        label: t("ingestion.macos"),
        contentClass: "tab_content",
      },
      {
        name: "ingestFromGpu",
        to: {
          name: "ingestFromGpu",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "memory",
        label: t("ingestion.gpu"),
        contentClass: "tab_content",
      },
      {
        name: "AWSConfig",
        to: {
          name: "AWSConfig",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/aws.svg"),
        label: raw("Amazon Web Services(AWS)"),
        contentClass: "tab_content",
      },
      {
        name: "GCPConfig",
        to: {
          name: "GCPConfig",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/gcp.svg"),
        label: raw("Google Cloud Platform(GCP)"),
        contentClass: "tab_content",
      },
      {
        name: "AzureConfig",
        to: {
          name: "AzureConfig",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/azure.png"),
        label: raw("Microsoft Azure"),
        contentClass: "tab_content",
      },
      {
        name: "ingestFromTraces",
        to: {
          name: "ingestFromTraces",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/otlp.svg"),
        label: t("ingestion.tracesotlp", { product: raw("OpenTelemetry") }),
        contentClass: "tab_content",
      },
      {
        name: "frontendMonitoring",
        to: {
          name: "frontendMonitoring",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/common/monitoring.svg"),
        label: t("ingestion.rum"),
        contentClass: "tab_content",
      },
    ];

    // The MCP endpoint is served by every edition, so this pointer to the IAM
    // setup page is unconditional.
    recommendedTabs.push({
      name: "recommendedMcp",
      to: {
        name: "recommendedMcp",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      },
      icon: "mcp",
      label: t("ingestion.mcp.shortName"),
      contentClass: "tab_content",
    });

    // Guides owned by a license feature: locked keeps the tab with a lock, hidden drops it.
    const LICENSED_TABS: Record<string, string> = {
      frontendMonitoring: "rum",
      recommendedMcp: "mcp",
    };
    const tabState = (name: string) =>
      LICENSED_TABS[name]
        ? featureState(store.state.zoConfig?.features, LICENSED_TABS[name])
        : "enabled";
    const licensedTabs = computed(() =>
      recommendedTabs.filter((tab) => tabState(tab.name) !== "hidden"),
    );
    const lockedTabs = computed(
      () => new Set(recommendedTabs.map((tab) => tab.name).filter((n) => tabState(n) === "locked")),
    );

    // A pick from another category links across to its guide.
    const pickTab = computed(() => {
      const option = firstSourceOption(
        readFirstSource(store.state.selectedOrganization.identifier),
      );
      if (!option?.route) return undefined;
      const listed = licensedTabs.value.find((tab) => tab.name === option.route);
      if (listed) return listed;
      return {
        name: option.route,
        to: {
          name: option.route,
          query: { org_identifier: store.state.selectedOrganization.identifier },
        },
        icon: option.logo ? "img:" + getImageURL(option.logo) : (option.icon ?? ""),
        label: t(option.labelKey),
        contentClass: "tab_content",
      };
    });

    const pickMatches = (filter: string) =>
      !filter || (pickTab.value?.label ?? "").toLowerCase().includes(filter.toLowerCase());

    return {
      t,
      store,
      router,
      config,
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      getImageURL,
      verifyOrganizationStatus,
      tabs,
      ingestTabType,
      recommendedTabs: licensedTabs,
      lockedTabs,
      pickTab,
      pickMatches,
    };
  },
});
</script>
