<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="q-ma-md aws-config-page">
    <div class="tw:mb-4">
      <h6 class="tw:text-lg tw:font-semibold tw:m-0 tw:mb-2 page-title">
        AWS Integrations
      </h6>
      <p class="tw:text-sm tw:m-0 tw:mb-4 page-description">
        Set up AWS monitoring in one click or configure individual services for granular control.
      </p>

      <q-tabs
        v-model="activeTab"
        dense
        class="aws-tabs"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab name="quick-setup" label="Quick Setup" data-test="aws-quick-setup-tab" />
        <q-tab name="individual-services" label="Individual Services" data-test="aws-individual-services-tab" />
      </q-tabs>
    </div>

    <q-separator class="tw:mb-6" />

    <q-tab-panels v-model="activeTab" animated>
      <q-tab-panel name="quick-setup" class="tw:p-0">
        <AWSQuickSetup />
      </q-tab-panel>

      <q-tab-panel name="individual-services" class="tw:p-0">
        <AWSIndividualServices :initialSearch="searchQuery" />
      </q-tab-panel>
    </q-tab-panels>

    <div class="tw:mt-8">
      <div class="tw:mb-3">
        <h6 class="tw:text-base tw:font-semibold tw:m-0 section-title">
          Manual Configuration
        </h6>
        <p class="tw:text-sm tw:m-0 section-description">
          Use these credentials for custom AWS integrations or manual setup.
        </p>
      </div>
      <CopyContent :content="content" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
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
    CopyContent,
    AWSQuickSetup,
    AWSIndividualServices,
  },
  setup(props) {
    const store = useStore();
    const route = useRoute();

    // If there's a search query, default to individual-services tab
    const activeTab = ref(props.searchQuery || route.query.search ? "individual-services" : "quick-setup");

    // Watch for search query changes in route
    watch(() => route.query.search, (newSearch) => {
      if (newSearch) {
        activeTab.value = "individual-services";
      }
    });

    // Watch for searchQuery prop changes
    watch(() => props.searchQuery, (newSearch) => {
      if (newSearch) {
        activeTab.value = "individual-services";
      }
    });
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

<style scoped lang="scss">
.aws-config-page {
  .body--light & {
    .page-description,
    .section-description {
      color: #666;
    }
  }

  .body--dark & {
    .page-description,
    .section-description {
      color: #b0b0b0;
    }
  }
}
</style>
