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
    :tabs="languagesTabs"
    :splitter-width="270"
    searchable
    search-data-test="language-list-search-input"
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
  name: "LanguagesPage",
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

    const ingestTabType = ref(resolveTab("languages", router.currentRoute.value.name as string, "python"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "languages") {
        router.push({
          name: "python",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "languages") {
        router.push({
          name: "python",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const languagesTabs = [
      {
        name: "python",
        to: {
          name: "python",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/python.svg"),
        label: "Python",
        contentClass: "tab_content",
      },
      {
        name: "dotnettracing",
        to: {
          name: "dotnettracing",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/dotnet.svg"),
        label: t("ingestion.dotnettracing"),
        contentClass: "tab_content",
      },
      {
        name: "dotnetlogs",
        to: {
          name: "dotnetlogs",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/dotnet.svg"),
        label: t("ingestion.dotnetlogs"),
        contentClass: "tab_content",
      },
      {
        name: "nodejs",
        to: {
          name: "nodejs",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/nodejs.svg"),
        label: t("ingestion.nodejs"),
        contentClass: "tab_content",
      },
      {
        name: "go",
        to: {
          name: "go",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/golang.svg"),
        label: t("ingestion.go"),
        contentClass: "tab_content",
      },
      // {
      //   name: "rust",
      //   to: {
      //     name: "rust",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/rust.svg"),
      //   label: t("ingestion.rust"),
      //   contentClass: "tab_content",
      // },
      // {
      //   name: "java",
      //   to: {
      //     name: "java",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/java.svg"),
      //   label: t("ingestion.java"),
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
      languagesTabs,
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
