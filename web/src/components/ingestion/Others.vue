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
    :tabs="othersTabs"
    :splitter-width="270"
    searchable
    search-data-test="others-list-search-input"
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
  name: "OthersPage",
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

    const ingestTabType = ref(resolveTab("others", router.currentRoute.value.name as string, "airflow"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "others") {
        router.push({
          name: "airflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "others") {
        router.push({
          name: "airflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const othersTabs = [
      {
        name: "airflow",
        to: {
          name: "airflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/airflow.svg"),
        label: t("ingestion.airflow"),
        contentClass: "tab_content",
      },
      {
        name: "cribl",
        to: {
          name: "cribl",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/cribl.webp"),
        label: t("ingestion.cribl"),
        contentClass: "tab_content",
      },
      {
        name: "vercel",
        to: {
          name: "vercel",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/vercel.svg"),
        label: t("ingestion.vercel"),
        contentClass: "tab_content",
      },
      {
        name: "heroku",
        to: {
          name: "heroku",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/heroku.svg"),
        label: t("ingestion.heroku"),
        contentClass: "tab_content",
      },
      // {
      //   name: "airbyte",
      //   to: {
      //     name: "airbyte",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/airbyte.svg"),
      //   label: "Airbyte",
      //   contentClass: "tab_content",
      // },
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
      othersTabs,
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
