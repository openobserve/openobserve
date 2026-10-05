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
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useRoleSave } from "@/composables/iam/useRoleSave";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const makeDeps = (mutateAsync: () => Promise<unknown>) => ({
  editingRole: ref("r1"),
  permissionsUiType: ref("table"),
  updateJsonInTable: vi.fn(),
  grants: {
    payload: () => ({ add: [{ object: "logs:_all_default", permission: "AllowGet" }], remove: [] }),
    commit: vi.fn(),
  },
  addedUsers: ref(new Set<unknown>()),
  removedUsers: ref(new Set<unknown>()),
  addedServiceAccounts: ref(new Set<unknown>()),
  removedServiceAccounts: ref(new Set<unknown>()),
  roleUsers: ref<string[]>([]),
  updateRoleOne: { mutateAsync: vi.fn(mutateAsync) },
  t: (key: string) => key as any,
});

describe("useRoleSave product analytics", () => {
  beforeEach(() => {
    vi.mocked(analytics.track).mockClear();
  });

  it("tracks role_updated once the role update succeeds", async () => {
    useRoleSave(makeDeps(() => Promise.resolve({}))).saveRole();
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledWith("role_updated", {
      permissions_changed: true,
      members_changed: false,
    });
  });

  it("does not track role_updated when the role update fails", async () => {
    useRoleSave(makeDeps(() => Promise.reject({ response: { status: 500 } }))).saveRole();
    await flushPromises();
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
