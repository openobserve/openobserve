<template>
  <div class="tw:rounded-md tw:p-0 tw:overflow-hidden tw:h-[calc(100vh-var(--navbar-height))]" data-test="iam-page">
    <OSplitter
      v-model="splitterModel"
      unit="px"
      :limits="[0, 300]"
      :horizontal="false"
      class="tw:overflow-hidden"
      style="height: 100%;"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem] tw:pt-1">
        <div v-if="showSidebar" class="iam-tabs spitter-container card-container" style="height: calc(100vh - var(--navbar-height) - 14px);">
          <route-tabs
            ref="iamRouteTabsRef"
            dataTest="iam-tabs"
            :tabs="tabs"
            :activeTab="activeTab"
            @update:activeTab="updateActiveTab"
          />
          </div>
        </div>
      </template>
      <template #separator>
          <OButton
            data-test="logs-search-field-list-collapse-btn"
            :title="showSidebar ? 'Collapse Fields' : 'Open Fields'"
            variant="sidebar-button"
            size="sidebar-button"
            :class="showSidebar ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
            @click="collapseSidebar"
          >
            <OIcon :name="showSidebar ? 'chevron-left' : 'chevron-right'" size="xs" />
          </OButton>
      </template>
      <template v-slot:after>
        <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem] tw:pt-1">
          <div class="tw:overflow-hidden tw:h-full">
            <RouterView />
          </div>
        </div>
      </template>
    </OSplitter>
  </div>
</template>

<script setup lang="ts">
import RouteTabs from "@/components/RouteTabs.vue";
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useRouter } from "vue-router";
import { nextTick } from "vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { resolveTab } from "@/utils/routeTabMaps";
import OButton from "@/lib/core/Button/OButton.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
const store = useStore();
const { t } = useI18n();

const router = useRouter();

const activeTab = ref(resolveTab("iam", router.currentRoute.value.name as string, "users"));

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

const allTabs = [
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
    icon: "person",
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
    icon: "manage-accounts",
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
    icon: "group",
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
    icon: "shield",
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
    icon: "speed",
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
    icon: "corporate-fare",
  },
  {
    dataTest: "iam-invitations-tab",
    name: "invitations",
    to: {
      name: "invitations",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    },
    label: t("iam.invitations"),
    class: "tab_content",
    icon: "mail",
  },
];

const tabs = ref(allTabs);

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
    if (value == "quota" && !isMetaOrg.value) {
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
  },
);
watch(
  () => store.state.zoConfig,
  () => {
    setTabs();
  },
  {
    immediate: true,
  },
);

function setTabs() {
  const cloud = ["users", "organizations"];

  const rbac = ["groups", "roles"];

  const os = ["users", "serviceAccounts", "organizations"];

  const isEnterprise =
    config.isEnterprise == "true" || config.isCloud == "true";

  // Filter service accounts based on config
  const serviceAccountEnabled = store.state.zoConfig.service_account_enabled ?? true;

  if (isEnterprise) {
    if (serviceAccountEnabled) {
      cloud.push("serviceAccounts");
    }

    if (config.isCloud == "true") {
      cloud.push("invitations");
    }

    let filteredTabs = allTabs.filter((tab) => cloud.includes(tab.name));

    if (store.state.zoConfig.rbac_enabled) {
      if (isMetaOrg.value) {
        rbac.push("quota");
      }
      filteredTabs = [
        ...filteredTabs,
        ...allTabs.filter((tab) => rbac.includes(tab.name)),
      ];
    }

    tabs.value = filteredTabs;
  } else {
    // Filter based on os array and service account config
    tabs.value = allTabs.filter((tab) => {
      if (tab.name === "serviceAccounts" && !serviceAccountEnabled) {
        return false;
      }
      return os.includes(tab.name);
    });
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

.splitter-icon-collapse {
  position: absolute !important;
  top: 0.25rem !important;
  left: 0 !important;
}

.splitter-icon-expand {
  position: absolute !important;
  top: 0.25rem !important;
  left: 0 !important;
}
</style>
