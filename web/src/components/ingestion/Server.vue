<!-- Copyright 2025 OpenObserve Inc.

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
  <q-splitter
    v-model="splitterModel"
    unit="px"
  >
    <template v-slot:before>
      <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
        <div class="card-container tw:h-[calc(100vh-140px)] el-border-radius">
          <div class="tw:overflow-hidden tw:h-full">
            <q-input
              data-test="server-list-search-input"
              v-model="tabsFilter"
              borderless
              dense
              clearable
              class="tw:px-[0.625rem] tw:pt-[0.625rem] indexlist-search-input"
              :placeholder="t('common.search')"
            >
              <template #prepend>
                <q-icon name="search" class="cursor-pointer" />
              </template>
            </q-input>
            <q-tabs
              v-model="ingestTabType"
              indicator-color="transparent"
              inline-label
              vertical
              class="data-sources-database-tabs item-left"
            >
              <template v-for="(tab, index) in filteredList" :key="tab.name">
                <q-route-tab
                  :title="tab.name"
                  :default="index === 0"
                  :name="tab.name"
                  :to="tab.to"
                  :icon="tab.icon"
                  :label="tab.label"
                  content-class="tab_content"
                />
              </template>
            </q-tabs>
          </div>
        </div>
      </div>
    </template>

    <template v-slot:after>
      <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
        <div class=" card-container tw:h-[calc(100vh-140px)]">
          <div class="tw:overflow-auto tw:h-full">
            <router-view
              :title="tabs"
              :currOrgIdentifier="currOrgIdentifier"
              :currUserEmail="currentUserEmail"
            >
            </router-view>
          </div>
        </div>
      </div>
    </template>
  </q-splitter>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onUpdated, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard, useQuasar } from "quasar";
import config from "@/aws-exports";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";

export default defineComponent({
  name: "ServerPage",
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );

    const tabsFilter = ref("");

    const ingestTabType = ref("nginx");

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "servers") {
        router.push({
          name: "nginx",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "servers") {
        router.push({
          name: "nginx",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const serverTabs = [
      {
        name: "nginx",
        to: {
          name: "nginx",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/nginx.svg"),
        label: t("ingestion.nginx"),
        contentClass: "tab_content",
      },
      // {
      //   name: "apache",
      //   to: {
      //     name: "apache",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/apache.svg"),
      //   label: t("ingestion.apache"),
      //   contentClass: "tab_content",
      // },
      {
        name: "iis",
        to: {
          name: "iis",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/microsoft-iis.svg"),
        label: t("ingestion.iis"),
        contentClass: "tab_content",
      },
    ];

    let filteredTabs = [];
    // create computed property to filter tabs
    const filteredList = computed(() => {
      if (!tabsFilter.value) {
        return serverTabs;
      }
      filteredTabs = serverTabs.filter((tab) => {
        return tab.label.toLowerCase().includes(tabsFilter.value.toLowerCase());
      });

      return filteredTabs;
    });

    return {
      t,
      store,
      router,
      config,
      splitterModel: ref(270),
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      getImageURL,
      verifyOrganizationStatus,
      tabs,
      ingestTabType,
      tabsFilter,
      filteredList,
    };
  },
});
</script>

<style scoped lang="scss">
.data-sources-database-tabs {
  :deep(.q-tab) {
    min-height: 36px;
  }
}
.ingestionPage {
  padding: 1.5rem 0 0;
  .head {
    padding-bottom: 1rem;
  }
}
</style>
