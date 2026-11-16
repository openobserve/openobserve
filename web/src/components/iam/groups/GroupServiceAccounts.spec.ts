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

import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GroupServiceAccounts from "@/components/iam/groups/GroupServiceAccounts.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const getServiceAccounts = vi.fn();

vi.mock("@/composables/iam/usePermissions", () => ({
  default: () => ({
    serviceAccountsState: {
      service_accounts_users: [],
      getServiceAccounts: (...a: unknown[]) => getServiceAccounts(...a),
    },
  }),
}));

const ORG_ACCOUNTS = [
  { email: "ci-bot@example.com" },
  { email: "deploy-bot@example.com" },
  { email: "system@example.com", is_system: true },
];

// OTable holds its skeleton for a minimum time after a load, so a flush alone can land before the rows or empty state paint.
const mountAccounts = async (groupUsers: string[] = [], { settle = true } = {}) => {
  const w = mount(GroupServiceAccounts, {
    global: { provide: { store }, plugins: [i18n] },
    props: {
      groupUsers,
      activeTab: "serviceAccounts",
      addedUsers: new Set(),
      removedUsers: new Set(),
    },
  });
  await flushPromises();
  if (settle) {
    await vi.waitFor(() =>
      expect(w.get('[data-test="o2-table"]').attributes("data-test-loading")).toBe("false"),
    );
  }
  return w;
};

const noneSelected = (w: VueWrapper<any>) =>
  w.find('[data-test="iam-service-accounts-selection-none-selected"]');
const loadError = (w: VueWrapper<any>) =>
  w.find('[data-test="iam-service-accounts-selection-load-error"]');
const row = (w: VueWrapper<any>, email: string) =>
  w.find(`[data-test="iam-service-accounts-selection-table-body-row-${email}-checkbox"]`);

describe("GroupServiceAccounts empty states", () => {
  let w: VueWrapper<any> | undefined;

  beforeEach(() => {
    getServiceAccounts.mockReset();
    getServiceAccounts.mockResolvedValue(ORG_ACCOUNTS);
  });

  afterEach(() => {
    w?.unmount();
    w = undefined;
    vi.restoreAllMocks();
  });

  it("says no service accounts are selected, not that the org has none, when the Selected filter is empty", async () => {
    w = await mountAccounts([]);

    expect(noneSelected(w).exists()).toBe(true);
    expect(noneSelected(w).text()).toContain("No service accounts selected");
    expect(w.text()).not.toContain("No service accounts yet");
  });

  it("switches to All from the none-selected action and lists the org's service accounts", async () => {
    w = await mountAccounts([]);

    await noneSelected(w).find("button").trigger("click");
    await flushPromises();

    expect(w.vm.usersDisplay).toBe("all");
    expect(row(w, "ci-bot@example.com").exists()).toBe(true);
    expect(row(w, "system@example.com").exists()).toBe(false);
  });

  it("keeps the org-empty copy under the default Selected filter when the org has no service accounts", async () => {
    getServiceAccounts.mockResolvedValue([]);
    w = await mountAccounts([]);

    expect(w.vm.usersDisplay).toBe("selected");
    expect(noneSelected(w).exists()).toBe(false);
    expect(w.text()).toContain("No service accounts yet");
  });

  it("shows the search-filtered state when a search empties the Selected view", async () => {
    w = await mountAccounts([]);
    w.vm.userSearchKey = "nobody";
    await flushPromises();

    expect(noneSelected(w).exists()).toBe(false);
    expect(w.text()).toContain("No service accounts found");
  });

  it("makes no claim about the org while its service-account list is still loading", async () => {
    getServiceAccounts.mockReturnValue(new Promise(() => {}));
    w = await mountAccounts([], { settle: false });

    expect(w.findComponent(OTable).props("loading")).toBe(true);
    expect(noneSelected(w).exists()).toBe(false);
    expect(w.text()).not.toContain("No service accounts yet");
  });

  it("shows a load error, not the org-empty copy, when the list fails, and recovers on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getServiceAccounts.mockRejectedValueOnce({ response: { status: 500 } });
    w = await mountAccounts([]);

    expect(loadError(w).exists()).toBe(true);
    expect(noneSelected(w).exists()).toBe(false);
    expect(w.text()).not.toContain("No service accounts yet");

    await loadError(w).find("button").trigger("click");
    await flushPromises();

    await vi.waitFor(() => expect(noneSelected(w!).exists()).toBe(true));
    expect(loadError(w).exists()).toBe(false);
  });

  it("shows the no-access state, not a load error, when listing is forbidden", async () => {
    getServiceAccounts.mockRejectedValueOnce({ response: { status: 403 } });
    w = await mountAccounts([]);

    expect(w.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(loadError(w).exists()).toBe(false);
  });
});
