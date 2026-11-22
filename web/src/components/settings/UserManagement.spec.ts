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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import users from "@/services/users";
import domainManagement from "@/services/domainManagement";
import organizations from "@/services/organizations";
import { queryClient } from "@/composables/query/queryClient";
import { userKeys } from "@/services/users.querykeys";
import { domainManagementKeys } from "@/services/domainManagement.querykeys";
import UserManagement from "./UserManagement.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/users", () => ({ default: { listAllUsers: vi.fn() } }));
vi.mock("@/services/domainManagement", () => ({
  default: { getDomainRestrictions: vi.fn(), updateDomainRestrictions: vi.fn() },
}));
vi.mock("@/services/organizations", () => ({ default: { get_admin_org: vi.fn() } }));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: any[]) => mockToast(...args) }));

const mockConfirm = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: (...args: any[]) => mockConfirm(...args) }),
}));

const mockReplace = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return { ...actual, useRouter: () => ({ replace: mockReplace, push: vi.fn() }) };
});

const usersService = users as unknown as Record<string, ReturnType<typeof vi.fn>>;
const domainService = domainManagement as unknown as Record<string, ReturnType<typeof vi.fn>>;
const orgService = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const storeFor = (selected: string, signedIn = "operator@o2.test") => ({
  state: {
    theme: "light",
    timezone: "UTC",
    userInfo: { email: signedIn },
    zoConfig: { meta_org: "_meta" },
    selectedOrganization: { identifier: selected },
  },
});

// Renders every cell slot and visible row action; the real table lays out nothing in jsdom.
const OTableStub = {
  props: ["data", "columns", "rowActions", "currentPage", "totalCount", "loading", "forbidden"],
  emits: ["pagination-change"],
  template: `<div data-test="user-management-table">
    <slot name="toolbar" />
    <div v-for="row in data" :key="row.id" :data-test="'row-' + row.id">
      <template v-for="col in columns" :key="col.id">
        <slot :name="'cell-' + col.id" :row="row">{{ row[col.accessorKey] }}</slot>
      </template>
      <template v-for="action in rowActions" :key="action.id">
        <button
          v-if="!action.visible || action.visible(row)"
          :data-test="action.dataTest(row)"
          @click="action.onSelect(row)"
        />
      </template>
    </div>
    <slot v-if="!data.length" name="empty" />
  </div>`,
};

const listed = (id: string, email: string, is_external: boolean, orgs: any[] = []) => ({
  id,
  email,
  first_name: "First",
  last_name: "Last",
  is_external,
  created_at: 1,
  orgs,
});

const USERS = [
  listed("u-sso", "sso@acme.com", true, [
    { org_id: "acme", org_name: "Acme Corp", role: "admin" },
    { org_id: "beta", org_name: "Beta Inc", role: "viewer" },
  ]),
  listed("u-local", "local@acme.com", false),
  listed("u-by-email", "Jane@Acme.com", true),
  listed("u-by-domain", "bob@evil.org", true),
  listed("u-native-email", "other@x.com", false),
  listed("u-native-domain", "carl@evil.org", false),
  listed("u-robot", "robot@acme.com", true, [
    { org_id: "acme", org_name: "Acme Corp", role: "service_account" },
  ]),
];

const config = (overrides: Record<string, unknown> = {}) => ({
  data: {
    enabled: true,
    domains: [],
    blocked_emails: ["jane@acme.com", "other@x.com"],
    blocked_domains: ["evil.org"],
    updated_at: 0,
    ...overrides,
  },
});

const mountPage = async (selected = "_meta", signedIn?: string) => {
  const wrapper = mount(UserManagement, {
    global: {
      plugins: [i18n],
      provide: { store: storeFor(selected, signedIn) },
      stubs: { OTable: OTableStub, UserManagementDetailDialog: true },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const blockButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-test="user-management-${id}-block"]`);

describe("UserManagement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    usersService.listAllUsers.mockResolvedValue({ data: { data: USERS, total: 42 } });
    domainService.getDomainRestrictions.mockResolvedValue(config());
    domainService.updateDomainRestrictions.mockResolvedValue({ data: {} });
    orgService.get_admin_org.mockResolvedValue({
      data: { data: [{ identifier: "acme", name: "Acme Corp" }] },
    });
    mockConfirm.mockResolvedValue(true);
  });

  it("leaves for the general page outside the meta org and asks for nothing", async () => {
    await mountPage("acme");

    expect(mockReplace).toHaveBeenCalledWith({
      name: "general",
      query: { org_identifier: "acme" },
    });
    expect(usersService.listAllUsers).not.toHaveBeenCalled();
    expect(domainService.getDomainRestrictions).not.toHaveBeenCalled();
  });

  it("reads the first page and shows each user's organizations", async () => {
    await mountPage();

    expect(usersService.listAllUsers).toHaveBeenCalledWith("_meta", { page: 1, page_size: 20 });
    const row = document.querySelector('[data-test="row-u-sso"]')?.textContent ?? "";
    expect(row).toContain("2 organizations");
    expect(row).toContain("Acme Corp, Beta Inc");
    expect(domainService.getDomainRestrictions).toHaveBeenCalledTimes(1);
  });

  it("sends search and organization to the server and returns to page 1", async () => {
    const wrapper = await mountPage();
    const vm = wrapper.vm as any;
    vm.page = 3;
    await flushPromises();
    expect(usersService.listAllUsers).toHaveBeenLastCalledWith("_meta", { page: 3, page_size: 20 });

    vm.search = " jane ";
    await flushPromises();
    expect(vm.page).toBe(1);
    expect(usersService.listAllUsers).toHaveBeenLastCalledWith("_meta", {
      page: 1,
      page_size: 20,
      search: "jane",
    });

    vm.page = 2;
    await flushPromises();
    vm.orgFilter = "acme";
    await flushPromises();
    expect(vm.page).toBe(1);
    expect(usersService.listAllUsers).toHaveBeenLastCalledWith("_meta", {
      org: "acme",
      page: 1,
      page_size: 20,
      search: "jane",
    });
  });

  it("offers clearing the filters when a filtered search finds nobody", async () => {
    usersService.listAllUsers.mockResolvedValue({ data: { data: [], total: 0 } });
    const wrapper = await mountPage();
    const vm = wrapper.vm as any;
    vm.search = "nobody";
    await flushPromises();

    const empty = wrapper.findComponent({ name: "OEmptyState" });
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    expect(vm.search).toBe("");
    expect(vm.orgFilter).toBeNull();
  });

  it("names email and domain blocks while the config is enabled", async () => {
    const wrapper = await mountPage();
    const state = Object.fromEntries(
      (wrapper.vm as any).rows.map((row: any) => [row.id, row.blockState]),
    );

    expect(state).toEqual({
      "u-sso": "none",
      "u-local": "none",
      "u-by-email": "email",
      "u-by-domain": "domain",
      "u-native-email": "email",
      "u-native-domain": "domain",
      "u-robot": "none",
    });
  });

  it("shows a native user's list entry as applying to SSO sign-in, with Unblock but never Block", async () => {
    const wrapper = await mountPage();

    const badges = wrapper.findAllComponents({ name: "UserBlockStateBadge" });
    const ssoOnly = badges.map((badge) => [badge.props("state"), badge.props("ssoOnly")]);
    expect(ssoOnly).toContainEqual(["email", true]);
    expect(ssoOnly).toContainEqual(["domain", true]);
    expect(ssoOnly).toContainEqual(["email", false]);
    expect(blockButton("u-native-email")).not.toBeNull();
    expect(blockButton("u-native-domain")).toBeNull();
    expect(blockButton("u-local")).toBeNull();
  });

  it("offers no Block on the signed-in operator's own row", async () => {
    await mountPage("_meta", "SSO@acme.com");

    expect(blockButton("u-sso")).toBeNull();
    expect(blockButton("u-robot")).not.toBeNull();
  });

  it("labels machine identities in the type column", async () => {
    await mountPage();

    const tags = (id: string) =>
      document.querySelector(
        `[data-test="row-${id}"] [data-test="user-management-service-account"]`,
      );
    expect(tags("u-robot")).not.toBeNull();
    expect(tags("u-sso")).toBeNull();
  });

  it("shows nobody blocked while the config is disabled", async () => {
    domainService.getDomainRestrictions.mockResolvedValue(config({ enabled: false }));
    const wrapper = await mountPage();

    expect((wrapper.vm as any).rows.every((row: any) => row.blockState === "none")).toBe(true);
  });

  it("offers Block to unblocked SSO users, Unblock to email blocks, and nothing to domain blocks", async () => {
    await mountPage();

    expect(blockButton("u-sso")).not.toBeNull();
    expect(blockButton("u-local")).toBeNull();
    expect(blockButton("u-by-email")).not.toBeNull();
    expect(blockButton("u-by-domain")).toBeNull();
  });

  it("blocks after confirming, from a fresh read, with the email added and the config enabled", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountPage();
    domainService.getDomainRestrictions.mockResolvedValue(
      config({ blocked_emails: ["fresh@x.com"] }),
    );

    blockButton("u-sso")!.click();
    await flushPromises();

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(domainService.getDomainRestrictions).toHaveBeenCalledTimes(3);
    expect(domainService.updateDomainRestrictions).toHaveBeenCalledWith("_meta", {
      domains: [],
      blocked_domains: ["evil.org"],
      blocked_emails: ["fresh@x.com", "sso@acme.com"],
      enabled: true,
    });
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "sso@acme.com is blocked",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: domainManagementKeys.all("_meta") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.usersAll("_meta") });
  });

  it("writes nothing when the user cancels the confirmation", async () => {
    mockConfirm.mockResolvedValue(false);
    await mountPage();

    blockButton("u-sso")!.click();
    await flushPromises();

    expect(domainService.updateDomainRestrictions).not.toHaveBeenCalled();
  });

  it("refuses to block when enabling the config would switch on its allow-list", async () => {
    await mountPage();
    domainService.getDomainRestrictions.mockResolvedValue(
      config({
        enabled: false,
        domains: [{ domain: "acme.com", allow_all_users: true, allowed_emails: [] }],
      }),
    );

    blockButton("u-sso")!.click();
    await flushPromises();

    expect(domainService.updateDomainRestrictions).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "warning",
        message: expect.stringContaining("SSO Management"),
      }),
    );
  });

  it("unblocks without asking, from a fresh read, with every spelling of the email removed", async () => {
    await mountPage();
    domainService.getDomainRestrictions.mockResolvedValue(
      config({ blocked_emails: ["JANE@acme.com", "other@x.com"] }),
    );

    blockButton("u-by-email")!.click();
    await flushPromises();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(domainService.updateDomainRestrictions).toHaveBeenCalledWith("_meta", {
      domains: [],
      blocked_domains: ["evil.org"],
      blocked_emails: ["other@x.com"],
      enabled: true,
    });
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Jane@Acme.com is unblocked",
    });
  });

  it("shows the server's message when the write fails, or a fallback", async () => {
    await mountPage();
    domainService.updateDomainRestrictions.mockRejectedValueOnce({
      response: { data: { message: "blocklist is locked" } },
    });
    blockButton("u-sso")!.click();
    await flushPromises();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "blocklist is locked",
    });

    domainService.updateDomainRestrictions.mockRejectedValueOnce(new Error("network"));
    blockButton("u-sso")!.click();
    await flushPromises();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "Could not update the SSO blocklist",
    });
  });

  it("opens the detail dialog from the row's data without another request", async () => {
    const wrapper = await mountPage();
    const calls = usersService.listAllUsers.mock.calls.length;

    document.querySelector<HTMLButtonElement>('[data-test="user-management-u-sso-view"]')!.click();
    await flushPromises();

    const dialog = wrapper.findComponent({ name: "UserManagementDetailDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("user")).toMatchObject({ id: "u-sso", orgs: USERS[0].orgs });
    expect(dialog.props("blockState")).toBe("none");
    expect(usersService.listAllUsers.mock.calls.length).toBe(calls);
  });

  it("shows the forbidden state when the listing is refused", async () => {
    usersService.listAllUsers.mockRejectedValue({ response: { status: 403, data: {} } });
    const wrapper = await mountPage();

    const table = wrapper.findComponent(OTableStub);
    expect(table.props("forbidden")).toBe(true);
    expect(table.props("loading")).toBe(false);
  });

  it("forces every read on the screen on refresh", async () => {
    const wrapper = await mountPage();
    vi.clearAllMocks();

    (wrapper.vm as any).refresh();
    await flushPromises();

    expect(usersService.listAllUsers).toHaveBeenCalledTimes(1);
    expect(domainService.getDomainRestrictions).toHaveBeenCalledTimes(1);
    expect(orgService.get_admin_org).toHaveBeenCalledTimes(1);
  });
});
