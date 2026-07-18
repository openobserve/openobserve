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
    panel-data-test="data-sources-recommended-tabs"
    tab-data-test-prefix="ingestion-recommended-tab-"
  >
    <div class="w-full h-full">
      <div class="card-container h-full">
        <div class="overflow-auto h-full pt-1.5">
          <router-view
            :title="tabs"
            :currOrgIdentifier="currOrgIdentifier"
            :currUserEmail="currentUserEmail"
          >
          </router-view>
        </div>
      </div>
    </div>
  </DataSourceSidebarLayout>
</template>

<script lang="ts">
import DataSourceSidebarLayout from '@/components/ingestion/DataSourceSidebarLayout.vue'
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "RecommendedPage",
  components: { DataSourceSidebarLayout },
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );

    const ingestTabType = ref(resolveTab("recommended", router.currentRoute.value.name as string, "ingestFromKubernetes"));

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
        label: t("ingestion.kubernetes"),
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
        label: t("ingestion.windows"),
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
        label: t("ingestion.linux"),
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
        label: t("ingestion.awsconfig"),
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
        label: t("ingestion.gcpconfig"),
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
        label: t("ingestion.azure"),
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
        label: t("ingestion.tracesotlp"),
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

    // MCP is an AI feature (endpoint requires O2_AI_ENABLED); available on
    // enterprise and cloud, and only when ai_enabled is on at runtime.
    if (
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store.state.zoConfig.ai_enabled
    ) {
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
    }

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
      recommendedTabs,
    };
  },
});
</script>

