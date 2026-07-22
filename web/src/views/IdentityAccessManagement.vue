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
  <!-- Grouped left rail (prototype admin model): the rail is always present;
       the chosen section renders its own page (header + table) to the right. -->
  <OPageLayout bleed :sidebar-width="230" data-test="iam-page">
    <template #sidebar>
      <SectionRail :groups="sectionGroups" :active-key="activeSection" :title="t('menu.iam')" />
    </template>
    <section class="h-full min-w-0 min-h-0 overflow-y-auto">
      <RouterView />
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import { type SectionHubGroup, type SectionHubItem } from "@/components/common/SectionHub.vue";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useRouter, useRoute, RouterView } from "vue-router";
import useIsMetaOrg from "@/composables/useIsMetaOrg";

const store = useStore();
const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { isMetaOrg } = useIsMetaOrg();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Route name → section key (drill-down editors map back to their section).
const routeToIamTab: Record<string, string> = {
  users: "users",
  serviceAccounts: "serviceAccounts",
  ingestionTokens: "ingestionTokens",
  mcpServer: "mcpServer",
  groups: "groups",
  editGroup: "groups",
  roles: "roles",
  editRole: "roles",
  quota: "quota",
  organizations: "organizations",
  invitations: "invitations",
};
const activeSection = computed(() => routeToIamTab[route.name as string] ?? "");

const sectionGroups = computed<SectionHubGroup[]>(() => {
  const isEnt = config.isEnterprise == "true" || config.isCloud == "true";
  const isCloud = config.isCloud == "true";
  const meta = isMetaOrg.value;
  const rbac = !!store.state.zoConfig.rbac_enabled;
  const svc = store.state.zoConfig.service_account_enabled ?? true;
  // MCP is an AI feature (its endpoint requires O2_AI_ENABLED). Available on
  // both enterprise and cloud builds, gated on the ai_enabled runtime flag.
  const aiEnabled = isEnt && !!store.state.zoConfig.ai_enabled;

  const groups: { label: string; items: SectionHubItem[] }[] = [
    {
      label: t("iam.sectionAccess"),
      items: [
        {
          key: "users",
          label: t("iam.basicUsers"),
          description: t("iam.usersDesc"),
          icon: "person",
          to: { name: "users", query: orgQuery.value },
          dataTest: "iam-users-tab",
        },
        {
          key: "serviceAccounts",
          label: t("iam.serviceAccounts"),
          description: t("iam.serviceAccountsDesc"),
          icon: "manage-accounts",
          to: { name: "serviceAccounts", query: orgQuery.value },
          visible: svc,
          dataTest: "iam-service-accounts-tab",
        },
        {
          key: "ingestionTokens",
          label: t("iam.ingestionTokens"),
          description: t("iam.ingestionTokensDesc"),
          icon: "key",
          to: { name: "ingestionTokens", query: orgQuery.value },
          dataTest: "iam-ingestion-tokens-tab",
        },
        {
          key: "mcpServer",
          label: t("iam.mcpServerLabel"),
          description: t("iam.mcpServerDesc"),
          icon: "mcp",
          to: { name: "mcpServer", query: orgQuery.value },
          visible: aiEnabled,
          dataTest: "iam-mcp-server-tab",
        },
        {
          key: "invitations",
          label: t("iam.invitations"),
          description: t("iam.invitationsDesc"),
          icon: "mail",
          to: { name: "invitations", query: orgQuery.value },
          visible: isCloud,
          dataTest: "iam-invitations-tab",
        },
      ],
    },
    {
      label: t("iam.sectionPermissions"),
      items: [
        {
          key: "groups",
          label: t("iam.groups"),
          description: t("iam.groupsDesc"),
          icon: "group",
          to: { name: "groups", query: orgQuery.value },
          visible: isEnt && rbac,
          dataTest: "iam-groups-tab",
        },
        {
          key: "roles",
          label: t("iam.roles"),
          description: t("iam.rolesDesc"),
          icon: "shield",
          to: { name: "roles", query: orgQuery.value },
          visible: isEnt && rbac,
          dataTest: "iam-roles-tab",
        },
        {
          key: "quota",
          label: t("iam.quota"),
          description: t("iam.quotaDesc"),
          icon: "speed",
          to: { name: "quota", query: orgQuery.value },
          visible: isEnt && rbac && meta,
          dataTest: "iam-quota-tab",
        },
      ],
    },
    {
      label: t("iam.sectionOrganization"),
      items: [
        {
          key: "organizations",
          label: t("iam.organizations"),
          description: t("iam.organizationsDesc"),
          icon: "corporate-fare",
          to: { name: "organizations", query: orgQuery.value },
          dataTest: "iam-organizations-tab",
        },
      ],
    },
  ];
  return groups;
});

// The rail is always shown, so the IAM root has no standalone landing — send it
// to the first section (Users, always available). Also: non-meta users can't use
// the quota section — bounce them to Users too.
watch(
  () => route.name,
  (name) => {
    if (name === "iam") {
      // .catch: in unit tests the mounted router may not register child routes;
      // a rejected navigation must not surface as an unhandled error.
      Promise.resolve(router.replace({ name: "users", query: orgQuery.value })).catch(() => {});
    } else if (name === "quota" && !isMetaOrg.value) {
      Promise.resolve(router.push({ name: "users", query: orgQuery.value })).catch(() => {});
    }
  },
  { immediate: true },
);
</script>
