<template>
  <PageLayout
    data-test="iam-page"
    resizable
    :sidebar-width="220"
    :splitter-limits="[0, 300]"
  >
    <template #header>
      <AppPageHeader icon="shield" title="Identity &amp; Access" />
    </template>

    <template #sidebar>
      <route-tabs
        ref="iamRouteTabsRef"
        dataTest="iam-tabs"
        :tabs="tabs"
        :activeTab="activeTab"
        @update:activeTab="updateActiveTab"
      />
    </template>

    <RouterView />
  </PageLayout>
</template>

<script setup lang="ts">
import PageLayout from "@/components/common/PageLayout.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import RouteTabs from "@/components/RouteTabs.vue";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useRouter } from "vue-router";
import { nextTick } from "vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { resolveTab } from "@/utils/routeTabMaps";
const store = useStore();
const { t } = useI18n();

const router = useRouter();

const activeTab = ref(resolveTab("iam", router.currentRoute.value.name as string, "users"));

const iamRouteTabsRef: any = ref(null);

const { isMetaOrg } = useIsMetaOrg();

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

