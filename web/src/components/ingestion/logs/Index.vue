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
              name="curl"
              data-test="ingestion-logs-tab-curl"
              :to="{
                name: 'curl',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              icon="data-object"
              :label="t('ingestion.curl')"
            />
            <ORouteTab
              name="filebeat"
              data-test="ingestion-logs-tab-filebeat"
              :to="{
                name: 'filebeat',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/filebeat.png')"
              :label="t('ingestion.filebeat')"
            />
            <ORouteTab
              name="fluentbit"
              data-test="ingestion-logs-tab-fluentbit"
              :to="{
                name: 'fluentbit',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/fluentbit_icon.png')"
              :label="t('ingestion.fluentbit')"
            />
            <ORouteTab
              name="fluentd"
              data-test="ingestion-logs-tab-fluentd"
              :to="{
                name: 'fluentd',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/fluentd_icon.svg')"
              :label="t('ingestion.fluentd')"
            />
            <ORouteTab
              name="vector"
              :to="{
                name: 'vector',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/vector.png')"
              :label="t('ingestion.vector')"
            />
            <ORouteTab
              name="ingestLogsFromOtel"
              :to="{
                name: 'ingestLogsFromOtel',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/otlp.svg')"
              :label="t('ingestion.otelCollector')"
            />
            <ORouteTab
              name="logstash"
              :to="{
                name: 'logstash',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/logstash.svg')"
              :label="t('ingestion.logstash')"
            />
            <ORouteTab
              name="syslogNg"
              :to="{
                name: 'syslogNg',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              icon="plagiarism"
              :label="t('ingestion.syslogNg')"
            />
            <ORouteTab
              name="loongcollector"
              data-test="ingestion-logs-tab-loongcollector"
              :to="{
                name: 'loongcollector',
                query: {
                  org_identifier: store.state.selectedOrganization.identifier,
                },
              }"
              :icon="'img:' + getImageURL('images/ingestion/loongcollector.svg')"
              :label="t('ingestion.loongCollector')"
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
import { defineComponent, ref, onBeforeMount, computed, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import config from "../../../aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "IngestLogs",
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
    const rowData: any = ref({});
    const confirmUpdate = ref<boolean>(false);
    const ingestiontabs = ref(resolveTab("ingestLogs", router.currentRoute.value.name as string, "curl"));
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );
    const ingestRoutes = [
      "curl",
      "fluentbit",
      "fluentd",
      "vector",
      "syslogNg",
      "loongcollector",
    ];

    onBeforeMount(() => {
      if (ingestRoutes.includes(router.currentRoute.value.name)) {
        router.push({
          name: router.currentRoute.value.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
      if (router.currentRoute.value.name === "ingestLogs") {
        router.push({
          name: "curl",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });
    onUpdated(() => {
      if (router.currentRoute.value.name === "ingestLogs") {
        router.push({
          name: "curl",
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

    const showCloudIngestionOptions = computed(() => {
      return config.isCloud === "true";
    });

    return {
      t,
      store,
      router,
      config,
      rowData,
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      copyToClipboardFn,
      showUpdateDialogFn,
      confirmUpdate,
      getImageURL,
      verifyOrganizationStatus,
      ingestiontabs,
      showCloudIngestionOptions,
      ingestRoutes,
    };
  },
});
</script>

