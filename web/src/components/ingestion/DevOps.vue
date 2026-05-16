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
  <q-splitter
    v-model="splitterModel"
    unit="px"
  >
    <template v-slot:before>
      <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
        <div class="card-container tw:h-[calc(100vh-140px)] el-border-radius">
          <div class="tw:overflow-hidden tw:h-full">
            <q-input
              data-test="devops-list-search-input"
              v-model="tabsFilter"
              borderless
              dense
              clearable
              class="tw:px-[0.625rem] tw:pt-[0.625rem] indexlist-search-input"
              :placeholder="t('common.search')"
            >
              <template #prepend>
                <OIcon name="search" size="sm" class="cursor-pointer" />
              </template>
            </q-input>
            <OTabs
              v-model="ingestTabType"
              orientation="vertical"
              class="data-sources-database-tabs item-left"
            >
              <template v-for="(tab, index) in filteredList" :key="tab.name">
                <ORouteTab
                  :title="tab.name"
                  :default="index === 0"
                  :name="tab.name"
                  :to="tab.to"
                  :icon="tab.icon"
                  :label="tab.label"
                />
              </template>
            </OTabs>
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
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onUpdated, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard, useQuasar } from "quasar";
import config from "@/aws-exports";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "DevOpsPage",
  components: { OTabs, ORouteTab,
    OIcon,
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
    const q = useQuasar();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );

    const tabsFilter = ref("");

    const ingestTabType = ref(resolveTab("devops", router.currentRoute.value.name as string, "jenkins"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "devops") {
        router.push({
          name: "jenkins",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "devops") {
        router.push({
          name: "jenkins",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const devopsTabs = [
      {
        name: "jenkins",
        to: {
          name: "jenkins",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/jenkins.svg"),
        label: t("ingestion.jenkins"),
        contentClass: "tab_content",
      },
      {
        name: "ansible",
        to: {
          name: "ansible",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/ansible.svg"),
        label: t("ingestion.ansible"),
        contentClass: "tab_content",
      },
      {
        name: "terraform",
        to: {
          name: "terraform",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/terraform.svg"),
        label: t("ingestion.terraform"),
        contentClass: "tab_content",
      },
      {
        name: "github-actions",
        to: {
          name: "github-actions",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/github-actions.svg"),
        label: t("ingestion.gactions"),
        contentClass: "tab_content",
      }
    ];

    let filteredTabs = [];
    // create computed property to filter tabs
    const filteredList = computed(() => {
      if (!tabsFilter.value) {
        return devopsTabs;
      }
      filteredTabs = devopsTabs.filter((tab) => {
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
  :deep(.o-tab) {
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
