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
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetFleets from "./FleetFleets.vue";

const { toastMock, addFolderMock, confirmMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  addFolderMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

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
    setDesired: vi.fn(),
  },
}));

const FolderListStub = defineComponent({
  name: "FolderList",
  props: ["type"],
  emits: ["update:activeFolderId", "update:folders"],
  setup(_props, { expose }) {
    expose({ addFolder: addFolderMock });
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
  props: ["open", "fleetId", "retryOf"],
  template: "<div />",
};

const RolloutsStub = {
  name: "FleetRollouts",
  props: ["open", "fleetId", "fleetName", "rolloutId", "stable"],
  emits: ["update:open", "update:rolloutId", "revert", "retry", "navigate"],
  template: "<div />",
};

const InstallStub = { name: "FleetInstallDialog", props: ["open", "fleetId"], template: "<div />" };

const TokensStub = {
  name: "FleetTokens",
  props: ["open", "fleetId", "fleetName"],
  template: "<div />",
};

const panelStubs = {
  FolderList: FolderListStub,
  FleetCollectors: CollectorsStub,
  FleetNewRolloutDialog: DialogStub,
  FleetRollouts: RolloutsStub,
  FleetInstallDialog: InstallStub,
  FleetTokens: TokensStub,
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", name: "fleet", component: { template: "<div />" } }],
});

const apiFleet = (over: Record<string, unknown> = {}, id = "f1", name = "edge") => ({
  id,
  name,
  state: {
    desired: { config: "edge-config", version: 3 },
    stable: { config: "edge-config", version: 2 } as { config: string; version: number } | null,
    revision: { id: "r1", status: "in_progress" },
    collectors: 2,
    online: 1,
    at_desired: 1,
    ...over,
  },
});

const apiCollector = (id: string, fleetId: string) => ({
  id,
  name: `host-${id}`,
  hostname: null,
  ip: null,
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: null,
  version: null,
  outdated: false,
  config: "edge-config",
  config_version: 2,
  delivery: "running",
  drifted: false,
  fleet: { id: fleetId, name: fleetId },
  token_id: null,
  last_seen: Date.now(),
  enrolled_at: Date.now(),
});

const org = () => store.state.selectedOrganization.identifier;

async function mountAt(
  fleetId: string | null,
  fleets = [apiFleet()],
  extra: Record<string, string> = {},
) {
  vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: fleets } } as any);
  await router.push({
    name: "fleet",
    query: { tab: "fleets", ...(fleetId ? { folder: fleetId } : {}), ...extra },
  });
  const w = mount(FleetFleets, {
    global: {
      plugins: [i18n, router, store],
      stubs: panelStubs,
    },
  });
  await flushPromises();
  return w;
}

const apiRollout = (id: string, fleetId: string, status = "halted") => ({
  id,
  kind: "config",
  config: "edge-config",
  from_version: 2,
  to_version: 3,
  fleet: { id: fleetId, name: fleetId },
  strategy: "canary",
  status,
  total: 2,
  attempted: 1,
  accepted: 0,
  failed: 1,
  assigned: 1,
  started_at: 1,
  scheduled_for: null,
  started_by: "ana@acme.io",
  auto_rollback: true,
  phases: [],
  gates: [],
  failure: null,
  events: [],
});

const btn = (w: VueWrapper, id: string) => w.find(`[data-test="fleet-fleets-${id}"]`);
const collectors = (w: VueWrapper) => w.findComponent(CollectorsStub);
const query = () => router.currentRoute.value.query;
const pick = async (w: VueWrapper, id: string) => {
  w.findComponent(FolderListStub).vm.$emit("update:activeFolderId", id);
  await flushPromises();
};

describe("FleetFleets", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: {
        total: 3,
        items: [apiCollector("c1", "f1"), apiCollector("c2", "f1"), apiCollector("c3", "default")],
      },
    } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
    vi.mocked(fleet.getRollout).mockRejectedValue({ response: { status: 404 } });
    vi.mocked(fleet.setDesired).mockResolvedValue({ data: { id: "r2" } } as any);
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("puts the shared fleet rail on the left with type fleets", async () => {
    wrapper = await mountAt("f1");
    expect(wrapper.findComponent(FolderListStub).props("type")).toBe("fleets");
  });

  it("opens the rail's add-fleet dialog from create()", async () => {
    wrapper = await mountAt("f1");
    (wrapper.vm as unknown as { create: () => void }).create();
    expect(addFolderMock).toHaveBeenCalled();
  });

  it("shows the fleet's desired and stable versions, its latest revision and how many are at desired", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r1", "f1", "in_progress")] },
    } as any);
    wrapper = await mountAt("f1");
    expect(btn(wrapper, "desired").text()).toBe("edge-config v3");
    expect(btn(wrapper, "stable").text()).toBe("v2");
    expect(btn(wrapper, "revision-status").text()).toBe("In progress");
    expect(btn(wrapper, "members").text()).toContain("1 of 2 online");
    expect(btn(wrapper, "members").text()).toContain("1 of 2 at the desired version");
  });

  it("says the latest rollout targeted no collectors when the fleet was empty", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: {
        items: [
          {
            ...apiRollout("r1", "f1", "completed"),
            total: 0,
            attempted: 0,
            accepted: 0,
            failed: 0,
            assigned: 0,
          },
        ],
      },
    } as any);
    wrapper = await mountAt("f1", [apiFleet({ revision: { id: "r1", status: "completed" } })]);
    expect(btn(wrapper, "panel").text()).toContain("No collectors targeted");
    expect(btn(wrapper, "panel").text()).not.toContain("0 of 0");
    const tag = btn(wrapper, "revision-status");
    expect(tag.text()).toBe("No collectors targeted");
    expect(tag.text()).not.toContain("Completed");
  });

  it("shows a spinner in the panel while the fleets load", async () => {
    vi.mocked(fleet.listFleets).mockReturnValue(new Promise(() => {}) as any);
    await router.push({ name: "fleet", query: { tab: "fleets", folder: "f1" } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs: panelStubs } });
    await flushPromises();
    expect(btn(wrapper, "loading").exists()).toBe(true);
    expect(btn(wrapper, "panel").exists()).toBe(false);
  });

  it("shows the fleets load error with a retry, and no access on a 403", async () => {
    vi.mocked(fleet.listFleets).mockRejectedValue(new Error("boom"));
    await router.push({ name: "fleet", query: { tab: "fleets", folder: "f1" } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs: panelStubs } });
    await flushPromises();
    expect(btn(wrapper, "load-error").exists()).toBe(true);
    vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: [apiFleet()] } } as any);
    wrapper
      .find('[data-test="fleet-fleets-load-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await flushPromises();
    expect(btn(wrapper, "panel").exists()).toBe(true);
    wrapper.unmount();
    queryClient.clear();
    vi.mocked(fleet.listFleets).mockRejectedValue({ response: { status: 403 } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs: panelStubs } });
    await flushPromises();
    expect(btn(wrapper, "no-access").exists()).toBe(true);
    expect(btn(wrapper, "no-access").text()).toContain(
      "Contact your administrator if you believe you should have access.",
    );
    expect(btn(wrapper, "no-access").text()).not.toContain("You can see this fleet");
  });

  it("follows the rail's fleet selection", async () => {
    wrapper = await mountAt("f1", [apiFleet(), apiFleet({}, "f2", "core")]);
    wrapper.findComponent(FolderListStub).vm.$emit("update:activeFolderId", "f2");
    await flushPromises();
    expect(router.currentRoute.value.query.folder).toBe("f2");
    expect(btn(wrapper, "name").text()).toBe("core");
  });

  it("lands on the first listed fleet when default is not listed", async () => {
    wrapper = await mountAt("default");
    expect(router.currentRoute.value.query.folder).toBe("f1");
    expect(btn(wrapper, "name").text()).toBe("edge");
  });

  it("refetches the fleets when the rail refreshes the shared list, as after a delete", async () => {
    wrapper = await mountAt("f1");
    await store.dispatch("setFoldersByType", {
      fleets: [{ folderId: "f1" }, { folderId: "f2" }],
    });
    await flushPromises();
    const before = vi.mocked(fleet.listFleets).mock.calls.length;
    await store.dispatch("setFoldersByType", { fleets: [{ folderId: "f1" }] });
    await flushPromises();
    expect(vi.mocked(fleet.listFleets).mock.calls.length).toBe(before + 1);
  });

  it("keeps Change version outlined and the standing actions quieter, and Retry and Revert outlined when halted", async () => {
    const variant = (id: string) =>
      wrapper
        .findAllComponents({ name: "OButton" })
        .find((b) => b.attributes("data-test") === `fleet-fleets-${id}`)!
        .props("variant");
    wrapper = await mountAt("f1", [apiFleet({ stable: { config: "edge-config", version: 3 } })]);
    expect(btn(wrapper, "retry").exists()).toBe(false);
    expect(btn(wrapper, "revert").exists()).toBe(false);
    expect(variant("change-version")).toBe("outline");
    for (const id of ["add-collector", "tokens", "rollouts"]) expect(variant(id)).toBe("ghost");
    expect(variant("open-revision")).toBe("ghost-primary");
    wrapper.unmount();
    queryClient.clear();
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r1", "f1")] },
    } as any);
    wrapper = await mountAt("f1", [apiFleet({ revision: { id: "r1", status: "halted" } })]);
    expect(variant("retry")).toBe("outline");
    expect(variant("revert")).toBe("outline");
  });

  it("adds a collector to this fleet from the panel", async () => {
    wrapper = await mountAt("f1");
    const dialog = wrapper.findComponent(InstallStub);
    expect(dialog.props()).toMatchObject({ open: false, fleetId: "f1" });
    expect(btn(wrapper, "add-collector").text()).toBe("Add collector");
    await btn(wrapper, "add-collector").trigger("click");
    expect(dialog.props()).toMatchObject({ open: true, fleetId: "f1" });
  });

  it.each([
    ["an unknown fleet", "nope", [apiFleet()]],
    ["a fleet the user cannot read", "f1", [{ id: "f1", name: "edge", state: null }]],
  ])("offers no Add collector or Tokens for %s", async (_what, folder, fleets) => {
    wrapper = await mountAt(folder, fleets as any);
    expect(btn(wrapper, "add-collector").exists()).toBe(false);
    expect(btn(wrapper, "tokens").exists()).toBe(false);
  });

  it("offers no Add collector or Tokens while the fleets load", async () => {
    vi.mocked(fleet.listFleets).mockReturnValue(new Promise(() => {}) as any);
    await router.push({ name: "fleet", query: { tab: "fleets", folder: "f1" } });
    wrapper = mount(FleetFleets, { global: { plugins: [i18n, router, store], stubs: panelStubs } });
    await flushPromises();
    expect(btn(wrapper, "add-collector").exists()).toBe(false);
    expect(btn(wrapper, "tokens").exists()).toBe(false);
  });

  it("opens this fleet's tokens from the panel", async () => {
    wrapper = await mountAt("f1");
    const drawer = wrapper.findComponent(TokensStub);
    expect(drawer.props("open")).toBe(false);
    await btn(wrapper, "tokens").trigger("click");
    expect(drawer.props()).toMatchObject({ open: true, fleetId: "f1", fleetName: "edge" });
  });

  it("opens the set-desired dialog fixed to the fleet from Change version", async () => {
    wrapper = await mountAt("f1");
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("open")).toBe(false);
    await btn(wrapper, "change-version").trigger("click");
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("fleetId")).toBe("f1");
  });

  it("reverts to the stable version with an immediate PUT", async () => {
    wrapper = await mountAt("f1");
    expect(btn(wrapper, "revert").text()).toBe("Revert to v2");
    await btn(wrapper, "revert").trigger("click");
    await flushPromises();
    expect(fleet.setDesired).toHaveBeenCalledWith(org(), "f1", {
      config: "edge-config",
      version: 2,
      strategy: "immediate",
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("asks before reverting, naming the fleet and the version", async () => {
    wrapper = await mountAt("f1");
    await btn(wrapper, "revert").trigger("click");
    await flushPromises();
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Revert edge to v2?",
        message: "This starts an immediate change to v2 for all of the fleet's collectors.",
        confirmLabel: "Revert",
      }),
    );
  });

  it("does nothing when the revert is cancelled", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = await mountAt("f1");
    await btn(wrapper, "revert").trigger("click");
    await flushPromises();
    expect(fleet.setDesired).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("asks before a rollout's Revert too, naming the rollout's own fleet", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = await mountAt("f1", [apiFleet(), apiFleet({}, "f2", "core")]);
    wrapper
      .findComponent(RolloutsStub)
      .vm.$emit("revert", "f2", { config: "edge-config", version: 2 });
    await flushPromises();
    expect(confirmMock.mock.calls[0][0].title).toBe("Revert core to v2?");
    expect(fleet.setDesired).not.toHaveBeenCalled();
  });

  it("offers no revert when desired equals stable or there is no stable version", async () => {
    wrapper = await mountAt("f1", [apiFleet({ desired: { config: "edge-config", version: 2 } })]);
    expect(btn(wrapper, "revert").exists()).toBe(false);
    wrapper.unmount();
    queryClient.clear();
    wrapper = await mountAt("f1", [apiFleet({ stable: null })]);
    expect(btn(wrapper, "revert").exists()).toBe(false);
    expect(btn(wrapper, "stable").text()).toBe("None yet");
  });

  it("retries a halted revision through the dialog, prefilled with that revision", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r1", "f1")] },
    } as any);
    wrapper = await mountAt("f1", [apiFleet({ revision: { id: "r1", status: "halted" } })]);
    await btn(wrapper, "retry").trigger("click");
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("retryOf")).toMatchObject({ id: "r1", strategy: "canary", toVersion: 3 });
    expect(fleet.setDesired).not.toHaveBeenCalled();
  });

  it("offers Retry only on a halted revision", async () => {
    wrapper = await mountAt("f1");
    expect(btn(wrapper, "retry").exists()).toBe(false);
  });

  it("toasts the server's 403 message", async () => {
    vi.mocked(fleet.setDesired).mockRejectedValueOnce({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
    });
    wrapper = await mountAt("f1");
    await btn(wrapper, "revert").trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: "Unauthorized Access" });
  });

  it("shows a fleet the user may list but not read as no access, with no actions", async () => {
    wrapper = await mountAt("f1", [{ id: "f1", name: "edge", state: null }]);
    expect(btn(wrapper, "no-access").text()).toContain(
      "You can see this fleet, but not its collectors or versions",
    );
    expect(btn(wrapper, "change-version").exists()).toBe(false);
  });

  it("shows a fleet missing from the list as not found, with no panel actions", async () => {
    wrapper = await mountAt("gone", [apiFleet()]);
    expect(btn(wrapper, "not-found").text()).toContain("This fleet no longer exists");
    expect(btn(wrapper, "panel").exists()).toBe(false);
    for (const id of ["rollouts", "change-version", "add-collector", "tokens"]) {
      expect(btn(wrapper, id).exists()).toBe(false);
    }
  });

  it("shows a load error, not not-found, when a refetch fails with the fleet missing from cached rows", async () => {
    wrapper = await mountAt("gone", [apiFleet()]);
    vi.mocked(fleet.listFleets).mockRejectedValue({ response: { status: 500 } });
    await queryClient.refetchQueries({ type: "active" });
    await flushPromises();
    expect(btn(wrapper, "load-error").exists()).toBe(true);
    expect(btn(wrapper, "not-found").exists()).toBe(false);
    vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: [apiFleet()] } } as any);
    wrapper
      .find('[data-test="fleet-fleets-load-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await flushPromises();
    expect(btn(wrapper, "not-found").exists()).toBe(true);
  });

  it("passes the selected fleet to the collectors table in This mode", async () => {
    wrapper = await mountAt("f1");
    expect(collectors(wrapper).props()).toMatchObject({
      fleetId: "f1",
      forbidden: false,
      allFleets: false,
    });
  });

  it("turns on All mode from ?scope=all and hides the fleet panel", async () => {
    wrapper = await mountAt("f1", [apiFleet()], { scope: "all" });
    expect(collectors(wrapper).props("allFleets")).toBe(true);
    expect(btn(wrapper, "panel").exists()).toBe(false);
    expect(btn(wrapper, "no-access").exists()).toBe(false);
  });

  it("writes and clears ?scope=all from the toggle, keeping the other params", async () => {
    wrapper = await mountAt("f1");
    collectors(wrapper).vm.$emit("update:allFleets", true);
    await flushPromises();
    expect(query()).toMatchObject({ scope: "all", folder: "f1", tab: "fleets" });
    collectors(wrapper).vm.$emit("update:allFleets", false);
    await flushPromises();
    expect(query().scope).toBeUndefined();
    expect(query().folder).toBe("f1");
  });

  it("passes forbidden for an unreadable fleet in This mode only, and keeps the table mounted", async () => {
    const unreadable = [{ id: "f1", name: "edge", state: null }];
    wrapper = await mountAt("f1", unreadable);
    expect(collectors(wrapper).props("forbidden")).toBe(true);
    expect(btn(wrapper, "no-access").exists()).toBe(true);
    wrapper.unmount();
    queryClient.clear();
    wrapper = await mountAt("f1", unreadable, { scope: "all" });
    expect(collectors(wrapper).exists()).toBe(true);
    expect(collectors(wrapper).props("forbidden")).toBe(false);
    expect(btn(wrapper, "no-access").exists()).toBe(false);
  });

  it("returns to This mode when the user picks another fleet, with or without ?folder", async () => {
    const two = [apiFleet(), apiFleet({}, "f2", "core"), apiFleet({}, "default", "default")];
    wrapper = await mountAt("f1", two, { scope: "all" });
    await pick(wrapper, "f2");
    expect(query()).toMatchObject({ folder: "f2" });
    expect(query().scope).toBeUndefined();
    wrapper.unmount();
    queryClient.clear();
    wrapper = await mountAt(null, two, { scope: "all" });
    await pick(wrapper, "f2");
    expect(query().folder).toBe("f2");
    expect(query().scope).toBeUndefined();
  });

  it("keeps the scope when the rail re-emits the selected fleet, as on its mount", async () => {
    wrapper = await mountAt("f1", [apiFleet()], { scope: "all" });
    await pick(wrapper, "f1");
    expect(query().scope).toBe("all");
    wrapper.unmount();
    queryClient.clear();
    wrapper = await mountAt(null, [apiFleet(), apiFleet({}, "default", "default")], {
      scope: "all",
    });
    await pick(wrapper, "default");
    expect(query().scope).toBe("all");
  });

  it("keeps the scope on the restricted-landing redirect", async () => {
    wrapper = await mountAt(null, [apiFleet()], { scope: "all" });
    expect(query().folder).toBe("f1");
    expect(query().scope).toBe("all");
  });

  it("opens the fleet's rollouts drawer on its list from Rollouts", async () => {
    wrapper = await mountAt("f1");
    const drawer = wrapper.findComponent(RolloutsStub);
    expect(drawer.props("open")).toBe(false);
    await btn(wrapper, "rollouts").trigger("click");
    await flushPromises();
    expect(drawer.props()).toMatchObject({
      open: true,
      fleetId: "f1",
      fleetName: "edge",
      rolloutId: null,
    });
  });

  it("opens the drawer on the latest rollout from Open rollout, and writes ?rollout=", async () => {
    wrapper = await mountAt("f1");
    await btn(wrapper, "open-revision").trigger("click");
    await flushPromises();
    const drawer = wrapper.findComponent(RolloutsStub);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("rolloutId")).toBe("r1");
    expect(query()).toMatchObject({ tab: "fleets", folder: "f1", rollout: "r1" });
  });

  it("opens the drawer from a ?rollout= link", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r1", "f1")] },
    } as any);
    wrapper = await mountAt("f1", [apiFleet()], { rollout: "r1" });
    const drawer = wrapper.findComponent(RolloutsStub);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("rolloutId")).toBe("r1");
  });

  it("selects the rollout's own fleet when the link has none", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r7", "f2")] },
    } as any);
    wrapper = await mountAt(null, [apiFleet(), apiFleet({}, "f2", "core")], { rollout: "r7" });
    await flushPromises();
    expect(query()).toMatchObject({ folder: "f2", rollout: "r7" });
    expect(wrapper.findComponent(RolloutsStub).props()).toMatchObject({
      open: true,
      fleetId: "f2",
      rolloutId: "r7",
    });
  });

  it("follows the drawer between list and detail through ?rollout=", async () => {
    wrapper = await mountAt("f1");
    await btn(wrapper, "rollouts").trigger("click");
    const drawer = wrapper.findComponent(RolloutsStub);
    drawer.vm.$emit("update:rolloutId", "r1");
    await flushPromises();
    expect(query().rollout).toBe("r1");
    expect(drawer.props("rolloutId")).toBe("r1");
    drawer.vm.$emit("update:rolloutId", null);
    await flushPromises();
    expect(query().rollout).toBeUndefined();
    expect(drawer.props("open")).toBe(true);
  });

  it("drops ?rollout= when the drawer closes", async () => {
    wrapper = await mountAt("f1", [apiFleet()], { rollout: "r1" });
    const drawer = wrapper.findComponent(RolloutsStub);
    drawer.vm.$emit("update:open", false);
    await flushPromises();
    expect(drawer.props("open")).toBe(false);
    expect(query().rollout).toBeUndefined();
  });

  it("drops ?rollout= when the user picks another fleet", async () => {
    wrapper = await mountAt("f1", [apiFleet(), apiFleet({}, "f2", "core")], { rollout: "r1" });
    await pick(wrapper, "f2");
    expect(query().folder).toBe("f2");
    expect(query().rollout).toBeUndefined();
  });

  it("closes the drawer and opens the retry dialog from a rollout's Retry", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout("r1", "f1")] },
    } as any);
    wrapper = await mountAt("f1", [apiFleet()], { rollout: "r1" });
    const drawer = wrapper.findComponent(RolloutsStub);
    drawer.vm.$emit("retry", { id: "r1", fleetId: "f1" });
    await flushPromises();
    expect(drawer.props("open")).toBe(false);
    expect(query().rollout).toBeUndefined();
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("retryOf")).toMatchObject({ id: "r1" });
  });

  it("opens a rollout's config in the editor without losing the org", async () => {
    router.addRoute({
      path: "/editor/:id",
      name: "fleetConfigEditor",
      component: { template: "<div />" },
    });
    wrapper = await mountAt("f1", [apiFleet()], { org_identifier: "acme" });
    wrapper
      .findComponent(RolloutsStub)
      .vm.$emit("navigate", { tab: "editor", query: { id: "edge-config" } });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("fleetConfigEditor");
    expect(router.currentRoute.value.query.org_identifier).toBe("acme");
  });

  it.each([
    ["halted", "Halted"],
    ["in_progress", "In progress"],
    ["completed", null],
  ])(
    "falls back to the fleet's %s revision status when the rollouts fail, except completed",
    async (status, shown) => {
      vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
      wrapper = await mountAt("f1", [apiFleet({ revision: { id: "r1", status } })]);
      const tag = btn(wrapper, "revision-status");
      expect(tag.exists()).toBe(shown !== null);
      if (shown) expect(tag.text()).toBe(shown);
    },
  );

  it("reverts the rollout's own fleet from a rollout's Revert", async () => {
    wrapper = await mountAt("f1");
    wrapper
      .findComponent(RolloutsStub)
      .vm.$emit("revert", "f2", { config: "edge-config", version: 2 });
    await flushPromises();
    expect(fleet.setDesired).toHaveBeenCalledWith(org(), "f2", {
      config: "edge-config",
      version: 2,
      strategy: "immediate",
    });
  });

  it("selects the rollout's fleet from its detail when the list fails, so actions never target the selected fleet", async () => {
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: { ...apiRollout("r7", "f2"), members: ["c1"], still_on_previous: 0 },
    } as any);
    wrapper = await mountAt("f1", [apiFleet(), apiFleet({}, "f2", "core")], { rollout: "r7" });
    await flushPromises();
    expect(query()).toMatchObject({ folder: "f2", rollout: "r7" });
    const drawer = wrapper.findComponent(RolloutsStub);
    expect(drawer.props("fleetId")).toBe("f2");
    drawer.vm.$emit("retry", { id: "r7", fleetId: "f2" });
    await flushPromises();
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("retryOf")).toMatchObject({ fleetId: "f2" });
    expect(dialog.props("fleetId")).toBe("f2");
  });

  it("closes the drawer and follows a rollout's link to its fleet's collectors", async () => {
    wrapper = await mountAt("f1", [apiFleet()], { rollout: "r1", scope: "all" });
    const drawer = wrapper.findComponent(RolloutsStub);
    drawer.vm.$emit("navigate", { tab: "fleets", query: { folder: "f1" } });
    await flushPromises();
    expect(drawer.props("open")).toBe(false);
    expect(query()).toMatchObject({ tab: "fleets", folder: "f1" });
    expect(query().view).toBeUndefined();
    expect(query().rollout).toBeUndefined();
    expect(query().scope).toBeUndefined();
  });
});
