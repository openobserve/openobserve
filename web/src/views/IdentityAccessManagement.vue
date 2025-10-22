<template>
  <q-page data-test="iam-page" class="q-pa-none" style="min-height: inherit">
    <q-splitter
      v-model="splitterModel"
      unit="px"
      :limits="[0, 300]"
      class="tw-overflow-hidden logs-splitter-smooth"
    >
      <template v-slot:before>
        <div class="tw-w-full tw-h-full tw-px-[0.625rem] tw-pb-[0.625rem]">
        <div v-if="showSidebar" class="iam-tabs spitter-container card-container o2-container-navbarheight" style="height: calc(100vh - 50px);">
          <route-tabs
            ref="iamRouteTabsRef"
            dataTest="iam-tabs"
            :tabs="tabs"
            :activeTab="activeTab"
            @update:activeTab="updateActiveTab"
          />
          </div>
          <q-btn
              data-test="iam-tabs-collapse-btn"
              icon="drag_indicator"
              :title="showSidebar ? 'Collapse Fields' : 'Open Fields'"
              dense
              flat
              :class="[
                'splitter-section-collapse-btn',
                showSidebar
                  ? 'splitter-section-collapse-btn--visible'
                  : 'splitter-section-collapse-btn--hidden',
              ]"
              
              @click="collapseSidebar"
            />
        </div>
      </template>
      <template v-slot:after>
        <div class="tw-w-full tw-h-full tw-pr-[0.625rem] tw-pb-[0.625rem]">
          <div class="o2-container-navbarheight">
            <RouterView />
          </div>
        </div>
      </template>
    </q-splitter>
  </q-page>
</template>

<script setup lang="ts">
import RouteTabs from "@/components/RouteTabs.vue";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useRouter } from "vue-router";
import { nextTick } from "vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";

const store = useStore();
const { t } = useI18n();

const router = useRouter();

const activeTab = ref("users");

const iamRouteTabsRef: any = ref(null);

const { isMetaOrg } = useIsMetaOrg();

const splitterModel = ref(220);
const lastSplitterPosition = ref(splitterModel.value);
const showSidebar = ref(true);

const collapseSidebar = () => {
  if (showSidebar.value) lastSplitterPosition.value = splitterModel.value;
  showSidebar.value = !showSidebar.value;
  splitterModel.value = showSidebar.value ? lastSplitterPosition.value : 0;
};

const tabs = ref([
  {
    dataTest: "iam-users-tab",
    name: "users",
    to: {
      name: "users",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.basicUsers"),
    class: "tab_content",
  },
  {
    dataTest: "iam-service-accounts-tab",
    name: "serviceAccounts",
    to: {
      name: "serviceAccounts",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.serviceAccounts"),
    class: "tab_content",
  },
  {
    dataTest: "iam-groups-tab",
    name: "groups",
    to: {
      name: "groups",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.groups"),
    class: "tab_content",
  },
  {
    dataTest: "iam-roles-tab",
    name: "roles",
    to: {
      name: "roles",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.roles"),
    class: "tab_content",
  },
  {
    dataTest: "iam-quota-tab",
    name: "quota",
    to: {
      name: "quota",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.quota"),
    class: "tab_content",
  },
  {
    dataTest: "iam-organizations-tab",
    name: "organizations",
    to: {
      name: "organizations",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.organizations"),
    class: "tab_content",
  },
]);

watch(
  () => router.currentRoute.value.name,
  async (value) => {
    if (!value) return;
    await nextTick();
    if (value === "iam") {
      router.push({
        name: activeTab.value,
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    }
    //this condition is added to avoid the unnecessarily showing the quota tab when the user is not in the meta org and trying to access the quota tab
    //this is fallback to users tab when the user is not in the meta org and trying to access the quota tab
    if(value == "quota" && !isMetaOrg.value){
      router.push({
        name: "users",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    }
  },
  {
    immediate: true,
  }
);
watch(
  () => store.state.zoConfig,
  () => {
    setTabs();
  },
  {
    immediate: true,
  }
);

function setTabs() {
  const cloud = ["users", "organizations"];

  const rbac = ["groups", "roles"];

  const os = ["users", "serviceAccounts", "organizations"];


  const isEnterprise =
    config.isEnterprise == "true" || config.isCloud == "true";

  if (isEnterprise) {
  //for cloud version we dont want service accounts and for enterprise version we need service accounts 
  //so it will be available for entrerprise version
    if(config.isCloud == "false"){
      cloud.push("serviceAccounts")
    }
    let filteredTabs = tabs.value.filter((tab) => cloud.includes(tab.name));

    if (store.state.zoConfig.rbac_enabled) {
      if(isMetaOrg.value){
        rbac.push("quota")
      }
      filteredTabs = [
        ...filteredTabs,
        ...tabs.value.filter((tab) => rbac.includes(tab.name)),
      ];

    }

    tabs.value = filteredTabs;
  } else {
    tabs.value = tabs.value.filter((tab) => os.includes(tab.name));
  }
}

const updateActiveTab = (tab: string) => {
  if (tab) activeTab.value = tab;
  else {
    const value = router.currentRoute.value.name;

    if (!iamRouteTabsRef.value) return;

    if (value === "editGroup" || value === "groups") {
      iamRouteTabsRef.value.setActiveTab("groups");
    }

    if (value === "editRole" || value === "roles") {
      iamRouteTabsRef.value.setActiveTab("roles");
    }
  }
};
</script>

<style scoped lang="scss">
:deep(.q-splitter__before) {
  overflow: visible;
}
</style>
