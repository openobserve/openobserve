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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import FleetCollectors from "./FleetCollectors.vue";

const { confirmMock, toastMock } = vi.hoisted(() => ({ confirmMock: vi.fn(), toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const bp = vi.hoisted(() => ({
  mobile: null as unknown as { value: boolean },
  desktop: null as unknown as { value: boolean },
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, ref } = await import("vue");
  bp.mobile = ref(false);
  bp.desktop = ref(true);
  return {
    default: () => ({
      isMobile: computed(() => bp.mobile.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => bp.desktop.value && !bp.mobile.value),
      mdUp: computed(() => !bp.mobile.value),
      lgUp: computed(() => !bp.mobile.value),
    }),
  };
});

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listCollectors: vi.fn(),
    getCollector: vi.fn(),
    listFleets: vi.fn(),
    listTokens: vi.fn(),
    deleteCollector: vi.fn(),
    restartCollector: vi.fn(),
    redeliverCollector: vi.fn(),
    renameCollector: vi.fn(),
    moveCollectors: vi.fn(),
  },
}));

const collector = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "prod-web-01",
  hostname: "prod-web-01.acme.internal",
  last_connected_from: "10.0.0.10",
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: "Ubuntu 24.04",
  version: "0.124.0",
  outdated: false,
  config: null,
  config_version: null,
  delivery: null,
  delivery_error: null,
  fleet: { id: "default", name: "default" },
  token_id: null,
  last_seen: Date.now(),
  enrolled_at: Date.now(),
  ...over,
});

const items = [
  collector(),
  collector({
    id: "c2",
    name: null,
    hostname: "edge-02",
    last_connected_from: "10.9.9.9",
    status: "offline",
    os: null,
    arch: null,
    distribution: null,
    version: "0.118.0",
    outdated: true,
    fleet: { id: "f1", name: "edge" },
  }),
];

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", name: "fleet", component: { template: "<div />" } }],
});

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

const DropdownStub = { template: "<div><slot name='trigger' /><slot /></div>" };
const DropdownItemStub = {
  inheritAttrs: false,
  props: ["variant", "iconLeft", "disabled"],
  emits: ["select"],
  template: `<button :data-test="$attrs['data-test']" :disabled="disabled" @click="$emit('select')"><slot /></button>`,
};

const MoveStub = {
  name: "FleetMoveDialog",
  props: ["open", "collectorIds", "sourceFleetId"],
  emits: ["moved", "update:open"],
  template: "<div />",
};

type ListProps = { fleetId?: string; forbidden?: boolean; allFleets?: boolean };

async function mountList(path = "/", stubs: Record<string, unknown> = {}, props: ListProps = {}) {
  await router.push(path);
  const wrapper = mount(FleetCollectors, {
    attachTo: document.body,
    props: { fleetId: "default", forbidden: false, allFleets: true, ...props },
    global: {
      plugins: [i18n, router, store],
      stubs: { FleetMoveDialog: MoveStub, ...stubs },
    },
  });
  await settle();
  return wrapper;
}

const COLUMN_STORAGE_KEY = "o2-tables-column-state-v1";

const bodyText = (w: VueWrapper) => w.find('[data-test="o2-table-body"]').text();
const tiles = (w: VueWrapper) =>
  Object.fromEntries(
    (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [i.key, i]),
  );

describe("FleetCollectors", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { total: 2, items } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("loads the org-wide list for the selected org", async () => {
    wrapper = await mountList();
    expect(fleet.listCollectors).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
  });

  it("renders a row per API collector", async () => {
    wrapper = await mountList();
    const text = bodyText(wrapper);
    expect(text).toContain("prod-web-01");
    expect(text).toContain("edge-02");
    expect(text).toContain("0.118.0");
    expect(text).toContain("Outdated");
  });

  it("renders null config and OS as a dash in their own cells", async () => {
    wrapper = await mountList();
    expect(wrapper.find('[data-test="fleet-collectors-config-c2"]').text()).toBe(
      "No configuration assigned",
    );
    expect(wrapper.find('[data-test="fleet-collectors-os-c2"]').text()).toBe("—");
    expect(wrapper.find('[data-test="fleet-collectors-os-c1"]').text()).toBe("Linux");
    expect(bodyText(wrapper)).not.toMatch(/undefined|null/);
  });

  it("shows dashes in the strip until the list loads", async () => {
    vi.mocked(fleet.listCollectors).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountList();
    expect(tiles(wrapper).all.value).toBe("—");
    expect(tiles(wrapper).offline.value).toBe("—");
  });

  it("counts the status strip from the in-scope rows", async () => {
    wrapper = await mountList();
    expect(tiles(wrapper)).toMatchObject({
      offline: { value: 1 },
      degraded: { value: 0 },
      unknown: { value: 0 },
      outdated: { value: 1 },
      online: { value: 1 },
      all: { value: 2 },
    });
    await wrapper.setProps({ allFleets: false, fleetId: "f1" });
    expect(tiles(wrapper)).toMatchObject({ offline: { value: 1 }, all: { value: 1 } });
  });

  it("counts the scope only, ignoring the status, OS and search filters", async () => {
    wrapper = await mountList();
    (wrapper.vm as any).osFilter = "linux";
    await wrapper.find('[data-test="fleet-collectors-search"] input').setValue("prod");
    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "online");
    await settle();
    expect(bodyText(wrapper)).not.toContain("edge-02");
    expect(tiles(wrapper)).toMatchObject({ offline: { value: 1 }, all: { value: 2 } });
  });

  it("shows each collector's fleet in its own column in All mode only", async () => {
    wrapper = await mountList();
    expect(wrapper.find('[data-test="fleet-collectors-fleet-c1"]').text()).toBe("default");
    expect(wrapper.find('[data-test="fleet-collectors-fleet-c2"]').text()).toBe("edge");
    await wrapper.setProps({ allFleets: false });
    await settle();
    expect(wrapper.find('[data-test="fleet-collectors-fleet-c1"]').exists()).toBe(false);
  });

  it("lists only the selected fleet's collectors in This mode", async () => {
    wrapper = await mountList("/", {}, { allFleets: false, fleetId: "f1" });
    expect(bodyText(wrapper)).toContain("edge-02");
    expect(bodyText(wrapper)).not.toContain("prod-web-01");
    await wrapper.setProps({ fleetId: "default" });
    await settle();
    expect(bodyText(wrapper)).toContain("prod-web-01");
    expect(bodyText(wrapper)).not.toContain("edge-02");
  });

  it("lists every returned collector in All mode, even with an empty search", async () => {
    wrapper = await mountList("/", {}, { fleetId: "f1" });
    expect(bodyText(wrapper)).toContain("edge-02");
    expect(bodyText(wrapper)).toContain("prod-web-01");
  });

  it("emits the scope from the toggle and swaps the placeholder by mode", async () => {
    wrapper = await mountList("/", {}, { allFleets: false });
    const input = () => wrapper.find('[data-test="fleet-collectors-search"] input');
    expect(input().attributes("placeholder")).toBe("Search collectors in this fleet");
    expect(wrapper.find('[data-test="fleet-collectors-scope-this"]').text()).toBe("This fleet");
    expect(wrapper.find('[data-test="fleet-collectors-scope-all"]').text()).toBe("All fleets");
    await wrapper.find('[data-test="fleet-collectors-scope-all"]').trigger("click");
    expect(wrapper.emitted("update:allFleets")?.at(-1)).toEqual([true]);
    await wrapper.setProps({ allFleets: true });
    expect(input().attributes("placeholder")).toBe("Search collectors in all fleets");
    await wrapper.find('[data-test="fleet-collectors-scope-this"]').trigger("click");
    expect(wrapper.emitted("update:allFleets")?.at(-1)).toEqual([false]);
  });

  it("shows no rows, the no-access state and dashes for an unreadable fleet, with the toggle usable", async () => {
    wrapper = await mountList("/", {}, { allFleets: false, fleetId: "f1", forbidden: true });
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("edge-02");
    expect(tiles(wrapper).all.value).toBe("—");
    await wrapper.find('[data-test="fleet-collectors-scope-all"]').trigger("click");
    expect(wrapper.emitted("update:allFleets")?.at(-1)).toEqual([true]);
  });

  it("has no label column, label filter or label search", async () => {
    wrapper = await mountList();
    expect(wrapper.find('[data-test="fleet-collectors-labels-c1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-collectors-label-filter"]').exists()).toBe(false);
    await wrapper.find('[data-test="fleet-collectors-search"] input').setValue("production");
    await settle();
    expect(wrapper.find('[data-test="fleet-collectors-empty"]').exists()).toBe(true);
  });

  it("filters by the search box on the client", async () => {
    wrapper = await mountList();
    await wrapper.find('[data-test="fleet-collectors-search"] input').setValue("edge");
    await settle();
    const text = bodyText(wrapper);
    expect(text).toContain("edge-02");
    expect(text).not.toContain("prod-web-01");
    expect(fleet.listCollectors).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["c2", "edge-02", "prod-web-01"],
    ["10.0.0.10", "prod-web-01", "edge-02"],
    ["edge", "edge-02", "prod-web-01"],
  ])("search matches id, peer address and fleet (%s)", async (q, shown, hidden) => {
    wrapper = await mountList();
    await wrapper.find('[data-test="fleet-collectors-search"] input').setValue(q);
    await settle();
    expect(bodyText(wrapper)).toContain(shown);
    expect(bodyText(wrapper)).not.toContain(hidden);
  });

  it("filters by OS on the client", async () => {
    wrapper = await mountList();
    // OSelect renders its listbox in a portal, so the value is set on the bound model.
    (wrapper.vm as any).osFilter = "linux";
    await settle();
    const text = bodyText(wrapper);
    expect(text).toContain("prod-web-01");
    expect(text).not.toContain("edge-02");
  });

  it("filters by clicking the outdated tile, using the server flag", async () => {
    wrapper = await mountList();
    await wrapper.find('[data-test="fleet-collectors-stat-outdated"]').trigger("click");
    await settle();
    const text = bodyText(wrapper);
    expect(text).toContain("edge-02");
    expect(text).not.toContain("prod-web-01");
  });

  it("applies ?status and ?q deep links", async () => {
    wrapper = await mountList("/?status=offline");
    expect(bodyText(wrapper)).toContain("edge-02");
    expect(bodyText(wrapper)).not.toContain("prod-web-01");
    wrapper.unmount();
    wrapper = await mountList("/?q=prod-web");
    expect(bodyText(wrapper)).toContain("prod-web-01");
    expect(bodyText(wrapper)).not.toContain("edge-02");
    wrapper.unmount();
    wrapper = await mountList("/?status=unknown");
    expect((wrapper.vm as any).statusFilter).toBe("unknown");
  });

  it.each(["bogus"])("ignores an invalid ?status=%s", async (status) => {
    wrapper = await mountList(`/?status=${status}`);
    expect((wrapper.vm as any).statusFilter).toBeNull();
    expect(bodyText(wrapper)).toContain("prod-web-01");
    expect(bodyText(wrapper)).toContain("edge-02");
  });

  it("opens the drawer on a valid ?ctab and falls back to overview on an invalid one", async () => {
    vi.mocked(fleet.getCollector).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountList("/?collector=c1&ctab=health");
    expect((wrapper.vm as any).initialTab).toBe("health");
    wrapper.unmount();
    wrapper = await mountList("/?collector=c1&ctab=nope");
    expect((wrapper.vm as any).initialTab).toBe("overview");
  });

  it("shows the skeleton while the list is loading", async () => {
    vi.mocked(fleet.listCollectors).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountList();
    expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
  });

  it("shows the error state when the list fails to load", async () => {
    vi.mocked(fleet.listCollectors).mockRejectedValue(new Error("boom"));
    wrapper = await mountList();
    await settle();
    expect(wrapper.find('[data-test="fleet-collectors-error"]').exists()).toBe(true);
  });

  it("makes no request on a revisit inside the freshness window", async () => {
    wrapper = await mountList();
    wrapper.unmount();
    wrapper = await mountList();
    expect(fleet.listCollectors).toHaveBeenCalledTimes(1);
    expect(bodyText(wrapper)).toContain("prod-web-01");
  });

  it("refresh refetches the collectors, the fleets and the rollouts", async () => {
    wrapper = await mountList();
    const refetch = vi.spyOn(queryClient, "refetchQueries");
    await (wrapper.vm as any).refresh();
    const org = store.state.selectedOrganization.identifier;
    expect(fleet.listCollectors).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledWith({ queryKey: fleetKeys.fleets(org) });
    expect(refetch).toHaveBeenCalledWith({ queryKey: fleetKeys.rollouts(org) });
    refetch.mockRestore();
  });

  it("labels the icon-only row menu button for assistive tech", async () => {
    wrapper = await mountList();
    expect(
      wrapper.find('[data-test="fleet-collectors-row-menu-c1"]').attributes("aria-label"),
    ).toBe("Actions");
  });

  it("shows no-access and drops cached rows when a refetch returns 403", async () => {
    wrapper = await mountList();
    vi.mocked(fleet.listCollectors).mockRejectedValueOnce({ response: { status: 403 } });
    await (wrapper.vm as any).refresh().catch(() => {});
    await settle();
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("prod-web-01");
    expect(tiles(wrapper).all.value).toBe("—");
  });

  it("keeps cached rows when a refetch fails with anything but 403", async () => {
    wrapper = await mountList();
    vi.mocked(fleet.listCollectors).mockRejectedValueOnce(new Error("boom"));
    await (wrapper.vm as any).refresh().catch(() => {});
    await settle();
    expect(bodyText(wrapper)).toContain("prod-web-01");
    expect(wrapper.find('[data-test="fleet-collectors-error"]').exists()).toBe(false);
  });

  it("opens the drawer when ?collector= changes on an already mounted view", async () => {
    wrapper = await mountList();
    const drawer = () => wrapper.findComponent({ name: "FleetCollectorDrawer" });
    expect(drawer().props("open")).toBe(false);
    await router.push({ path: "/", query: { collector: "c2" } });
    await settle();
    expect(drawer().props("open")).toBe(true);
    expect(drawer().props("collectorId")).toBe("c2");
  });

  it("offers only the OS filter on a phone through a filters drawer", async () => {
    bp.mobile.value = true;
    try {
      wrapper = await mountList();
      const btn = wrapper.find('[data-test="fleet-collectors-mobile-filters-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      await settle();
      const drawer = wrapper
        .findAllComponents({ name: "ODrawer" })
        .find((d) => d.props("title") === "Filters")!;
      expect(drawer.props("open")).toBe(true);
      expect(
        document.querySelector('[data-test="fleet-collectors-mobile-os-filter"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="fleet-collectors-mobile-fleet-filter"]'),
      ).toBeNull();
    } finally {
      bp.mobile.value = false;
    }
  });

  it("clears the selection and closes the drawer when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    wrapper = await mountList("/?collector=c1");
    (wrapper.vm as any).selectedIds = ["c1", "c2"];
    await settle();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await settle();
    try {
      expect((wrapper.vm as any).selectedIds).toEqual([]);
      expect(wrapper.findComponent({ name: "FleetCollectorDrawer" }).props("open")).toBe(false);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it.each<[string, (w: VueWrapper) => Promise<unknown>]>([
    ["search", (w) => w.find('[data-test="fleet-collectors-search"] input').setValue("prod")],
    ["status", (w) => w.find('[data-test="fleet-collectors-stat-offline"]').trigger("click")],
    ["OS", async (w) => ((w.vm as any).osFilter = "linux")],
    ["scope", (w) => w.setProps({ allFleets: false, fleetId: "default" })],
    ["fleet", (w) => w.setProps({ allFleets: false, fleetId: "f1" })],
  ])("drops hidden rows from the selection when the %s change", async (_name, change) => {
    wrapper = await mountList();
    (wrapper.vm as any).selectedIds = ["c1", "c2"];
    await settle();
    await change(wrapper);
    await settle();
    const visible = (wrapper.vm as any).rows.map((c: { id: string }) => c.id);
    expect(visible).toHaveLength(1);
    expect((wrapper.vm as any).selectedIds).toEqual(visible);
  });

  it("drops the selection when the fleet turns out unreadable", async () => {
    wrapper = await mountList();
    (wrapper.vm as any).selectedIds = ["c1", "c2"];
    await settle();
    await wrapper.setProps({ allFleets: false, fleetId: "f1", forbidden: true });
    await settle();
    expect((wrapper.vm as any).selectedIds).toEqual([]);
  });

  it("offers the filters drawer below the desktop breakpoint", async () => {
    bp.desktop.value = false;
    try {
      wrapper = await mountList();
      const titles = wrapper.findAllComponents({ name: "ODrawer" }).map((d) => d.props("title"));
      expect(titles).toContain("Filters");
    } finally {
      bp.desktop.value = true;
    }
  });

  it("keeps the selection across a refresh and drops only rows that left", async () => {
    wrapper = await mountList();
    (wrapper.vm as any).selectedIds = ["c1", "c2"];
    await settle();
    await (wrapper.vm as any).refresh();
    await settle();
    expect((wrapper.vm as any).selectedIds).toEqual(["c1", "c2"]);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 1, items: [items[0]] },
    } as any);
    await (wrapper.vm as any).refresh();
    await settle();
    expect((wrapper.vm as any).selectedIds).toEqual(["c1"]);
  });

  it("keeps the drawer open across a scope and a fleet change", async () => {
    vi.mocked(fleet.getCollector).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountList("/?collector=c1", {}, { allFleets: false });
    const drawer = () => wrapper.findComponent({ name: "FleetCollectorDrawer" });
    expect(drawer().props("open")).toBe(true);
    await wrapper.setProps({ allFleets: true });
    await wrapper.setProps({ allFleets: false, fleetId: "f1" });
    await settle();
    expect(drawer().props("open")).toBe(true);
    expect(drawer().props("collectorId")).toBe("c1");
  });

  describe("collector actions", () => {
    const menu = { ODropdown: DropdownStub, ODropdownItem: DropdownItemStub };

    beforeEach(() => {
      confirmMock.mockResolvedValue(true);
      vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: [] } } as any);
    });

    it("offers Move, Restart and Remove on a selection, and no unenroll anywhere", async () => {
      wrapper = await mountList("/", menu);
      (wrapper.vm as any).selectedIds = ["c1"];
      await settle();
      for (const id of ["bulk-move", "bulk-restart", "bulk-remove", "row-remove-c1"])
        expect(wrapper.find(`[data-test="fleet-collectors-${id}"]`).exists(), id).toBe(true);
      expect(wrapper.find('[data-test^="fleet-collectors-row-unenroll"]').exists()).toBe(false);
    });

    it("offers Restart, Redeliver and Rename from a row menu, Redeliver only with a configuration", async () => {
      vi.mocked(fleet.listCollectors).mockResolvedValue({
        data: { total: 2, items: [collector({ config: "edge", config_version: 2 }), items[1]] },
      } as any);
      wrapper = await mountList("/", menu);
      for (const id of ["row-restart-c1", "row-redeliver-c1", "row-rename-c1"])
        expect(wrapper.find(`[data-test="fleet-collectors-${id}"]`).exists(), id).toBe(true);
      expect(wrapper.find('[data-test="fleet-collectors-row-redeliver-c2"]').exists()).toBe(false);
    });

    it("removes the selected rows once each after a confirm that warns they reappear", async () => {
      vi.mocked(fleet.deleteCollector).mockResolvedValue({ status: 204 } as any);
      wrapper = await mountList();
      (wrapper.vm as any).selectedIds = ["c1", "c2"];
      await settle();
      await wrapper.find('[data-test="fleet-collectors-bulk-remove"]').trigger("click");
      await settle();
      expect(confirmMock.mock.calls[0][0].title).toBe("Remove 2 collectors?");
      expect(confirmMock.mock.calls[0][0].message).toContain("1 of these collectors is online");
      expect(fleet.deleteCollector).toHaveBeenCalledTimes(2);
      expect((wrapper.vm as any).selectedIds).toEqual([]);
    });

    it("does not remove when the confirm is cancelled", async () => {
      confirmMock.mockResolvedValue(false);
      wrapper = await mountList("/", menu);
      await wrapper.find('[data-test="fleet-collectors-row-remove-c1"]').trigger("click");
      await settle();
      expect(fleet.deleteCollector).not.toHaveBeenCalled();
    });

    it("keeps failed ids selected and names the first failure after a partial remove", async () => {
      vi.mocked(fleet.deleteCollector)
        .mockResolvedValueOnce({ status: 204 } as any)
        .mockRejectedValueOnce({ response: { status: 403, data: { message: "no put on f1" } } });
      wrapper = await mountList();
      (wrapper.vm as any).selectedIds = ["c1", "c2"];
      await settle();
      await wrapper.find('[data-test="fleet-collectors-bulk-remove"]').trigger("click");
      await settle();
      expect((wrapper.vm as any).selectedIds).toEqual(["c2"]);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: expect.stringContaining("no put on f1"),
        }),
      );
    });

    it("restarts the selection after a confirm, once per collector", async () => {
      vi.mocked(fleet.restartCollector).mockResolvedValue({ data: { queued: true } } as any);
      wrapper = await mountList();
      (wrapper.vm as any).selectedIds = ["c1", "c2"];
      await settle();
      await wrapper.find('[data-test="fleet-collectors-bulk-restart"]').trigger("click");
      await settle();
      expect(fleet.restartCollector).toHaveBeenCalledTimes(2);
    });

    it("redelivers a row without asking", async () => {
      vi.mocked(fleet.listCollectors).mockResolvedValue({
        data: { total: 1, items: [collector({ config: "edge", config_version: 2 })] },
      } as any);
      vi.mocked(fleet.redeliverCollector).mockResolvedValue({ data: { revision: 2 } } as any);
      wrapper = await mountList("/", menu);
      await wrapper.find('[data-test="fleet-collectors-row-redeliver-c1"]').trigger("click");
      await settle();
      expect(confirmMock).not.toHaveBeenCalled();
      expect(fleet.redeliverCollector).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "c1",
      );
    });

    it("opens the rename dialog with the row's nickname", async () => {
      wrapper = await mountList("/", menu);
      await wrapper.find('[data-test="fleet-collectors-row-rename-c1"]').trigger("click");
      await settle();
      const dialog = wrapper.findComponent({ name: "FleetNameDialog" });
      expect(dialog.props("open")).toBe(true);
      expect(dialog.props("initial")).toBe("prod-web-01");
    });

    it("moves a row from its menu, naming its fleet as the source", async () => {
      wrapper = await mountList("/", menu);
      await wrapper.find('[data-test="fleet-collectors-row-move-c2"]').trigger("click");
      const move = wrapper.findComponent(MoveStub);
      expect(move.props("open")).toBe(true);
      expect(move.props("collectorIds")).toEqual(["c2"]);
      expect(move.props("sourceFleetId")).toBe("f1");
    });

    it("moves a mixed selection with no source fleet and clears the selection after", async () => {
      wrapper = await mountList();
      (wrapper.vm as any).selectedIds = ["c1", "c2"];
      await settle();
      await wrapper.find('[data-test="fleet-collectors-bulk-move"]').trigger("click");
      const move = wrapper.findComponent(MoveStub);
      expect(move.props("collectorIds")).toEqual(["c1", "c2"]);
      expect(move.props("sourceFleetId")).toBe("");
      move.vm.$emit("moved");
      await settle();
      expect((wrapper.vm as any).selectedIds).toEqual([]);
    });

    it("shows a placeholder for consistency until it is computed", async () => {
      localStorage.setItem(
        COLUMN_STORAGE_KEY,
        JSON.stringify({ "fleet-collectors": { visibility: { consistency: true } } }),
      );
      try {
        wrapper = await mountList();
        expect(wrapper.find('[data-test="fleet-collectors-consistency-c1"]').text()).toBe("—");
      } finally {
        localStorage.removeItem(COLUMN_STORAGE_KEY);
      }
    });
  });
});
