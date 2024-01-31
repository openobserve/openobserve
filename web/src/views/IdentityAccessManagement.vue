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
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

const store = useStore();
const { t } = useI18n();

const activeTab = ref("users");

const tabs = [
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
];

const updateActiveTab = (tab: string) => {
  activeTab.value = tab;
};
</script>

<style scoped></style>
