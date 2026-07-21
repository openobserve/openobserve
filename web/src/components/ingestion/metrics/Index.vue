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
    v-model="ingestiontabs"
    :splitter-width="250"
  >
    <template #tabs>
            <ORouteTab
              name="prometheus"
              data-test="ingestion-metrics-tab-prometheus"
              :to="{
                name: 'prometheus',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/prometheus.svg')"
              label="Prometheus"
            />
            <ORouteTab
              name="vmagent"
              data-test="ingestion-metrics-tab-vmagent"
              :to="{
                name: 'vmagent',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/vmagent.svg')"
              label="vmagent"
            />
            <ORouteTab
              name="nightingale"
              data-test="ingestion-metrics-tab-nightingale"
              :to="{
                name: 'nightingale',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/nightingale.svg')"
              label="Nightingale"
            />
            <ORouteTab
              name="otelCollector"
              :to="{
                name: 'otelCollector',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/otlp.svg')"
              label="OTEL Collector"
            />
            <ORouteTab
              name="telegraf"
              :to="{
                name: 'telegraf',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/telegraf.png')"
              label="Telegraf"
            />
            <ORouteTab
              name="cloudwatchMetrics"
              :to="{
                name: 'cloudwatchMetrics',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/cloud_watch.svg')"
              label="AWS CloudWatch Metrics"
            />
    </template>

      <div class="w-full h-full">
        <div class="bg-card-glass-bg h-full overflow-y-auto pt-0.5">
          <router-view
            :title="ingestiontabs"
            :currOrgIdentifier="currOrgIdentifier"
            :currUserEmail="currentUserEmail"
            @copy-to-clipboard-fn="copyToClipboardFn"
          >
          </router-view>
        </div>
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
// import { config } from "../constants/config";
import config from "../../../aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "IngestMetrics",
  components: {
    ORouteTab, DataSourceSidebarLayout,},
  data() {
    return {};
  },
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
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const ingestiontabs = ref(
      resolveTab("ingestMetrics", router.currentRoute.value.name as string, "prometheus")
    );

    onBeforeMount(() => {
      const ingestRoutes = [
        "prometheus",
        "vmagent",
        "nightingale",
        "otelCollector",
        "telegraf",
        "cloudwatchMetrics",
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
      if (router.currentRoute.value.name === "ingestMetrics") {
        router.push({
          name: "prometheus",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "ingestMetrics") {
        router.push({
          name: "prometheus",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
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

    const showUpdateDialogFn = () => {
      confirmUpdate.value = true;
    };

    return {
      t,
      store,
      router,
      config,
      rowData,
      currentUserEmail: store.state.userInfo.email,
      copyToClipboardFn,
      showUpdateDialogFn,
      confirmUpdate,
      ingestiontabs,
      getImageURL,
      verifyOrganizationStatus,
    };
  },
});
</script>

