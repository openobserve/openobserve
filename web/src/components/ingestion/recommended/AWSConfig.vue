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
  <div class="m-3 mt-1">
    <div class="mb-4">
      <div
        data-test="aws-config-page-title"
        class="text-text-heading m-0 mb-1.5 text-2xl leading-tight font-semibold"
      >
        {{ t("ingestion.awsSetup.title") }}
      </div>
      <div data-test="aws-config-page-description" class="text-text-secondary m-0 mb-4 text-sm">
        {{ t("ingestion.awsSetup.description") }}
      </div>

      <OTabs v-model="activeTab" dense class="aws-tabs" align="left">
        <OTab
          name="quick-setup"
          :label="t('ingestion.awsSetup.quickSetup')"
          data-test="aws-quick-setup-tab"
        />
        <OTab
          name="individual-services"
          :label="t('ingestion.awsSetup.individualServices')"
          data-test="aws-individual-services-tab"
        />
      </OTabs>
    </div>

    <OSeparator class="mb-6" />

    <OTabPanels v-model="activeTab" animated>
      <OTabPanel name="quick-setup">
        <AWSQuickSetup />
      </OTabPanel>

      <OTabPanel name="individual-services">
        <AWSIndividualServices :initialSearch="searchQuery" />
      </OTabPanel>
    </OTabPanels>

    <div class="mt-8">
      <div class="mb-3">
        <div class="text-text-heading m-0 text-base font-semibold">
          {{ t("ingestion.awsSetup.manualTitle") }}
        </div>
        <div class="text-text-secondary m-0 text-sm">
          {{ t("ingestion.awsSetup.manualDescription") }}
        </div>
      </div>
      <CopyContent :content="content" />
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import AWSQuickSetup from "./AWSQuickSetup.vue";
import AWSIndividualServices from "./AWSIndividualServices.vue";

export default defineComponent({
  name: "AWSConfig",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
    searchQuery: {
      type: String,
      default: "",
    },
  },
  components: {
    OSeparator,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    CopyContent,
    AWSQuickSetup,
    AWSIndividualServices,
  },
  setup(props) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();

    // If there's a search query, default to individual-services tab
    const activeTab = ref(
      props.searchQuery || route.query.search ? "individual-services" : "quick-setup",
    );

    // Watch for search query changes in route
    watch(
      () => route.query.search,
      (newSearch) => {
        if (newSearch) {
          activeTab.value = "individual-services";
        }
      },
    );

    // Watch for searchQuery prop changes
    watch(
      () => props.searchQuery,
      (newSearch) => {
        if (newSearch) {
          activeTab.value = "individual-services";
        }
      },
    );
    // TODO OK: Create interface for ENDPOINT
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });

    try {
      const ingestionURL = getIngestionURL();
      endpoint.value = getEndPoint(ingestionURL);
    } catch (e) {
      console.error("Error while creating end point", e);
    }

    const content = `HTTP Endpoint: ${endpoint.value.url}/aws/${store.state.selectedOrganization.identifier}/default/_kinesis_firehose
Access Key: [BASIC_PASSCODE]`;

    return {
      t,
      store,
      config,
      endpoint,
      content,
      getImageURL,
      activeTab,
    };
  },
});
</script>
