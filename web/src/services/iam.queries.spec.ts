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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import {
  createRoleMutation,
  updateRoleMutation,
  deleteRoleMutation,
  bulkDeleteRolesMutation,
} from "./iam.queries";
import { iamKeys } from "./iam.querykeys";
import { userKeys } from "./users.querykeys";

vi.mock("./iam", () => ({
  getGroups: vi.fn(),
  getRoles: vi.fn(),
  getResources: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  bulkDeleteGroups: vi.fn(),
  createRole: vi.fn().mockResolvedValue({ data: {} }),
  updateRole: vi.fn().mockResolvedValue({ data: {} }),
  deleteRole: vi.fn().mockResolvedValue({ data: {} }),
  bulkDeleteRoles: vi.fn().mockResolvedValue({ data: {} }),
}));

const ORG = "test-org";

// Runs a mutation through the real MutationCache, so its `meta.invalidates` goes through the same key matching the app uses.
const run = async (options: any, variables: unknown) => {
  const mutation = queryClient.getMutationCache().build(queryClient, options);
  await mutation.execute(variables);
};

const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("role mutations", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(iamKeys.roles(ORG), ["nmcdev"]);
    queryClient.setQueryData(userKeys.allUserRoles(ORG), { "alice@example.com": ["nmcdev"] });
    queryClient.setQueryData(userKeys.assignableRoles(ORG), [{ label: "Admin", value: "admin" }]);
  });

  it.each([
    ["update", () => updateRoleMutation(ORG), { role_id: "nmcdev", payload: {} }],
    ["delete", () => deleteRoleMutation(ORG), "nmcdev"],
    ["bulk delete", () => bulkDeleteRolesMutation(ORG), ["nmcdev"]],
  ])("%s drops the roles list and the user→roles map", async (_label, build, variables) => {
    await run(build(), variables);

    expect(isInvalidated(iamKeys.roles(ORG))).toBe(true);
    expect(isInvalidated(userKeys.allUserRoles(ORG))).toBe(true);
    // The assignable list is the fixed built-in role set — no role write changes it.
    expect(isInvalidated(userKeys.assignableRoles(ORG))).toBe(false);
  });

  it("create drops the roles list but keeps the user→roles map", async () => {
    await run(createRoleMutation(ORG), "nmcdev");

    expect(isInvalidated(iamKeys.roles(ORG))).toBe(true);
    // A new role has no members yet.
    expect(isInvalidated(userKeys.allUserRoles(ORG))).toBe(false);
  });
});
