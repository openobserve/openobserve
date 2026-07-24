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
  <DataSourceSidebarLayout v-model="ingestiontabs" :splitter-width="200">
    <template #tabs>
      <ORouteTab
        name="openTelemetry"
        :to="{
          name: 'tracesOTLP',
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }"
        :icon="'img:' + getImageURL('images/ingestion/otlp.svg')"
        :label="t('ingestion.openTelemetryTabLabel')"
      />
      <ORouteTab
        name="ingestTracesFromOtel"
        :to="{
          name: 'ingestTracesFromOtel',
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }"
        :icon="'img:' + getImageURL('images/ingestion/otlp.svg')"
        :label="t('ingestion.otelCollectorTabLabel')"
      />
    </template>

    <div class="h-full w-full">
      <div class="bg-card-glass-bg h-full overflow-y-auto pt-0.5">
        <router-view
          :title="t('ingestion.metricsLabel')"
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
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import DataSourceSidebarLayout from "@/components/ingestion/DataSourceSidebarLayout.vue";
// @ts-ignore
import { defineComponent, ref, onMounted, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
// import { config } from "../constants/config";
import config from "../../../aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";

export default defineComponent({
  name: "IngestTraces",
  components: {
    ORouteTab,
    DataSourceSidebarLayout,
  },
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
    const routeToTracesTab: Record<string, string> = {
      tracesOTLP: "openTelemetry",
      ingestTracesFromOtel: "ingestTracesFromOtel",
    };
    const ingestiontabs = ref(
      routeToTracesTab[router.currentRoute.value.name as string] ?? "openTelemetry",
    );

    onMounted(() => {
      const ingestRoutes = ["tracesOTLP"];
      if (ingestRoutes.includes(router.currentRoute.value.name)) {
        router.push({
          name: router.currentRoute.value.name,
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
      if (router.currentRoute.value.name === "ingestTraces") {
        router.push({
          name: "tracesOTLP",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "ingestTraces") {
        router.push({
          name: "tracesOTLP",
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
