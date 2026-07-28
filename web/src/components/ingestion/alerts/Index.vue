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

<!--
  Data Sources > Custom > Alerts.

  Sits alongside Logs / Metrics / Traces, but is deliberately not a stream
  ingestion path: alerts pushed here are correlated into incidents and never
  land in a stream. That is why this tab does not use the rich
  DataSourceSetupCard — its `detect` step counts rows on a stream, and there is
  no stream to count.
-->
<template>
  <DataSourceSidebarLayout v-model="ingestiontabs" :splitter-width="200">
    <template #tabs>
      <ORouteTab
        name="incidentWebhook"
        data-test="ingestion-alerts-tab-incidentWebhook"
        :to="{
          name: 'ingestAlertsWebhook',
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }"
        :label="t('ingestion.alertsWebhookLabel')"
      />
    </template>

    <div class="h-full w-full">
      <div class="bg-card-glass-bg h-full overflow-y-auto pt-0.5">
        <router-view
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
import config from "../../../aws-exports";
import segment from "@/services/segment_analytics";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "IngestAlerts",
  components: {
    ORouteTab,
    DataSourceSidebarLayout,
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
    const routeToAlertsTab: Record<string, string> = {
      ingestAlertsWebhook: "incidentWebhook",
    };
    const ingestiontabs = ref(
      routeToAlertsTab[router.currentRoute.value.name as string] ?? "incidentWebhook",
    );

    // The parent route has no page of its own — land on the first child.
    const redirectToFirstChild = () => {
      if (router.currentRoute.value.name === "ingestAlerts") {
        router.push({
          name: "ingestAlertsWebhook",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };

    onMounted(redirectToFirstChild);
    onUpdated(redirectToFirstChild);

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
      copyToClipboardFn,
      ingestiontabs,
      getImageURL,
    };
  },
});
</script>
