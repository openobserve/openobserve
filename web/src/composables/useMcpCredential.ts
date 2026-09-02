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

// Least-privilege credential for the MCP server, in two modes: pick a service
// account the caller is already permitted to see and read its token back in
// full, or create a new one with a freshly-seeded read-only role attached.
// Reuses the same primitives as the IAM service-account flow
// (service_accounts.create + createRole + seedReadonlyRolePermissions +
// updateRole add_users) so the credential behaves identically to one made by
// hand in IAM — just without the multi-screen detour. Reading a token back
// needs the passcode route: the list endpoint redacts tokens and rotation
// invalidates the previous one, so the page could otherwise show it only once.

import { ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import type { I18nText } from "@/types/i18n";
import service_accounts from "@/services/service_accounts";
import { createRole, updateRole } from "@/services/iam";
import { seedReadonlyRolePermissions } from "@/components/iam/roles/readonlyPreset";
import { buildServiceAccountEmail } from "@/components/iam/serviceAccounts/AddServiceAccount.schema";

// What the backend returns for an account whose static token use is disabled.
const MASKED_TOKEN = "NOT_AVAILABLE";

export interface McpServiceAccount {
  email: string;
  label: I18nText;
}

export interface McpCredential {
  /** Synthetic SA identifier — the Basic-auth username (`<name>.<org>@sa.internal`). */
  email: string;
  /** The Basic-auth password. Never persisted. */
  token: string;
  /** The read-only role created here. Empty when the credential was read back. */
  roleName: string;
  /** False when the account was created but the read-only role couldn't be
   *  seeded/attached (partial success) — the caller warns the user. */
  readonlyApplied: boolean;
  /** Only a "generated" credential carries warnings about its own creation. */
  source: "generated" | "existing";
}

export function useMcpCredential() {
  const store = useStore();
  const { t } = useI18nTyped();

  const generating = ref(false);
  const error = ref("");
  const credential = ref<McpCredential | null>(null);
  const accounts = ref<McpServiceAccount[]>([]);
  const loadingAccounts = ref(false);

  // Not gated on rbac: with no roles there is nothing to scope, and gating locked those orgs out.
  const canGenerate = () => store.state.zoConfig?.service_account_enabled ?? true;

  // The list is already scoped by the caller's permissions server-side, so a
  // 403 or an empty result is the answer, not an error worth surfacing.
  const loadAccounts = async (): Promise<McpServiceAccount[]> => {
    if (!canGenerate()) return [];
    loadingAccounts.value = true;
    try {
      const org = store.state.selectedOrganization?.identifier;
      const res = await service_accounts.list(org);
      accounts.value = (res?.data?.data ?? [])
        .filter((row: any) => row?.email && !row?.is_system)
        .map((row: any) => ({
          email: row.email,
          label: raw(row.first_name ? `${row.first_name} (${row.email})` : row.email),
        }));
    } catch {
      accounts.value = [];
    } finally {
      loadingAccounts.value = false;
    }
    return accounts.value;
  };

  const selectAccount = async (email: string): Promise<McpCredential | null> => {
    error.value = "";
    const org = store.state.selectedOrganization?.identifier;
    try {
      const res = await service_accounts.get_passcode(org, email);
      const token = res?.data?.token;
      if (!token || token === MASKED_TOKEN) {
        error.value = t("ingestion.mcp.credential.tokenUnavailable");
        credential.value = null;
        return null;
      }
      credential.value = {
        email: res?.data?.user || email,
        token,
        roleName: "",
        readonlyApplied: true,
        source: "existing",
      };
      return credential.value;
    } catch (err: any) {
      error.value =
        err?.response?.data?.message ||
        err?.message ||
        t("ingestion.mcp.credential.tokenUnavailable");
      credential.value = null;
      return null;
    }
  };

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

      credential.value = { email, token, roleName: name, readonlyApplied, source: "generated" };
      accounts.value = [{ email, label: raw(email) }, ...accounts.value];
      return credential.value;
    } catch (err: any) {
      error.value =
        err?.response?.data?.message || err?.message || t("ingestion.mcp.credential.error");
      return null;
    } finally {
      generating.value = false;
    }
  };

  return {
    generate,
    generating,
    error,
    credential,
    canGenerate,
    accounts,
    loadingAccounts,
    loadAccounts,
    selectAccount,
  };
}
