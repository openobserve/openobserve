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
    :tabs="securityTabs"
    :splitter-width="270"
    searchable
    search-data-test="security-list-search-input"
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
  name: "SecurityPage",
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

    const ingestTabType = ref(resolveTab("security", router.currentRoute.value.name as string, "falco"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "security") {
        router.push({
          name: "falco",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "security") {
        router.push({
          name: "falco",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const securityTabs = [
      {
        name: "falco",
        to: {
          name: "falco",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/falco.png"),
        label: t("ingestion.falco"),
        contentClass: "tab_content",
      },
      {
        name: "osquery",
        to: {
          name: "osquery",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/os-query.png"),
        label: t("ingestion.osquery"),
        contentClass: "tab_content",
      },
      {
        name: "okta",
        to: {
          name: "okta",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/okta.png"),
        label: t("ingestion.okta"),
        contentClass: "tab_content",
      },
      {
        name: "jumpcloud",
        to: {
          name: "jumpcloud",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/jumpcloud.svg"),
        label: t("ingestion.jumpcloud"),
        contentClass: "tab_content",
      },
      {
        name: "openvpn",
        to: {
          name: "openvpn",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/openvpn.png"),
        label: t("ingestion.openvpn"),
        contentClass: "tab_content",
      },
      {
        name: "office365",
        to: {
          name: "office365",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/office-365.png"),
        label: t("ingestion.office365"),
        contentClass: "tab_content",
      },
      {
        name: "google-workspace",
        to: {
          name: "google-workspace",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/google-workspace.png"),
        label: t("ingestion.gworkspace"),
        contentClass: "tab_content",
      }
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
      securityTabs,
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
