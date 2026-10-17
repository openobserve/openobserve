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
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import FleetOverview from "./FleetOverview.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listCollectors: vi.fn(),
    getCollector: vi.fn(),
    summary: vi.fn(),
    listRollouts: vi.fn(),
  },
}));

const summary = {
  collectors: { total: 5, online: 3, degraded: 1, offline: 1, drifted: 0, outdated: 2 },
  versions: [],
  target_version: "0.124.0",
  rollouts_active: 2,
};

const versionsRefresh = vi.fn();
const versionsScroll = vi.fn();

const VersionsStub = defineComponent({
  name: "FleetCollectorVersions",
  setup(_props, { expose }) {
    expose({ refreshCollectors: versionsRefresh, scrollToOutdated: versionsScroll });
    return () => h("div", { "data-test": "versions-stub" });
  },
});

const FlowStub = {
  name: "FleetFlowOverview",
  props: { expanded: Boolean },
  emits: ["navigate", "outdated", "update:expanded"],
  template: "<div data-test='flow-stub' />",
};

const rollout = (id: string, status: string, fleetId = "f1", startedAt = 1) => ({
  id,
  kind: "config",
  config: `cfg-${id}`,
  from_version: 1,
  to_version: 2,
  fleet: { id: fleetId, name: `fleet-${fleetId}` },
  strategy: "immediate",
  status,
  total: 2,
  attempted: 1,
  accepted: 1,
  failed: 0,
  assigned: 2,
  started_at: startedAt,
  scheduled_for: null,
  started_by: "ana@acme.io",
  auto_rollback: false,
  phases: [],
  gates: [],
  failure: null,
  events: [],
});

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountOverview(stubVersions = true) {
  const wrapper = mount(FleetOverview, {
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      stubs: {
        FleetFlowOverview: FlowStub,
        ...(stubVersions ? { FleetCollectorVersions: VersionsStub } : {}),
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const active = (w: VueWrapper) => w.find('[data-test="fleet-overview-active-rollouts"]');

const tiles = (w: VueWrapper) =>
  Object.fromEntries(
    (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [i.key, i.value]),
  );

describe("FleetOverview", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("keeps the mock's tile set, without a degraded tile", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    expect(Object.keys(tiles(wrapper))).toEqual([
      "offline",
      "drifted",
      "outdated",
      "rollouts",
      "online",
      "total",
    ]);
  });

  it("refreshes the stat strip on the flow map's interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(fleet.summary).mockResolvedValue({
        data: { ...summary, rollouts_active: 0 },
      } as any);
      wrapper = await mountOverview();
      expect(fleet.summary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(FLOW_POLL_MS);
      await flushPromises();
      expect(fleet.summary).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the interval on a 403", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(fleet.summary).mockRejectedValue({ response: { status: 403 } });
      wrapper = await mountOverview();
      await vi.advanceTimersByTimeAsync(FLOW_POLL_MS * 2);
      await flushPromises();
      expect(fleet.summary).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes offline, outdated, online and total from the summary", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    expect(tiles(wrapper)).toMatchObject({ offline: 1, outdated: 2, online: 3, total: 5 });
  });

  it("takes drifted from the summary and opens the drifted collectors", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({
      data: { ...summary, collectors: { ...summary.collectors, drifted: 2 } },
    } as any);
    wrapper = await mountOverview();
    expect(tiles(wrapper).drifted).toBe(2);
    const strip = wrapper.findComponent({ name: "OStatStrip" });
    expect((strip.props("items") as any[]).find((i) => i.key === "drifted").selectable).not.toBe(
      false,
    );
    strip.vm.$emit("select", "drifted");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "fleets",
      { scope: "all", status: "drifted" },
    ]);
    strip.vm.$emit("select", "total");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { scope: "all" }]);
  });

  it("shows the no-access state on a 403", async () => {
    vi.mocked(fleet.summary).mockRejectedValue({ response: { status: 403 } });
    wrapper = await mountOverview();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-overview-forbidden"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-overview-error"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "FleetFlowOverview" }).exists()).toBe(false);
  });

  it("takes rollouts in progress from the summary, not the mock store", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    expect(tiles(wrapper).rollouts).toBe(2);
  });

  it("refresh reads the summary and the collectors once each, with the real versions panel", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { total: 0, items: [] } } as any);
    wrapper = await mountOverview(false);
    await settle();
    await wrapper.find('[data-test="fleet-overview-refresh"]').trigger("click");
    await settle();
    expect(fleet.summary).toHaveBeenCalledTimes(2);
    expect(fleet.listCollectors).toHaveBeenCalledTimes(2);
  });

  it("refresh re-reads the summary, the rollouts and the versions, and invalidates the flow", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    try {
      wrapper = await mountOverview();
      await wrapper.find('[data-test="fleet-overview-refresh"]').trigger("click");
      await flushPromises();
      expect(fleet.summary).toHaveBeenCalledTimes(2);
      expect(fleet.listRollouts).toHaveBeenCalledTimes(2);
      expect(versionsRefresh).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith({ queryKey: fleetKeys.flows("default") });
    } finally {
      spy.mockRestore();
    }
  });

  it("shows dashes while the summary loads", async () => {
    vi.mocked(fleet.summary).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountOverview();
    expect(tiles(wrapper)).toMatchObject({ offline: "—", outdated: "—", online: "—", total: "—" });
  });

  it("shows the error banner when the summary fails", async () => {
    vi.mocked(fleet.summary).mockRejectedValue(new Error("boom"));
    wrapper = await mountOverview();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-overview-error"]').exists()).toBe(true);
  });

  it("lists the in-progress, scheduled and halted rollouts across fleets, newest first", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: {
        items: [
          rollout("r1", "completed"),
          rollout("r2", "in_progress", "f1", 10),
          rollout("r3", "scheduled", "f2", 20),
          rollout("r4", "superseded"),
          rollout("r5", "halted", "f2", 5),
        ],
      },
    } as any);
    wrapper = await mountOverview();
    await settle();
    expect(active(wrapper).find('[data-test="fleet-overview-active-rollouts-count"]').text()).toBe(
      "3",
    );
    const text = active(wrapper).text();
    expect(text).not.toContain("cfg-r1");
    expect(text).not.toContain("cfg-r4");
    expect(text).toContain("fleet-f2");
    const order = ["cfg-r3", "cfg-r2", "cfg-r5"].map((c) => text.indexOf(c));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("opens a rollout in its fleet's drawer from its row", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r2", "in_progress", "f2")] },
    } as any);
    wrapper = await mountOverview();
    await settle();
    await active(wrapper).find('[data-test="o2-table-body"] tr').trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "fleets",
      { folder: "f2", rollout: "r2" },
    ]);
  });

  it("hides the active rollouts when none are active", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r1", "completed")] },
    } as any);
    wrapper = await mountOverview();
    await settle();
    expect(active(wrapper).exists()).toBe(false);
  });

  it("shows the collector versions, and asks them to show the outdated ones from the tile and the flow map", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountOverview();
    expect(wrapper.find('[data-test="versions-stub"]').exists()).toBe(true);
    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "outdated");
    await nextTick();
    expect(versionsScroll).toHaveBeenCalledTimes(1);
    wrapper.findComponent(FlowStub).vm.$emit("outdated");
    await nextTick();
    expect(versionsScroll).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });

  it("shows the load error when a refresh fails and every cached rollout is inactive", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r1", "completed")] },
    } as any);
    wrapper = await mountOverview();
    await settle();
    expect(active(wrapper).exists()).toBe(false);
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(active(wrapper).find('[data-test="fleet-rollout-table-error"]').exists()).toBe(true);
  });

  it("keeps the active rollouts under a stale-data banner when a refresh fails", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r2", "in_progress")] },
    } as any);
    wrapper = await mountOverview();
    await settle();
    expect(
      active(wrapper).find('[data-test="fleet-overview-active-rollouts-stale"]').exists(),
    ).toBe(false);
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(
      active(wrapper).find('[data-test="fleet-overview-active-rollouts-stale"]').exists(),
    ).toBe(true);
    expect(active(wrapper).text()).toContain("cfg-r2");
  });

  it.each([
    [new Error("boom"), "fleet-rollout-table-error"],
    [{ response: { status: 403 } }, "o2-table-forbidden"],
  ])(
    "keeps the active rollouts card, in its failed state, when the list fails (%j)",
    async (err, shown) => {
      vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
      vi.mocked(fleet.listRollouts).mockRejectedValue(err);
      wrapper = await mountOverview();
      await settle();
      expect(active(wrapper).find(`[data-test="${shown}"]`).exists()).toBe(true);
      expect(
        active(wrapper).find('[data-test="fleet-overview-active-rollouts-count"]').text(),
      ).toBe("—");
    },
  );

  it("retries the active rollouts from their load error", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    vi.mocked(fleet.listRollouts).mockRejectedValueOnce(new Error("boom"));
    wrapper = await mountOverview();
    await settle();
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r2", "in_progress")] },
    } as any);
    active(wrapper)
      .find('[data-test="fleet-rollout-table-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await settle();
    expect(fleet.listRollouts).toHaveBeenCalledTimes(2);
    expect(active(wrapper).text()).toContain("cfg-r2");
  });

  it("makes the rollouts tile selectable only while there is a card to scroll to", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    const tile = (w: VueWrapper) =>
      (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).find(
        (i) => i.key === "rollouts",
      );
    wrapper = await mountOverview();
    await settle();
    expect(tile(wrapper).selectable).toBe(false);
    wrapper.unmount();
    queryClient.clear();
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [rollout("r2", "in_progress")] },
    } as any);
    wrapper = await mountOverview();
    await settle();
    expect(tile(wrapper).selectable).toBe(true);
  });

  describe("expanded map", () => {
    const flow = (w: VueWrapper) => w.findComponent(FlowStub);
    const expand = async (w: VueWrapper, value: boolean) => {
      flow(w).vm.$emit("update:expanded", value);
      await flushPromises();
    };
    const shown = (w: VueWrapper) => ({
      strip: w.findComponent({ name: "OStatStrip" }).isVisible(),
      refresh: w.find('[data-test="fleet-overview-refresh"]').isVisible(),
      active: active(w).isVisible(),
      versions: w.find('[data-test="versions-stub"]').isVisible(),
    });

    it("hides the stat strip, refresh, active rollouts and versions, and shows them again on collapse", async () => {
      vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: { items: [rollout("r1", "in_progress")] },
      } as any);
      wrapper = await mountOverview();
      await settle();
      const all = { strip: true, refresh: true, active: true, versions: true };
      expect(shown(wrapper)).toEqual(all);
      expect(flow(wrapper).props("expanded")).toBe(false);
      expect(flow(wrapper).classes()).toContain("shrink-0");
      await expand(wrapper, true);
      expect(shown(wrapper)).toEqual({
        strip: false,
        refresh: false,
        active: false,
        versions: false,
      });
      expect(flow(wrapper).props("expanded")).toBe(true);
      expect(flow(wrapper).classes()).not.toContain("shrink-0");
      expect(flow(wrapper).classes()).toContain("max-lg:flex-none");
      await expand(wrapper, false);
      expect(shown(wrapper)).toEqual(all);
      expect(flow(wrapper).classes()).toContain("shrink-0");
    });

    it("keeps the summary error banner while expanded", async () => {
      vi.mocked(fleet.summary).mockRejectedValue(new Error("boom"));
      wrapper = await mountOverview();
      await expand(wrapper, true);
      expect(wrapper.find('[data-test="fleet-overview-error"]').isVisible()).toBe(true);
    });

    it("collapses before scrolling to the outdated versions the flow map asked for", async () => {
      vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
      wrapper = await mountOverview();
      await expand(wrapper, true);
      let shownAtScroll: boolean | null = null;
      versionsScroll.mockImplementationOnce(() => {
        shownAtScroll = wrapper.find('[data-test="versions-stub"]').isVisible();
      });
      flow(wrapper).vm.$emit("outdated");
      await flushPromises();
      expect(flow(wrapper).props("expanded")).toBe(false);
      expect(versionsScroll).toHaveBeenCalledTimes(1);
      expect(shownAtScroll).toBe(true);
    });
  });
});
