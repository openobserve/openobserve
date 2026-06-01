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
  <div class="tw:h-full tw:min-h-0 tw:flex tw:flex-col" data-test="iam-page">
    <!-- Breadcrumb now lives in the top chrome bar (published from this shell).
         Hub shows the cards; each section renders its own header in its content. -->
    <template v-if="isHub">
      <AppPageHeader
        :title="t('menu.iam')"
        icon="manage-accounts"
        subtitle="Manage users, service accounts, roles, groups, and organization access."
        class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
      />
      <SectionHub :groups="sectionGroups" class="tw:flex-1 tw:min-h-0" />
    </template>
    <section
      v-else
      class="tw:flex-1 tw:min-w-0 tw:min-h-0 tw:overflow-y-auto"
    >
      <RouterView />
    </section>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import SectionHub, {
  type SectionHubGroup,
  type SectionHubItem,
} from "@/components/common/SectionHub.vue";
import {
  useAppBreadcrumb,
  type Crumb,
} from "@/composables/useAppBreadcrumb";
import { computed, watch, onActivated, onDeactivated, onUnmounted } from "vue";
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

const isHub = computed(() => route.name === "iam");
const hubRoute = computed(() => ({ name: "iam", query: orgQuery.value }));

// Route name → section key (drill-down editors map back to their section).
const routeToIamTab: Record<string, string> = {
  users: "users",
  serviceAccounts: "serviceAccounts",
  ingestionTokens: "ingestionTokens",
  groups: "groups",
  editGroup: "groups",
  roles: "roles",
  editRole: "roles",
  quota: "quota",
  organizations: "organizations",
  invitations: "invitations",
};
const activeSection = computed(() => routeToIamTab[route.name as string] ?? "");

// Dynamic L3 detail crumb (role/group editors).
const trailing = computed(() => {
  if (route.name === "editRole")
    return (route.params.role_name as string) || "Edit role";
  if (route.name === "editGroup")
    return (route.params.group_name as string) || "Edit group";
  return undefined;
});

// Breadcrumb (row 1). Hub: just the module name. Section: IAM(link → hub) ›
// <Section ▾>  (› role/group name on editors).
const crumbs = computed<Crumb[]>(() => {
  if (isHub.value)
    return [
      {
        label: t("menu.iam"),
        icon: "manage-accounts",
        current: true,
        dataTest: "breadcrumb-iam-root",
      },
    ];
  const list: Crumb[] = [
    {
      label: t("menu.iam"),
      icon: "manage-accounts",
      to: hubRoute.value,
      dataTest: "breadcrumb-iam-root",
    },
    {
      dropdown: sectionGroups.value,
      activeKey: activeSection.value,
      dataTest: "breadcrumb-iam-section",
    },
  ];
  if (trailing.value) list.push({ label: trailing.value, current: true });
  return list;
});

const sectionGroups = computed<SectionHubGroup[]>(() => {
  const isEnt = config.isEnterprise == "true" || config.isCloud == "true";
  const isCloud = config.isCloud == "true";
  const meta = isMetaOrg.value;
  const rbac = !!store.state.zoConfig.rbac_enabled;
  const svc = store.state.zoConfig.service_account_enabled ?? true;

  const groups: { label: string; items: SectionHubItem[] }[] = [
    {
      label: "ACCESS",
      items: [
        {
          key: "users",
          label: t("iam.basicUsers"),
          description: "People with access to this organization",
          icon: "person",
          to: { name: "users", query: orgQuery.value },
          dataTest: "iam-users-tab",
        },
        {
          key: "serviceAccounts",
          label: t("iam.serviceAccounts"),
          description: "Programmatic access tokens for APIs",
          icon: "manage-accounts",
          to: { name: "serviceAccounts", query: orgQuery.value },
          visible: svc,
          dataTest: "iam-service-accounts-tab",
        },
        {
          key: "ingestionTokens",
          label: t("iam.ingestionTokens"),
          description: "Tokens for ingesting data into this organization",
          icon: "key",
          to: { name: "ingestionTokens", query: orgQuery.value },
          dataTest: "iam-ingestion-tokens-tab",
        },
        {
          key: "invitations",
          label: t("iam.invitations"),
          description: "Pending and sent member invitations",
          icon: "mail",
          to: { name: "invitations", query: orgQuery.value },
          visible: isCloud,
          dataTest: "iam-invitations-tab",
        },
      ],
    },
    {
      label: "PERMISSIONS",
      items: [
        {
          key: "groups",
          label: t("iam.groups"),
          description: "Group users together to assign roles",
          icon: "group",
          to: { name: "groups", query: orgQuery.value },
          visible: isEnt && rbac,
          dataTest: "iam-groups-tab",
        },
        {
          key: "roles",
          label: t("iam.roles"),
          description: "Define permissions and access policies",
          icon: "shield",
          to: { name: "roles", query: orgQuery.value },
          visible: isEnt && rbac,
          dataTest: "iam-roles-tab",
        },
        {
          key: "quota",
          label: t("iam.quota"),
          description: "Usage limits applied per role",
          icon: "speed",
          to: { name: "quota", query: orgQuery.value },
          visible: isEnt && rbac && meta,
          dataTest: "iam-quota-tab",
        },
      ],
    },
    {
      label: "ORGANIZATION",
      items: [
        {
          key: "organizations",
          label: t("iam.organizations"),
          description: "Organizations you can access",
          icon: "corporate-fare",
          to: { name: "organizations", query: orgQuery.value },
          dataTest: "iam-organizations-tab",
        },
      ],
    },
  ];
  return groups;
});

// Publish the breadcrumb to the top chrome bar (republish on change + keep-alive
// re-entry; clear on leave — the chrome's route-key gate guards against staleness).
// Declared after `sectionGroups` because `crumbs` reads it on section routes — an
// immediate watch any earlier would hit a TDZ on `sectionGroups`.
const { publish, clear } = useAppBreadcrumb();
watch(crumbs, (c) => publish(c), { immediate: true });
onActivated(() => publish(crumbs.value));
onDeactivated(clear);
onUnmounted(clear);

// Guard: non-meta users can't use the quota section — bounce to users.
watch(
  () => route.name,
  (name) => {
    if (name === "quota" && !isMetaOrg.value) {
      router.push({ name: "users", query: orgQuery.value });
    }
  },
  { immediate: true },
);
</script>
