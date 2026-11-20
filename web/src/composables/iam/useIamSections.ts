// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { raw, useI18nTyped } from "@/types/i18n";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";
import { checkFeatureAccess, buildFeatureGateContext } from "@/utils/enterpriseFeatures";
import { featureState, menuState } from "@/utils/featureGate";

/** The IAM rail's sections and gates; the IAM shell and the Jump to palette both read them here. */
export function useIamSections() {
  const { t } = useI18nTyped();
  const store = useStore();
  const { isMetaOrg } = useIsMetaOrg();

  const orgQuery = computed(() => ({
    org_identifier: store.state.selectedOrganization?.identifier,
  }));

  const sectionGroups = computed<SectionHubGroup[]>(() => {
    const isCloud = config.isCloud == "true";
    const meta = isMetaOrg.value;
    const svc = store.state.zoConfig.service_account_enabled ?? true;
    const rbacAccess = checkFeatureAccess("rbac", buildFeatureGateContext(store.state.zoConfig));
    const rbacLicense = featureState(store.state.zoConfig?.features, "rbac");
    const syntheticsLicense = menuState(
      store.state.zoConfig?.features,
      "synthetics",
      store.state.zoConfig?.synthetics_enabled !== false,
    );
    const mcpLicense = featureState(store.state.zoConfig?.features, "mcp");
    const ratelimitLicense = featureState(store.state.zoConfig?.features, "ratelimit");

    return [
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
            key: "syntheticsTokens",
            label: t("iam.syntheticsTokens"),
            description: t("iam.syntheticsTokensDesc"),
            icon: "key",
            to: { name: "syntheticsTokens", query: orgQuery.value },
            visible: syntheticsLicense !== "hidden",
            licenseLocked: syntheticsLicense === "locked",
            dataTest: "iam-synthetics-tokens-tab",
          },
          {
            key: "mcpServer",
            label: t("iam.mcpServerLabel"),
            description: t("iam.mcpServerDesc", { product: raw("Model Context Protocol") }),
            icon: "mcp",
            to: { name: "mcpServer", query: orgQuery.value },
            // No edition gate (every edition serves MCP); only a hidden license removes it.
            visible: mcpLicense !== "hidden",
            licenseLocked: mcpLicense === "locked",
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
            visible: rbacLicense !== "hidden",
            locked: !rbacAccess.allowed,
            lockedMessage: rbacAccess.message,
            lockedShowUpgradeCta: rbacAccess.ctaRelevant,
            licenseLocked: rbacLicense === "locked",
            dataTest: "iam-groups-tab",
          },
          {
            key: "roles",
            label: t("iam.roles"),
            description: t("iam.rolesDesc"),
            icon: "shield",
            to: { name: "roles", query: orgQuery.value },
            visible: rbacLicense !== "hidden",
            locked: !rbacAccess.allowed,
            lockedMessage: rbacAccess.message,
            lockedShowUpgradeCta: rbacAccess.ctaRelevant,
            licenseLocked: rbacLicense === "locked",
            dataTest: "iam-roles-tab",
          },
          {
            key: "quota",
            label: t("iam.quota"),
            description: t("iam.quotaDesc"),
            icon: "speed",
            to: { name: "quota", query: orgQuery.value },
            // Meta-org is a cluster-topology restriction, not an edition upsell, so it hides rather than locks.
            visible: meta && ratelimitLicense !== "hidden",
            locked: !rbacAccess.allowed,
            lockedMessage: rbacAccess.message,
            lockedShowUpgradeCta: rbacAccess.ctaRelevant,
            licenseLocked: ratelimitLicense === "locked",
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
  });

  return { sectionGroups };
}
