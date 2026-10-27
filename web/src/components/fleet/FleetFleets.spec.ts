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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet, { type Fleet, type FleetState } from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetFleets from "./FleetFleets.vue";
import { apiCollector, apiFleet, apiRollout } from "./fleet.fixtures";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listFleets: vi.fn(),
    listCollectors: vi.fn(),
    listRollouts: vi.fn(),
    getRollout: vi.fn(),
  },
}));

const RailStub = defineComponent({
  name: "FleetRail",
  props: ["rows", "activeId", "loading", "error", "forbidden"],
  emits: ["select", "retry"],
  setup(_props, { expose }) {
    expose({ create: createMock });
    return () => null;
  },
});

const CollectorsStub = {
  name: "FleetCollectors",
  props: ["fleetId", "forbidden", "allFleets"],
  emits: ["update:allFleets"],
  template: "<div />",
};
const DialogStub = {
  name: "FleetNewRolloutDialog",
  props: ["open", "fleetId"],
  template: "<div />",
};
const RolloutsStub = {
  name: "FleetRollouts",
  props: ["open", "fleetId", "fleetName", "rolloutId"],
  emits: ["update:open", "update:rolloutId", "fix-forward", "navigate"],
  template: "<div />",
};
const InstallStub = { name: "FleetInstallDialog", props: ["open", "fleetId"], template: "<div />" };
const TokensStub = {
  name: "FleetTokens",
  props: ["open", "fleetId", "fleetName"],
  template: "<div />",
};
const SettingsStub = {
  name: "FleetFleetSettingsDrawer",
  props: ["open", "fleetId", "fleetName"],
  template: "<div />",
};

const stubs = {
  FleetRail: RailStub,
  FleetCollectors: CollectorsStub,
  FleetNewRolloutDialog: DialogStub,
  FleetRollouts: RolloutsStub,
  FleetInstallDialog: InstallStub,
  FleetTokens: TokensStub,
  FleetFleetSettingsDrawer: SettingsStub,
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "fleet", component: { template: "<div />" } },
    { path: "/editor/:id", name: "fleetConfigEditor", component: { template: "<div />" } },
  ],
});

const fleetRow = (id: string, state: Partial<FleetState> | null = {}): Fleet =>
  apiFleet({
    id,
    name: id === "f1" ? "edge" : id,
    state:
      state === null
        ? null
        : {
            desired: { config: "edge-config", version: 3 },
            stable: { config: "edge-config", version: 2 },
            rollout: { id: "r1", status: "in_progress" },
            collectors: 2,
            online: 1,
            at_desired: 1,
            ...state,
          },
  });

async function mountAt(
  fleetId: string | null,
  fleets: Fleet[] = [fleetRow("f1")],
  extra: Record<string, string> = {},
) {
  vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: fleets } } as any);
  await router.push({
    name: "fleet",
    query: { tab: "fleets", ...(fleetId ? { fleet: fleetId } : {}), ...extra },
  });
  const w = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs } });
  await flushPromises();
  return w;
}

const btn = (w: VueWrapper, id: string) => w.find(`[data-test="fleet-fleets-${id}"]`);
const query = () => router.currentRoute.value.query;

describe("FleetFleets", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 1, items: [apiCollector({ fleet: { id: "f1", name: "edge" } })] },
    } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: {
        items: [
          apiRollout({
            id: "r1",
            fleet: { id: "f1", name: "edge" },
            status: "in_progress",
            total: 40,
            running: 28,
          }),
        ],
      },
    } as any);
    vi.mocked(fleet.getRollout).mockRejectedValue({ response: { status: 404 } });
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("feeds the fleet rail from fleet/fleets and creates through it", async () => {
    wrapper = await mountAt("f1");
    const rail = wrapper.findComponent(RailStub);
    expect(rail.props("rows").map((f: { id: string }) => f.id)).toEqual(["f1"]);
    expect(rail.props("activeId")).toBe("f1");
    (wrapper.vm as unknown as { create: () => void }).create();
    expect(createMock).toHaveBeenCalled();
  });

  it("shows desired and stable cards, the members and the rollout's progress in collectors", async () => {
    wrapper = await mountAt("f1");
    expect(btn(wrapper, "desired").text()).toBe("edge-config v3");
    expect(btn(wrapper, "stable").text()).toBe("edge-config v2");
    expect(btn(wrapper, "members").text()).toBe("1 of 2 online");
    expect(btn(wrapper, "rollout-progress").text()).toContain("28 of 40 running the new version");
  });

  it("says a fleet without a version runs the placeholder configuration", async () => {
    wrapper = await mountAt("f1", [fleetRow("f1", { desired: null, stable: null, rollout: null })]);
    expect(btn(wrapper, "desired").text()).toBe("No configuration assigned");
    expect(btn(wrapper, "desired-card").text()).toContain("placeholder configuration");
    expect(btn(wrapper, "rollout-progress").exists()).toBe(false);
  });

  it("follows the rail's selection through ?fleet=, dropping scope and rollout", async () => {
    wrapper = await mountAt("f1", [fleetRow("f1"), fleetRow("f2")], { scope: "all" });
    wrapper.findComponent(RailStub).vm.$emit("select", "f2");
    await flushPromises();
    expect(query().fleet).toBe("f2");
    expect(query().scope).toBeUndefined();
  });

  it("lands on the first listed fleet when default is not listed", async () => {
    wrapper = await mountAt(null, [fleetRow("f1")]);
    expect(query().fleet).toBe("f1");
  });

  it("opens each panel action on this fleet", async () => {
    wrapper = await mountAt("f1");
    await btn(wrapper, "add-collector").trigger("click");
    await btn(wrapper, "tokens").trigger("click");
    await btn(wrapper, "settings").trigger("click");
    await btn(wrapper, "change-version").trigger("click");
    for (const stub of [InstallStub, TokensStub, SettingsStub, DialogStub]) {
      const c = wrapper.findComponent(stub);
      expect(c.props("open"), stub.name).toBe(true);
      expect(c.props("fleetId"), stub.name).toBe("f1");
    }
  });

  it("offers no retry or rollback on the panel, since exits live in the rollout", async () => {
    wrapper = await mountAt("f1", [fleetRow("f1", { rollout: { id: "r1", status: "halted" } })]);
    expect(btn(wrapper, "retry").exists()).toBe(false);
    expect(btn(wrapper, "rollback").exists()).toBe(false);
  });

  it("opens the active rollout from the desired card and writes ?rollout=", async () => {
    wrapper = await mountAt("f1");
    await btn(wrapper, "open-rollout").trigger("click");
    await flushPromises();
    expect(wrapper.findComponent(RolloutsStub).props("open")).toBe(true);
    expect(query().rollout).toBe("r1");
  });

  it("selects the rollout's own fleet when a ?rollout= link has none", async () => {
    wrapper = await mountAt(null, [fleetRow("default"), fleetRow("f1")], { rollout: "r1" });
    await flushPromises();
    expect(query().fleet).toBe("f1");
  });

  it("opens the editor of the rollout's configuration on fix forward", async () => {
    wrapper = await mountAt("f1", undefined, { org_identifier: "acme" });
    wrapper
      .findComponent(RolloutsStub)
      .vm.$emit("fix-forward", { id: "r1", config: "edge-config" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("fleetConfigEditor");
    expect(router.currentRoute.value.params.id).toBe("edge-config");
    expect(router.currentRoute.value.query.org_identifier).toBe("acme");
  });

  it("drops ?rollout= when the drawer closes", async () => {
    wrapper = await mountAt("f1", undefined, { rollout: "r1" });
    wrapper.findComponent(RolloutsStub).vm.$emit("update:open", false);
    await flushPromises();
    expect(query().rollout).toBeUndefined();
  });

  it("shows a fleet the user may list but not read as no access", async () => {
    wrapper = await mountAt("f1", [fleetRow("f1", null)]);
    expect(btn(wrapper, "no-access").exists()).toBe(true);
    expect(btn(wrapper, "change-version").exists()).toBe(false);
    expect(wrapper.findComponent(CollectorsStub).props("forbidden")).toBe(true);
  });

  it("shows a fleet missing from the list as not found", async () => {
    wrapper = await mountAt("gone", [fleetRow("f1")]);
    expect(btn(wrapper, "not-found").exists()).toBe(true);
  });

  it("shows the load error and no access on a 403", async () => {
    vi.mocked(fleet.listFleets).mockRejectedValue(new Error("boom"));
    await router.push({ name: "fleet", query: { fleet: "f1" } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs } });
    await flushPromises();
    expect(btn(wrapper, "load-error").exists()).toBe(true);
    wrapper.unmount();
    queryClient.clear();
    vi.mocked(fleet.listFleets).mockRejectedValue({ response: { status: 403 } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs } });
    await flushPromises();
    expect(btn(wrapper, "no-access").exists()).toBe(true);
    expect(wrapper.findComponent(RailStub).props("forbidden")).toBe(true);
  });

  it("hides the panel in All mode and writes ?scope=all from the table", async () => {
    wrapper = await mountAt("f1");
    wrapper.findComponent(CollectorsStub).vm.$emit("update:allFleets", true);
    await flushPromises();
    expect(query().scope).toBe("all");
    expect(btn(wrapper, "panel").exists()).toBe(false);
    expect(wrapper.findComponent(CollectorsStub).props("allFleets")).toBe(true);
  });
});
