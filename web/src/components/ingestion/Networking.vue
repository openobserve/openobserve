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
  <DataSourceSidebarLayout
    v-model="ingestTabType"
    :tabs="networkingTabs"
    :splitter-width="270"
    searchable
    search-data-test="networking-list-search-input"
  >
    <div class="tw:w-full tw:h-full">
      <div class="card-container tw:h-full">
        <div class="tw:overflow-auto tw:h-full tw:pt-0.5">
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
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "NetworkingPage",
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

    const ingestTabType = ref(resolveTab("networking", router.currentRoute.value.name as string, "netflow"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "networking") {
        router.push({
          name: "netflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "networking") {
        router.push({
          name: "netflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const networkingTabs = [
      {
        name: "netflow",
        to: {
          name: "netflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/netflow.svg"),
        label: t("ingestion.netflow"),
        contentClass: "tab_content",
      },
    ];

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
      networkingTabs,
    };
  },
});
</script>

<style scoped lang="scss">
.ingestionPage {
  padding: 1.5rem 0 0;
  .head {
    padding-bottom: 1rem;
  }
}
</style>
