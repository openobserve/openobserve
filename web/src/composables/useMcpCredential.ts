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

// Dedicated credential for the MCP server: create a service account and, under
// RBAC, add it to one shared read-only role per org. Reuses the IAM primitives
// (service_accounts.create + createRole + seedReadonlyRolePermissions +
// updateRole add_users), so the result is indistinguishable from a service
// account made by hand. Known gap: a role created but left unseeded (seeding
// threw) stays empty, since later mints skip seeding — the fix is to diff
// getAllRolePermissions against buildReadonlyPermissions, not done here.

import { ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import service_accounts from "@/services/service_accounts";
import { createRole, updateRole } from "@/services/iam";
import { seedReadonlyRolePermissions } from "@/components/iam/roles/readonlyPreset";
import { buildServiceAccountEmail } from "@/components/iam/serviceAccounts/AddServiceAccount.schema";

// Underscore, not hyphen: create_role normalizes the name (non-[A-Za-z0-9_] → "_"), update_role does not.
export const MCP_READONLY_ROLE = "mcp_readonly";

export type McpCredentialScope = "readonly" | "unscoped" | "rbacDisabled";

export interface McpCredential {
  /** Synthetic SA identifier — the Basic-auth username (`<name>.<org>@sa.internal`). */
  email: string;
  /** Show-once token — the Basic-auth password. Never persisted. */
  token: string;
  /** Null unless the account was actually added to the shared read-only role. */
  role: string | null;
  scope: McpCredentialScope;
}

// Show-once token: a remount must reuse it, and org-keyed because an org switch remounts the consumer.
const sessionCredentials = new Map<string, McpCredential>();

export function useMcpCredential() {
  const store = useStore();
  const { t } = useI18nTyped();

  const currentOrg = (): string => store.state.selectedOrganization?.identifier ?? "";

  const generating = ref(false);
  const error = ref("");
  const credential = ref<McpCredential | null>(sessionCredentials.get(currentOrg()) ?? null);

  // A 400 on a fixed, valid, non-standard role name can only mean it already exists.
  const ensureReadonlyRole = async (org: string): Promise<boolean> => {
    try {
      await createRole(MCP_READONLY_ROLE, org);
      return true;
    } catch (err: any) {
      if (err?.response?.status === 400) return false;
      throw err;
    }
  };

  // Never throws: a role hiccup must not cost the caller the show-once token.
  const applyReadonlyRole = async (
    email: string,
    org: string,
  ): Promise<Pick<McpCredential, "role" | "scope">> => {
    if (!store.state.zoConfig?.rbac_enabled) return { role: null, scope: "rbacDisabled" };

    const isMetaOrg = org === store.state.zoConfig?.meta_org;
    try {
      const created = await ensureReadonlyRole(org);
      // Re-seeding rewrites existing tuples, which OpenFGA rejects and update_role reports as a 500.
      const granted = created
        ? await seedReadonlyRolePermissions(MCP_READONLY_ROLE, org, isMetaOrg)
        : null;
      await updateRole({
        role_id: MCP_READONLY_ROLE,
        org_identifier: org,
        payload: { add: [], remove: [], add_users: [email], remove_users: [] },
      });
      return {
        role: MCP_READONLY_ROLE,
        scope: granted === 0 ? "unscoped" : "readonly",
      };
    } catch (roleErr) {
      console.error("MCP credential: read-only role could not be applied", roleErr);
      return { role: null, scope: "unscoped" };
    }
  };

  const generate = async (): Promise<McpCredential | null> => {
    const org = currentOrg();
    const cached = sessionCredentials.get(org);
    if (cached) {
      credential.value = cached;
      return cached;
    }

    generating.value = true;
    error.value = "";

    // Date.now() keeps two mints from colliding; base36 stays inside the slug charset.
    const name = `mcp-${Date.now().toString(36)}`;

    try {
      const email = buildServiceAccountEmail(name, org);
      const res = await service_accounts.create({ email, first_name: "MCP client" }, org);
      const token = res?.data?.token;
      if (res?.data?.code !== 200 || !token) {
        throw new Error(res?.data?.message || t("ingestion.mcp.credential.error"));
      }

      credential.value = { email, token, ...(await applyReadonlyRole(email, org)) };
      sessionCredentials.set(org, credential.value);
      return credential.value;
    } catch (err: any) {
      error.value =
        err?.response?.data?.message || err?.message || t("ingestion.mcp.credential.error");
      return null;
    } finally {
      generating.value = false;
    }
  };

  return { generate, generating, error, credential };
}
