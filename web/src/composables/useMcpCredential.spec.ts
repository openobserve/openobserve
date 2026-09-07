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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/iam", () => ({ createRole: vi.fn(), updateRole: vi.fn() }));

vi.mock("@/components/iam/roles/readonlyPreset", () => ({
  seedReadonlyRolePermissions: vi.fn(),
}));

vi.mock("@/services/service_accounts", () => ({ default: { create: vi.fn() } }));

const mockStore = {
  state: {
    selectedOrganization: { identifier: "" },
    zoConfig: { rbac_enabled: true, meta_org: "_meta" } as Record<string, unknown>,
  },
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

// The composable runs outside a component, where the global i18n plugin isn't installed.
vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (key: string) => key }) }));

import { createRole, updateRole } from "@/services/iam";
import { seedReadonlyRolePermissions } from "@/components/iam/roles/readonlyPreset";
import service_accounts from "@/services/service_accounts";
import { MCP_READONLY_ROLE, useMcpCredential } from "./useMcpCredential";

const created = () => ({
  data: { code: 200, message: "ok", token: "tok_123", user: "x" },
});

// The credential cache is module-scoped, so every case needs an org of its own.
const useOrg = (org: string, zoConfig: Record<string, unknown> = {}) => {
  mockStore.state.selectedOrganization.identifier = org;
  mockStore.state.zoConfig = { rbac_enabled: true, meta_org: "_meta", ...zoConfig };
  return useMcpCredential();
};

describe("useMcpCredential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service_accounts.create).mockResolvedValue(created() as any);
    vi.mocked(createRole).mockResolvedValue({} as any);
    vi.mocked(updateRole).mockResolvedValue({} as any);
    vi.mocked(seedReadonlyRolePermissions).mockResolvedValue(12);
  });

  describe("without rbac", () => {
    it("creates the service account and nothing else", async () => {
      const { generate } = useOrg("org-norbac", { rbac_enabled: false });

      const cred = await generate();

      expect(service_accounts.create).toHaveBeenCalledTimes(1);
      expect(service_accounts.create).toHaveBeenCalledWith(
        {
          email: expect.stringMatching(/^mcp-[a-z0-9]+\.org-norbac@sa\.internal$/),
          first_name: "MCP client",
        },
        "org-norbac",
      );
      expect(createRole).not.toHaveBeenCalled();
      expect(seedReadonlyRolePermissions).not.toHaveBeenCalled();
      expect(updateRole).not.toHaveBeenCalled();
      expect(cred).toMatchObject({ role: null, scope: "rbacDisabled", token: "tok_123" });
    });
  });

  describe("with rbac", () => {
    it("seeds the shared role on first use and joins the account to it", async () => {
      const { generate } = useOrg("org-fresh");

      const cred = await generate();

      expect(createRole).toHaveBeenCalledWith(MCP_READONLY_ROLE, "org-fresh");
      expect(seedReadonlyRolePermissions).toHaveBeenCalledWith(
        MCP_READONLY_ROLE,
        "org-fresh",
        false,
      );
      expect(updateRole).toHaveBeenCalledWith({
        role_id: MCP_READONLY_ROLE,
        org_identifier: "org-fresh",
        payload: { add: [], remove: [], add_users: [cred!.email], remove_users: [] },
      });
      expect(cred).toMatchObject({ role: MCP_READONLY_ROLE, scope: "readonly" });
    });

    // create_role normalizes the name (non-[A-Za-z0-9_] → "_") but update_role does not,
    // so all three calls must use one spelling that survives that normalization.
    it("addresses the same normalization-safe role name in all three calls", async () => {
      const { generate } = useOrg("org-samename");

      await generate();

      const names = [
        vi.mocked(createRole).mock.calls[0][0],
        vi.mocked(seedReadonlyRolePermissions).mock.calls[0][0],
        vi.mocked(updateRole).mock.calls[0][0].role_id,
      ];
      expect(new Set(names).size).toBe(1);
      expect(names[0]).toMatch(/^[a-zA-Z0-9_]+$/);
    });

    it("skips seeding when the shared role already exists", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 400, data: { message: "Role already exists" } },
      });
      const { generate, error } = useOrg("org-existing");

      const cred = await generate();

      expect(seedReadonlyRolePermissions).not.toHaveBeenCalled();
      expect(updateRole).toHaveBeenCalledTimes(1);
      expect(cred).toMatchObject({ role: MCP_READONLY_ROLE, scope: "readonly" });
      expect(error.value).toBe("");
    });

    it("keeps the show-once token when the role work fails", async () => {
      vi.mocked(updateRole).mockRejectedValue(new Error("boom"));
      const { generate, error } = useOrg("org-partial");

      const cred = await generate();

      expect(cred).toMatchObject({ token: "tok_123", role: null, scope: "unscoped" });
      expect(error.value).toBe("");
    });

    it("reports an unscoped account when seeding grants nothing", async () => {
      vi.mocked(seedReadonlyRolePermissions).mockResolvedValue(0);
      const { generate } = useOrg("org-empty");

      expect(await generate()).toMatchObject({ scope: "unscoped" });
    });

    it("seeds meta-org permissions inside the meta org", async () => {
      const { generate } = useOrg("_meta");

      await generate();

      expect(seedReadonlyRolePermissions).toHaveBeenCalledWith(MCP_READONLY_ROLE, "_meta", true);
    });
  });

  describe("failures", () => {
    it("surfaces the server's reason and attempts no role work", async () => {
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { data: { message: "Service Accounts Not Enabled" } },
      });
      const { generate, error, generating } = useOrg("org-403");

      expect(await generate()).toBeNull();
      expect(error.value).toBe("Service Accounts Not Enabled");
      expect(createRole).not.toHaveBeenCalled();
      expect(generating.value).toBe(false);
    });

    it("rejects a non-200 body", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({
        data: { code: 400, message: "bad request" },
      } as any);
      const { generate, error } = useOrg("org-nak");

      expect(await generate()).toBeNull();
      expect(error.value).toBe("bad request");
    });

    it("rejects a 200 that carries no token", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: { code: 200 } } as any);
      const { generate, error } = useOrg("org-notoken");

      expect(await generate()).toBeNull();
      expect(error.value).toBe("ingestion.mcp.credential.error");
    });
  });

  describe("session cache", () => {
    it("returns the same credential instead of minting a second account", async () => {
      const { generate } = useOrg("org-cache");

      const first = await generate();
      const second = await generate();

      expect(service_accounts.create).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it("hands a remount the credential it can no longer be shown", async () => {
      const { generate } = useOrg("org-remount");
      const first = await generate();

      const { credential } = useOrg("org-remount");

      expect(credential.value).toBe(first);
    });

    it("mints again for a different org", async () => {
      await useOrg("org-a").generate();
      await useOrg("org-b").generate();

      expect(service_accounts.create).toHaveBeenCalledTimes(2);
    });
  });
});
