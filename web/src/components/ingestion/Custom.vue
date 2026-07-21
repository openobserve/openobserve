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
    v-model="tabs"
    :splitter-width="250"
  >
    <template #tabs>
            <ORouteTab
              name="ingestLogs"
              data-test="ingestion-custom-tab-ingestLogs"
              :to="{
                name: 'ingestLogs',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('ingestion.logsLabel')"
            />
            <ORouteTab
              name="ingestMetrics"
              data-test="ingestion-custom-tab-ingestMetrics"
              :to="{
                name: 'ingestMetrics',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('ingestion.metricsLabel')"
            />
            <ORouteTab
              name="ingestTraces"
              data-test="ingestion-custom-tab-ingestTraces"
              :to="{
                name: 'ingestTraces',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :label="t('ingestion.tracesLabel')"
            />
    </template>

      <div class="overflow-hidden h-full">
        <router-view
          :title="tabs"
          :currOrgIdentifier="currOrgIdentifier"
          :currUserEmail="currentUserEmail"
          @copy-to-clipboard-fn="copyToClipboardFn"
        >
        </router-view>
      </div>
  </DataSourceSidebarLayout>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import DataSourceSidebarLayout from '@/components/ingestion/DataSourceSidebarLayout.vue'
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "CustomPage",
  components: { ORouteTab, DataSourceSidebarLayout },
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
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier
    );
    const metricRoutes = [
      "prometheus",
      "vmagent",
      "otelCollector",
      "telegraf",
      "cloudwatchMetrics",
    ];
    const traceRoutes = ["tracesOTLP", "ingestTracesFromOtel"];
    const rumRoutes = ["frontendMonitoring"];
    const logRoutes = [
      "curl", "fluentbit", "fluentd", "kinesisfirehose", "vector",
      "filebeat", "gcpLogs", "logstash", "syslogNg", "ingestLogsFromOtel",
    ];
    const tabs = ref(
      logRoutes.includes(router.currentRoute.value.name as string)
        ? "ingestLogs"
        : metricRoutes.includes(router.currentRoute.value.name as string)
          ? "ingestMetrics"
          : traceRoutes.includes(router.currentRoute.value.name as string)
            ? "ingestTraces"
            : "ingestLogs"
    );

    onBeforeMount(() => {
      // Parent container routes: navigating to these redirects to their first child.
      // Leaf child routes (tracesOTLP, ingestTracesFromOtel, logRoutes members, etc.)
      // are intentionally excluded here — they just set the active tab below.
      const ingestRoutes = [
        "ingestLogs",
        "ingestTraces",
        "ingestMetrics",
        "rumMonitoring",
      ];

      if (ingestRoutes.includes(router.currentRoute.value.name)) {
        router.push({
          name: router.currentRoute.value.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }

      if (logRoutes.includes(router.currentRoute.value.name)) {
        tabs.value = "ingestLogs";
      } else if (metricRoutes.includes(router.currentRoute.value.name)) {
        tabs.value = "ingestMetrics";
      } else if (traceRoutes.includes(router.currentRoute.value.name)) {
        tabs.value = "ingestTraces";
      } else if (ingestRoutes.includes(router.currentRoute.value.name)) {
        tabs.value = router.currentRoute.value.name;
      } else if (rumRoutes.includes(router.currentRoute.value.name)) {
        tabs.value = "rumMonitoring";
      } else if (router.currentRoute.value.name === "custom") {
        tabs.value = "ingestLogs";
        router.push({
          name: "curl",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "custom") {
        tabs.value = "ingestLogs";
        router.push({
          name: "curl",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    });

    const copyToClipboardFn = (content: any) => {
      copyToClipboard(content.innerText, {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      }).then((success: boolean) => {
        if (success) {
          segment.track("Button Click", {
            button: "Copy to Clipboard",
            ingestion: router.currentRoute.value.name,
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            page: "Ingestion",
          });
        }
      });
    };

    return {
      t,
      store,
      router,
      config,
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      getImageURL,
      tabs,
      copyToClipboardFn,
      rumRoutes,
      traceRoutes,
      metricRoutes,
    };
  },
});
</script>

