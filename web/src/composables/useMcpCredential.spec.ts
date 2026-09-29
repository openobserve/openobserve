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

vi.mock("@/services/iam", () => ({
  createRole: vi.fn(),
  getAllRolePermissions: vi.fn(),
  getResources: vi.fn(),
  updateRole: vi.fn(),
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

import { createRole, getAllRolePermissions, getResources, updateRole } from "@/services/iam";
import service_accounts from "@/services/service_accounts";
import { MCP_READONLY_ROLE, useMcpCredential } from "./useMcpCredential";

const created = () => ({
  data: { code: 200, message: "ok", token: "tok_123", user: "x" },
});

// `org` is grantable only from the meta org, and hidden resources are never seeded.
const RESOURCES = [
  { key: "stream", visible: true },
  { key: "mcp", visible: true },
  { key: "org", visible: true },
  { key: "internal", visible: false },
];

// The read-only preset for RESOURCES in a non-meta org, plus the MCP write grant.
const fullSet = (org: string) => [
  { object: `stream:_all_${org}`, permission: "AllowList" },
  { object: `stream:_all_${org}`, permission: "AllowGet" },
  { object: `mcp:_all_${org}`, permission: "AllowList" },
  { object: `mcp:_all_${org}`, permission: "AllowGet" },
  { object: `mcp:_all_${org}`, permission: "AllowPut" },
];

const addedGrants = () => vi.mocked(updateRole).mock.calls[0][0].payload.add;

const roleAlreadyExists = () =>
  vi.mocked(createRole).mockRejectedValue({
    response: { status: 400, data: { message: "Role already exists" } },
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
    vi.mocked(getResources).mockResolvedValue({ data: RESOURCES } as any);
    vi.mocked(getAllRolePermissions).mockResolvedValue({ data: [] } as any);
    vi.mocked(updateRole).mockResolvedValue({} as any);
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
      expect(getResources).not.toHaveBeenCalled();
      expect(updateRole).not.toHaveBeenCalled();
      expect(cred).toMatchObject({ role: null, scope: "rbacDisabled", token: "tok_123" });
    });
  });

  describe("with rbac", () => {
    it("grants a fresh role the read-only set plus MCP write, and joins the account", async () => {
      const { generate } = useOrg("org-fresh");

      const cred = await generate();

      expect(createRole).toHaveBeenCalledWith(MCP_READONLY_ROLE, "org-fresh");
      // Nothing to diff against on a role created a moment ago.
      expect(getAllRolePermissions).not.toHaveBeenCalled();
      expect(updateRole).toHaveBeenCalledTimes(1);
      expect(updateRole).toHaveBeenCalledWith({
        role_id: MCP_READONLY_ROLE,
        org_identifier: "org-fresh",
        payload: {
          add: fullSet("org-fresh"),
          remove: [],
          add_users: [cred!.email],
          remove_users: [],
        },
      });
      expect(cred).toMatchObject({ role: MCP_READONLY_ROLE, scope: "readonly" });
    });

    // create_role normalizes the name (non-[A-Za-z0-9_] → "_") but update_role does not.
    it("addresses the same normalization-safe role name in both calls", async () => {
      const { generate } = useOrg("org-samename");

      await generate();

      const names = [
        vi.mocked(createRole).mock.calls[0][0],
        vi.mocked(updateRole).mock.calls[0][0].role_id,
      ];
      expect(new Set(names).size).toBe(1);
      expect(names[0]).toMatch(/^[a-zA-Z0-9_]+$/);
    });

    it("adds no grants to an existing role that already holds them all", async () => {
      roleAlreadyExists();
      vi.mocked(getAllRolePermissions).mockResolvedValue({ data: fullSet("org-complete") } as any);
      const { generate, error } = useOrg("org-complete");

      const cred = await generate();

      expect(getAllRolePermissions).toHaveBeenCalledWith({
        role_name: MCP_READONLY_ROLE,
        org_identifier: "org-complete",
      });
      expect(addedGrants()).toEqual([]);
      expect(vi.mocked(updateRole).mock.calls[0][0].payload.add_users).toEqual([cred!.email]);
      expect(cred).toMatchObject({ role: MCP_READONLY_ROLE, scope: "readonly" });
      expect(error.value).toBe("");
    });

    // A first mint whose seed threw leaves the role created but empty; later mints must still fill it.
    it("re-grants everything to an existing role a failed first seed left empty", async () => {
      roleAlreadyExists();
      const { generate } = useOrg("org-emptyrole");

      const cred = await generate();

      expect(addedGrants()).toEqual(fullSet("org-emptyrole"));
      expect(cred).toMatchObject({ role: MCP_READONLY_ROLE, scope: "readonly" });
    });

    // POST /api/{org}/mcp resolves to PUT on the `mcp` resource, which the read-only preset never grants.
    it("adds only the MCP write grant a role seeded before it existed is missing", async () => {
      roleAlreadyExists();
      vi.mocked(getAllRolePermissions).mockResolvedValue({
        data: fullSet("org-preput").filter((perm) => perm.permission !== "AllowPut"),
      } as any);
      const { generate } = useOrg("org-preput");

      await generate();

      expect(addedGrants()).toEqual([{ object: "mcp:_all_org-preput", permission: "AllowPut" }]);
    });

    it("treats AllowAll as covering every grant on that resource", async () => {
      roleAlreadyExists();
      vi.mocked(getAllRolePermissions).mockResolvedValue({
        data: [
          { object: "stream:_all_org-allowall", permission: "AllowList" },
          { object: "stream:_all_org-allowall", permission: "AllowGet" },
          { object: "mcp:_all_org-allowall", permission: "AllowAll" },
        ],
      } as any);
      const { generate } = useOrg("org-allowall");

      await generate();

      expect(addedGrants()).toEqual([]);
    });

    it("keeps the show-once token when the role update fails", async () => {
      vi.mocked(updateRole).mockRejectedValue(new Error("boom"));
      const { generate, error } = useOrg("org-partial");

      const cred = await generate();

      expect(cred).toMatchObject({ token: "tok_123", role: null, scope: "unscoped" });
      expect(error.value).toBe("");
    });

    // Without the existing grants a blind write could duplicate a tuple and 500, so nothing is sent.
    it("reports unscoped without joining the role when its grants cannot be read", async () => {
      roleAlreadyExists();
      vi.mocked(getAllRolePermissions).mockRejectedValue(new Error("boom"));
      const { generate } = useOrg("org-unreadable");

      const cred = await generate();

      expect(updateRole).not.toHaveBeenCalled();
      expect(cred).toMatchObject({ token: "tok_123", role: null, scope: "unscoped" });
    });

    it("reports an unscoped account when no resource is readable", async () => {
      vi.mocked(getResources).mockResolvedValue({ data: [] } as any);
      const { generate } = useOrg("org-noresources");

      expect(await generate()).toMatchObject({ scope: "unscoped" });
    });

    it("grants the org resource only inside the meta org", async () => {
      await useOrg("_meta").generate();
      await useOrg("org-plain").generate();

      const [metaAdd, plainAdd] = vi.mocked(updateRole).mock.calls.map((c) => c[0].payload.add);
      expect(metaAdd).toContainEqual({ object: "org:_all__meta", permission: "AllowList" });
      expect(plainAdd.some((perm: { object: string }) => perm.object.startsWith("org:"))).toBe(
        false,
      );
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
