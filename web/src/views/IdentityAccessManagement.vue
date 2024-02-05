<template>
  <q-page data-test="iam-page" class="q-pa-none" style="min-height: inherit">
    <div class="flex no-wrap" style="height: calc(100vh - 60px) !important">
      <div style="width: 160px" class="iam-tabs">
        <route-tabs
          dataTest="iam-tabs"
          :tabs="tabs"
          :activeTab="activeTab"
          @update:activeTab="updateActiveTab"
        />
      </div>
      <q-separator vertical />
      <div style="width: calc(100% - 160px)">
        <RouterView />
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import RouteTabs from "@/components/RouteTabs.vue";
import { onBeforeMount } from "vue";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { onActivated } from "vue";
import { useRouter } from "vue-router";
import { nextTick } from "vue";

const store = useStore();
const { t } = useI18n();

const router = useRouter();

const activeTab = ref("users");

onBeforeMount(() => {
  setTabs();
});

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
  }
);

const setTabs = () => {
  const enterprise = ["users", "groups", "roles", "organizations"];
  const os = ["users"];

  const isEnterprise =
    config.isEnterprise == "true" || config.isCloud == "true";

  if (isEnterprise) {
    tabs.value = tabs.value.filter((tab) => enterprise.includes(tab.name));
  } else {
    tabs.value = tabs.value.filter((tab) => os.includes(tab.name));
  }
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
    label: t("iam.users"),
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

const updateActiveTab = (tab: string) => {
  activeTab.value = tab;
};
</script>

<style scoped></style>
