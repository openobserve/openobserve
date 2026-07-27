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

// One-click, least-privilege credential for the MCP server: create a service
// account, attach a freshly-seeded read-only role, and hand back the show-once
// token. Reuses the same primitives as the IAM service-account flow
// (service_accounts.create + createRole + seedReadonlyRolePermissions +
// updateRole add_users) so the credential behaves identically to one made by
// hand in IAM — just without the multi-screen detour.

import { ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import service_accounts from "@/services/service_accounts";
import { createRole, updateRole } from "@/services/iam";
import { seedReadonlyRolePermissions } from "@/components/iam/roles/readonlyPreset";
import { buildServiceAccountEmail } from "@/components/iam/serviceAccounts/AddServiceAccount.schema";

export interface McpCredential {
  /** Synthetic SA identifier — the Basic-auth username (`<name>.<org>@sa.internal`). */
  email: string;
  /** Show-once token — the Basic-auth password. Never persisted. */
  token: string;
  /** The read-only role created and attached to the account. */
  roleName: string;
  /** False when the account was created but the read-only role couldn't be
   *  seeded/attached (partial success) — the caller warns the user. */
  readonlyApplied: boolean;
}

export function useMcpCredential() {
  const store = useStore();
  const { t } = useI18n();

  const generating = ref(false);
  const error = ref("");
  const credential = ref<McpCredential | null>(null);

  /** rbac + service accounts must both be enabled for a read-only SA to exist. */
  const canGenerate = () =>
    !!store.state.zoConfig?.rbac_enabled && (store.state.zoConfig?.service_account_enabled ?? true);

  const generate = async (): Promise<McpCredential | null> => {
    generating.value = true;
    error.value = "";
    const org = store.state.selectedOrganization?.identifier;
    const isMetaOrg = org === store.state.zoConfig?.meta_org;

    // Unique, slug-valid base name shared by the account and its role.
    // Date.now() keeps two clicks from colliding; base36 stays [a-z0-9].
    const name = `mcp-${Date.now().toString(36)}`;

    try {
      const email = buildServiceAccountEmail(name, org);
      const res = await service_accounts.create(
        { email, first_name: "MCP client (read-only)" },
        org,
      );
      const token = res?.data?.token;
      if (res?.data?.code !== 200 || !token) {
        throw new Error(res?.data?.message || t("ingestion.mcp.credential.error"));
      }

      // Best-effort read-only scoping. A failure here leaves a working (but
      // unscoped) account + token — surfaced via readonlyApplied, not thrown,
      // so the show-once token is never lost to a role hiccup.
      let readonlyApplied = false;
      try {
        await createRole(name, org);
        const granted = await seedReadonlyRolePermissions(name, org, isMetaOrg);
        await updateRole({
          role_id: name,
          org_identifier: org,
          payload: { add: [], remove: [], add_users: [email], remove_users: [] },
        });
        readonlyApplied = granted > 0;
      } catch (roleErr) {
        console.error("MCP credential: read-only role could not be applied", roleErr);
        readonlyApplied = false;
      }

      credential.value = { email, token, roleName: name, readonlyApplied };
      return credential.value;
    } catch (err: any) {
      error.value =
        err?.response?.data?.message || err?.message || t("ingestion.mcp.credential.error");
      return null;
    } finally {
      generating.value = false;
    }
  };

  return { generate, generating, error, credential, canGenerate };
}
