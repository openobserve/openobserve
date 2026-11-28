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
import { flushPromises, mount } from "@vue/test-utils";
import SecretsPage from "./SecretsPage.vue";
import secrets, { type OrgStoreStatus, type SecretListItem } from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import users from "@/services/users";
import router from "@/test/unit/helpers/router";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: {
      list: vi.fn(),
      status: vi.fn(),
      prescan: vi.fn(),
    },
  };
});

vi.mock("@/services/users", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, orgUsers: vi.fn() } };
});

const row = (over: Partial<SecretListItem>): SecretListItem => ({
  id: "id-1",
  name: "PAGERDUTY_ROUTING_KEY",
  kind: "secret",
  description: "PagerDuty service: checkout",
  state: "active",
  allowed_types: ["alert_destination"],
  selected_count: 0,
  allowed_hosts: ["events.pagerduty.com"],
  pin_mode: "hosts",
  private_locations: "off",
  envs: [{ env: "_org", state: "set", value_version: 1 }],
  usage_count: 2,
  source: "local",
  updated_at: Date.now() * 1000,
  updated_by: "priya@acme.io",
  ...over,
});

const OTableStub = {
  name: "OTableStub",
  props: ["data", "columns"],
  template: `<div data-test="table-stub">
    <slot name="toolbar" />
    <div v-for="r in data" :key="r.id" :data-test="'row-' + r.name">
      <slot name="cell-name" :row="r" />
      <slot name="cell-allowed" :row="r" />
      <slot name="cell-envs" :row="r" />
      <slot name="cell-pin" :row="r" />
      <slot name="cell-value" :row="r" />
      <slot name="cell-updated" :row="r" />
    </div>
    <slot v-if="!data.length" name="empty" />
  </div>`,
};

const mountPage = () =>
  mount(SecretsPage, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { OTable: OTableStub, ORefreshButton: true },
    },
  });

const mockStore = (opts: {
  secrets?: SecretListItem[];
  variables?: SecretListItem[];
  fga?: "on" | "off";
  ready?: boolean;
  prescan?: any[] | "forbidden";
  canCreate?: boolean;
  notReadyReason?: OrgStoreStatus["not_ready_reason"];
  mode?: OrgStoreStatus["mode"];
}) => {
  vi.mocked(secrets.list).mockImplementation(
    async (_org, params) =>
      ({
        data: {
          items: params?.kind === "variable" ? (opts.variables ?? []) : (opts.secrets ?? []),
        },
      }) as any,
  );
  vi.mocked(secrets.status).mockResolvedValue({
    data: {
      mode: opts.mode ?? "single_cluster",
      region: "",
      store_ready: opts.ready ?? true,
      not_ready_reason: opts.notReadyReason ?? "",
      fga: opts.fga ?? "on",
      can_create: opts.canCreate ?? true,
    },
  } as any);
  if (opts.prescan === "forbidden") {
    vi.mocked(secrets.prescan).mockRejectedValue({ response: { status: 403 } });
  } else {
    vi.mocked(secrets.prescan).mockResolvedValue({ data: { items: opts.prescan ?? [] } } as any);
  }
};

describe("SecretsPage", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("lists secrets with their pin and private-location badges", async () => {
    mockStore({
      secrets: [
        row({}),
        row({
          id: "2",
          name: "SERVICENOW_BASIC",
          pin_mode: "any",
          pin_override_reason: "migrating",
        }),
        row({ id: "3", name: "SNOW_CHANGES_BASIC", pin_mode: "none", allowed_hosts: [] }),
        row({ id: "4", name: "API_TOKEN", private_locations: "on" }),
        row({ id: "5", name: "O2S__DB_PASSWORD", pin_mode: "legacy", private_locations: "legacy" }),
      ],
    });
    const w = mountPage();
    await flushPromises();

    expect(secrets.list).toHaveBeenCalledWith("default", { kind: "secret", limit: 100 });
    expect(w.find("[data-test='row-PAGERDUTY_ROUTING_KEY']").text()).toContain(
      "events.pagerduty.com",
    );
    expect(w.find("[data-test='row-PAGERDUTY_ROUTING_KEY']").text()).toContain(
      "All alert destinations",
    );
    expect(
      w.find("[data-test='secrets-page-row-SERVICENOW_BASIC-badge-any-host']").text(),
    ).toContain("Any host");
    expect(
      w.find("[data-test='secrets-page-row-SNOW_CHANGES_BASIC-badge-not-pinned']").text(),
    ).toContain("can't be used yet");
    expect(
      w.find("[data-test='secrets-page-row-API_TOKEN-badge-private-locations']").exists(),
    ).toBe(true);
    expect(w.find("[data-test='secrets-page-row-O2S__DB_PASSWORD-badge-legacy']").text()).toContain(
      "Legacy · no pin",
    );
    expect(
      w
        .find("[data-test='secrets-page-row-O2S__DB_PASSWORD-badge-private-locations-legacy']")
        .exists(),
    ).toBe(true);
    w.unmount();
  });

  it("asks the server for deleted rows only when Show deleted is on", async () => {
    mockStore({ secrets: [row({})] });
    vi.mocked(secrets.list).mockImplementation(
      async (_org, params) =>
        ({
          data: {
            items: params?.deleted
              ? [row({ id: "2", name: "OLD_KEY", state: "deleted" })]
              : params?.kind === "secret"
                ? [row({})]
                : [],
          },
        }) as any,
    );
    const w: any = mountPage();
    await flushPromises();
    expect(secrets.list).not.toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ deleted: true }),
    );
    expect(w.find("[data-test='row-OLD_KEY']").exists()).toBe(false);
    w.vm.$.setupState.showDeleted = true;
    await flushPromises();
    expect(secrets.list).toHaveBeenCalledWith("default", {
      kind: "secret",
      limit: 100,
      deleted: true,
    });
    expect(w.find("[data-test='secrets-page-row-OLD_KEY-badge-deleted']").exists()).toBe(true);
    w.unmount();
  });

  it("shows who updated each row and when", async () => {
    mockStore({ secrets: [row({})] });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='row-PAGERDUTY_ROUTING_KEY']").text()).toContain("priya@acme.io");
    w.unmount();
  });

  it("shows variable values but never a secret value", async () => {
    mockStore({
      secrets: [row({ value: undefined })],
      variables: [
        row({ id: "v", name: "BASE_URL", kind: "variable", value: "https://shop.acme.io" }),
      ],
    });
    const w: any = mountPage();
    await flushPromises();
    expect(w.text()).not.toContain("https://shop.acme.io");
    w.vm.activeKind = "variable";
    await flushPromises();
    expect(w.find("[data-test='row-BASE_URL']").text()).toContain("https://shop.acme.io");
    w.unmount();
  });

  it("shows the FGA-off banner when the status says fga off", async () => {
    mockStore({ fga: "off" });
    const w = mountPage();
    await flushPromises();
    const banner = w.find("[data-test='secrets-page-fga-off-banner']");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Only org admins can create, use or manage secrets");
    w.unmount();
  });

  it("keeps upgrade copy for an empty not_ready_reason while store_ready is false", async () => {
    mockStore({ ready: false });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-not-ready-banner']").text()).toContain("getting ready");
    w.unmount();
  });

  it("names the enable flag when not_ready_reason is refs_disabled", async () => {
    mockStore({ ready: false, notReadyReason: "refs_disabled" });
    const w = mountPage();
    await flushPromises();
    const banner = w.find("[data-test='secrets-page-not-ready-banner']").text();
    expect(banner).toContain("not enabled on this cluster");
    expect(banner).toContain("admin");
    expect(banner).toContain("O2_SECRET_STORE_REFS_ENABLED");
    expect(banner).not.toContain("upgrade in progress");
    w.unmount();
  });

  it.each([{ notReadyReason: "super_cluster" as const }, { mode: "super_cluster" as const }])(
    "explains super-cluster unavailability for %j",
    async (reason) => {
      mockStore({ ready: false, ...reason });
      const w = mountPage();
      await flushPromises();
      const banner = w.find("[data-test='secrets-page-not-ready-banner']").text();
      expect(banner).toContain("not available in super-cluster deployments yet");
      expect(banner).not.toContain("upgrade in progress");
      w.unmount();
    },
  );

  it("asks an admin to align permission mode for fga_mode_mismatch", async () => {
    mockStore({ ready: false, notReadyReason: "fga_mode_mismatch" });
    const w = mountPage();
    await flushPromises();
    const banner = w.find("[data-test='secrets-page-not-ready-banner']").text();
    expect(banner).toContain("Nodes disagree");
    expect(banner).toContain("permission (OpenFGA) mode");
    expect(banner).toContain("Ask an admin to align");
    expect(banner).not.toContain("upgrade in progress");
    w.unmount();
  });

  it("hides the not-ready banner when the store is ready", async () => {
    mockStore({ ready: true, notReadyReason: "" });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-not-ready-banner']").exists()).toBe(false);
    w.unmount();
  });

  it("keeps upgrade copy for the explicit upgrading reason", async () => {
    mockStore({ ready: false, notReadyReason: "upgrading" });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-not-ready-banner']").text()).toContain(
      "cluster upgrade in progress",
    );
    w.unmount();
  });

  it("shows no FGA banner when fga is on", async () => {
    mockStore({ fga: "on" });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-fga-off-banner']").exists()).toBe(false);
    w.unmount();
  });

  it("shows the prescan banner and lists the hits on demand", async () => {
    mockStore({
      prescan: [
        {
          consumer_type: "alert_destination",
          consumer_id: "pd-checkout",
          field: "headers.Authorization",
          token: "{{secrets.PD_KEY}}",
        },
      ],
    });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-prescan-banner']").text()).toContain(
      "1 consumer field holds secret reference text",
    );
    expect(w.find("[data-test='secrets-page-prescan-list']").exists()).toBe(false);
    await w.find("[data-test='secrets-page-prescan-toggle']").trigger("click");
    expect(w.find("[data-test='secrets-page-prescan-list']").text()).toContain(
      "pd-checkout · headers.Authorization · {{secrets.PD_KEY}}",
    );
    w.unmount();
  });

  it("shows no prescan banner when the caller may not read prescan rows", async () => {
    mockStore({ prescan: "forbidden" });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-prescan-banner']").exists()).toBe(false);
    w.unmount();
  });

  it("never names a region in a single cluster", async () => {
    mockStore({ secrets: [row({})], fga: "off" });
    const w = mountPage();
    await flushPromises();
    expect(w.text().toLowerCase()).not.toContain("region");
    w.unmount();
  });

  it("shows Connect backend to an org admin whose role only the org user list carries", async () => {
    store.state.currentuser.role = "";
    vi.mocked(users.orgUsers).mockResolvedValue({
      data: { data: [{ email: "example@gmail.com", role: "root" }] },
    } as any);
    mockStore({});
    const w: any = mountPage();
    await flushPromises();
    w.vm.tab = "backends";
    await flushPromises();
    expect(w.find("[data-test='secrets-page-connect-backend-btn']").exists()).toBe(true);
    w.unmount();
  });

  it("offers no create to a member without a create grant and says rows may be hidden", async () => {
    store.state.currentuser.role = "";
    vi.mocked(users.orgUsers).mockResolvedValue({
      data: { data: [{ email: "example@gmail.com", role: "user" }] },
    } as any);
    mockStore({ canCreate: false });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-new-btn']").exists()).toBe(false);
    const empty = w.find("[data-test='secrets-page-empty']");
    expect(empty.text()).not.toContain("No secrets yet");
    expect(empty.text()).toContain("No secrets you can see");
    expect(empty.text()).not.toContain("New secret");
    expect(empty.text()).not.toContain("New variable");
    w.unmount();
  });

  it("offers create to a member with a create grant", async () => {
    store.state.currentuser.role = "";
    vi.mocked(users.orgUsers).mockResolvedValue({
      data: { data: [{ email: "example@gmail.com", role: "user" }] },
    } as any);
    mockStore({ canCreate: true });
    const w = mountPage();
    await flushPromises();
    expect(w.find("[data-test='secrets-page-new-btn']").exists()).toBe(true);
    expect(w.find("[data-test='secrets-page-empty']").text()).toContain("New secret");
    w.unmount();
  });

  it("left-aligns the name and fits every column beside the actions at 1440 px", async () => {
    mockStore({ secrets: [row({})], variables: [row({ id: "v", kind: "variable", value: "x" })] });
    const w: any = mountPage();
    await flushPromises();
    const name = w.find("[data-test='secrets-page-row-PAGERDUTY_ROUTING_KEY-name']");
    expect(name.classes()).toContain("text-start");
    // The table gets about 1100 px at a 1440 px window, next to the nav rail and settings menu.
    const width = () =>
      w
        .findComponent({ name: "OTableStub" })
        .props("columns")
        .reduce((sum: number, c: any) => sum + (c.isAction ? 80 : (c.size ?? 0)), 0);
    expect(width()).toBeLessThanOrEqual(1100);
    w.vm.tab = "variable";
    await flushPromises();
    expect(width()).toBeLessThanOrEqual(1100);
    const updated = w.findAll("[data-test='secrets-page-row-updated']");
    expect(updated.length).toBeGreaterThan(0);
    w.unmount();
  });

  it("hides Connect backend from a member", async () => {
    store.state.currentuser.role = "";
    vi.mocked(users.orgUsers).mockResolvedValue({
      data: { data: [{ email: "example@gmail.com", role: "user" }] },
    } as any);
    mockStore({});
    const w: any = mountPage();
    await flushPromises();
    w.vm.tab = "backends";
    await flushPromises();
    expect(w.find("[data-test='secrets-page-connect-backend-btn']").exists()).toBe(false);
    w.unmount();
  });
});
