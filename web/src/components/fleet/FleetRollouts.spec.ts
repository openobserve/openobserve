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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetRollouts from "./FleetRollouts.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listRollouts: vi.fn(),
    getRollout: vi.fn(),
    listFleets: vi.fn(),
  },
}));

const phase = (size: number, status: string) => ({
  id: "p1",
  label: "all",
  size,
  assigned: size,
  attempted: size,
  accepted: 0,
  failed: 0,
  status,
});

const rollout = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  kind: "config",
  config: "edge",
  from_version: null,
  to_version: 1,
  fleet: { id: "f1", name: "edge-fleet" },
  strategy: "immediate",
  status: "completed",
  total: 2,
  attempted: 2,
  accepted: 2,
  failed: 0,
  assigned: 2,
  started_at: Date.now() - 60_000,
  scheduled_for: null,
  started_by: "ana@acme.io",
  auto_rollback: false,
  phases: [phase(2, "done")],
  gates: [],
  failure: null,
  events: [{ key: "deploying", at: Date.now() - 60_000 }],
  ...over,
});

const items = [
  rollout(),
  rollout({
    id: "r2",
    config: "gateway",
    from_version: 1,
    to_version: 2,
    fleet: { id: "gone", name: null },
    status: "in_progress",
    total: 3,
    accepted: 1,
    phases: [phase(3, "running")],
  }),
  rollout({
    id: "r3",
    config: "edge",
    from_version: 1,
    to_version: 2,
    status: "halted",
    failed: 1,
    failure: {
      kind: "rejection",
      gate: "rejected",
      observed: "1",
      threshold: "0",
      message: "unknown receiver",
    },
    phases: [{ ...phase(2, "failed"), failed: 1 }],
  }),
];

const newer = rollout({ id: "r5", config: "edge-newer", started_at: Date.now() - 1_000 });

const apiFleet = (id: string, stable: { config: string; version: number }) => ({
  id,
  name: id,
  state: {
    desired: { config: "edge", version: 2 },
    stable,
    revision: null,
    collectors: 2,
    online: 2,
    at_desired: 0,
  },
});

const fleets = [
  apiFleet("f1", { config: "edge", version: 1 }),
  apiFleet("f2", { config: "edge", version: 4 }),
];

const DrawerStub = {
  props: ["open", "title", "subTitle"],
  template:
    '<div v-if="open" data-test="fleet-rollouts-drawer"><h2>{{ title }}</h2><span>{{ subTitle }}</span><slot /></div>',
};

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountDrawer(rolloutId: string | null = null) {
  const wrapper = mount(FleetRollouts, {
    attachTo: document.body,
    props: {
      open: true,
      fleetId: "f1",
      fleetName: "edge-fleet",
      rolloutId,
    },
    global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
  });
  await settle();
  return wrapper;
}

const bodyText = (w: VueWrapper) => w.find('[data-test="o2-table-body"]').text();
const drawer = (w: VueWrapper) => w.find('[data-test="fleet-rollouts-drawer"]');
const org = () => store.state.selectedOrganization.identifier;

describe("FleetRollouts", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: fleets } } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [...items, newer] } } as any);
    vi.mocked(fleet.getRollout).mockImplementation(
      async (_o: string, id: string) =>
        ({
          data: {
            ...[...items, newer].find((r) => r.id === id),
            members: ["c1", "c2"],
            still_on_previous: 0,
          },
        }) as any,
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("lists only this fleet's rollouts, the active one first and then the newest", async () => {
    wrapper = await mountDrawer();
    expect(fleet.listRollouts).toHaveBeenCalledWith(org());
    const text = bodyText(wrapper);
    expect(text).not.toContain("gateway");
    expect(text.indexOf("unknown receiver")).toBeLessThan(text.indexOf("edge-newer"));
    expect(text.indexOf("edge-newer")).toBeLessThan(text.lastIndexOf("→ v1"));
    expect(text).not.toMatch(/vnull|undefined|null/);
  });

  it("says an empty fleet's rollout targeted no collectors, with a neutral bar", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: {
        items: [
          rollout({ id: "r0", total: 0, attempted: 0, accepted: 0, assigned: 0, phases: [] }),
        ],
      },
    } as any);
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: {
        ...rollout({
          id: "r0",
          total: 0,
          attempted: 0,
          accepted: 0,
          assigned: 0,
          phases: [],
          events: [{ key: "completed", at: 1 }],
        }),
        members: [],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer();
    expect(bodyText(wrapper)).toContain("No collectors targeted");
    expect(bodyText(wrapper)).not.toContain("0 of 0");
    expect(bodyText(wrapper)).not.toContain("Completed");
    expect(wrapper.findComponent({ name: "OProgressBar" }).props("variant")).toBe("default");
    await wrapper.setProps({ rolloutId: "r0" });
    await settle();
    expect(wrapper.find('[data-test="fleet-rollouts-status"]').text()).toBe(
      "No collectors targeted",
    );
    const items = wrapper.findAllComponents({ name: "OTimelineItem" });
    expect(items.map((i) => i.props("variant"))).toEqual(["muted"]);
    expect(items.map((i) => String(i.props("title")))).toEqual(["No collectors targeted"]);
  });

  it("keeps a halted zero-collector rollout's timeline in its own tones", async () => {
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: {
        ...rollout({
          id: "h0",
          status: "halted",
          total: 0,
          attempted: 0,
          accepted: 0,
          assigned: 0,
          phases: [],
          events: [
            { key: "halted", at: 1 },
            { key: "completed", at: 2 },
          ],
        }),
        members: [],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer("h0");
    const items = wrapper.findAllComponents({ name: "OTimelineItem" });
    expect(items.map((i) => i.props("variant"))).toEqual(["destructive", "success"]);
    expect(String(items[1].props("title"))).toBe("Completed");
    expect(wrapper.find('[data-test="fleet-rollouts-status"]').text()).toBe("Halted");
  });

  it("hides the zero-size phase the backend records for an empty completed rollout", async () => {
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: {
        ...rollout({
          id: "e0",
          status: "completed",
          total: 0,
          attempted: 0,
          accepted: 0,
          assigned: 0,
          phases: [phase(0, "running")],
          gates: [{ id: "heartbeat", threshold: "95%", observed: "-", status: "pending" }],
        }),
        members: [],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer("e0");
    expect(wrapper.find('[data-test="fleet-rollouts-status"]').text()).toBe(
      "No collectors targeted",
    );
    expect(wrapper.find('[data-test^="fleet-rollout-phases-"]').exists()).toBe(false);
    expect(drawer(wrapper).text()).not.toContain("Progress");
    expect(drawer(wrapper).text()).not.toContain("Running");
  });

  it("hides the Progress section of a rollout without phases", async () => {
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: { ...rollout({ id: "p0", phases: [] }), members: [], still_on_previous: 0 },
    } as any);
    wrapper = await mountDrawer("p0");
    expect(drawer(wrapper).text()).not.toContain("Progress");
  });

  it("titles the list with the fleet's name", async () => {
    wrapper = await mountDrawer();
    expect(drawer(wrapper).text()).toContain("Rollouts");
    expect(drawer(wrapper).text()).toContain("edge-fleet");
  });

  it("shows the rejection reason on a halted row", async () => {
    wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="fleet-rollout-table-failure-r3"]').text()).toContain(
      "unknown receiver",
    );
  });

  it("opens a rollout from its row", async () => {
    wrapper = await mountDrawer();
    await wrapper.find('[data-test="o2-table-body"] tr').trigger("click");
    expect(wrapper.emitted("update:rolloutId")?.at(-1)).toEqual(["r3"]);
  });

  it("shows an error state with a retry when the list fails to load", async () => {
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    wrapper = await mountDrawer();
    await settle();
    const error = wrapper.find('[data-test="fleet-rollout-table-error"]');
    expect(error.exists()).toBe(true);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items } } as any);
    error.findComponent({ name: "OEmptyState" }).vm.$emit("action", "retry");
    await settle();
    expect(fleet.listRollouts).toHaveBeenCalledTimes(2);
    expect(bodyText(wrapper)).toContain("unknown receiver");
  });

  it("replaces the list with the rollout's detail, and goes back to the list", async () => {
    wrapper = await mountDrawer("r3");
    expect(fleet.getRollout).toHaveBeenCalledWith(org(), "r3");
    const d = drawer(wrapper);
    expect(d.find("h2").text()).toBe("edge");
    expect(d.text()).toContain("v1 → v2");
    expect(d.text()).toContain("unknown receiver");
    expect(wrapper.find('[data-test="o2-table-body"]').exists()).toBe(false);
    await wrapper.find('[data-test="fleet-rollouts-back"]').trigger("click");
    expect(wrapper.emitted("update:rolloutId")?.at(-1)).toEqual([null]);
    await wrapper.setProps({ rolloutId: null });
    await settle();
    expect(bodyText(wrapper)).toContain("edge-newer");
  });

  it("asks the fleet to revert a halted rollout to its stable version", async () => {
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-revert"]').trigger("click");
    expect(wrapper.emitted("revert")?.at(-1)).toEqual(["f1", { config: "edge", version: 1 }]);
  });

  it("reverts a rollout of another fleet to that fleet's stable version, naming that fleet", async () => {
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: {
        ...rollout({ id: "r8", status: "halted", fleet: { id: "f2", name: "f2" }, to_version: 5 }),
        members: ["c1"],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer("r8");
    await wrapper.find('[data-test="fleet-rollout-outcome-revert"]').trigger("click");
    expect(wrapper.emitted("revert")?.at(-1)).toEqual(["f2", { config: "edge", version: 4 }]);
    await wrapper.find('[data-test="fleet-rollout-outcome-retry"]').trigger("click");
    expect(wrapper.emitted("retry")?.at(-1)?.[0]).toMatchObject({ id: "r8", fleetId: "f2" });
  });

  it("shows a spinner while the rollout loads", async () => {
    vi.mocked(fleet.listRollouts).mockReturnValue(new Promise(() => {}) as any);
    vi.mocked(fleet.getRollout).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountDrawer("r3");
    expect(wrapper.find('[data-test="fleet-rollouts-detail-loading"]').exists()).toBe(true);
  });

  it.each([
    [{ response: { status: 403 } }, "fleet-rollouts-detail-forbidden"],
    [{ response: { status: 404 } }, "fleet-rollouts-detail-not-found"],
    [new Error("boom"), "fleet-rollouts-detail-error"],
  ])("shows why a rollout the list does not hold cannot open (%j)", async (err, shown) => {
    vi.mocked(fleet.getRollout).mockRejectedValue(err);
    wrapper = await mountDrawer("gone");
    await settle();
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollouts-back"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollouts-detail-loading"]').exists()).toBe(false);
  });

  it.each([
    [403, "fleet-rollouts-detail-forbidden"],
    [404, "fleet-rollouts-detail-not-found"],
  ])("lets a detail %s win over the rollout's cached list row", async (status, shown) => {
    vi.mocked(fleet.getRollout).mockRejectedValue({ response: { status } });
    wrapper = await mountDrawer("r3");
    await settle();
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollout-outcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-rollout-outcome-revert"]').exists()).toBe(false);
  });

  it("explains a missing rollout without claiming there is no data", async () => {
    vi.mocked(fleet.getRollout).mockRejectedValue({ response: { status: 404 } });
    wrapper = await mountDrawer("gone");
    const text = wrapper.find('[data-test="fleet-rollouts-detail-not-found"]').text();
    expect(text).toContain("This rollout no longer exists");
    expect(text).not.toContain("no data");
  });

  it("keeps this fleet's rollouts under a stale-data banner when a refresh fails", async () => {
    wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="fleet-rollouts-stale"]').exists()).toBe(false);
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(wrapper.find('[data-test="fleet-rollouts-stale"]').exists()).toBe(true);
    expect(bodyText(wrapper)).toContain("edge-newer");
  });

  it("shows the load error when a refresh fails and the cache holds only other fleets' rollouts", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [items[1]] } } as any);
    wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="fleet-rollout-table-empty"]').exists()).toBe(true);
    vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(wrapper.find('[data-test="fleet-rollout-table-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollouts-stale"]').exists()).toBe(false);
  });

  it("drops a loaded rollout for the not-found state when a refetch returns 404", async () => {
    wrapper = await mountDrawer("r3");
    expect(wrapper.find('[data-test="fleet-rollout-outcome-revert"]').exists()).toBe(true);
    vi.mocked(fleet.getRollout).mockRejectedValue({ response: { status: 404 } });
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(wrapper.find('[data-test="fleet-rollouts-detail-not-found"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollout-outcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-rollout-outcome-revert"]').exists()).toBe(false);
  });

  it("keeps a loaded rollout under a stale-data banner when a refetch fails otherwise", async () => {
    wrapper = await mountDrawer("r3");
    expect(wrapper.find('[data-test="fleet-rollouts-detail-stale"]').exists()).toBe(false);
    vi.mocked(fleet.getRollout).mockRejectedValue(new Error("boom"));
    await queryClient.refetchQueries({ type: "active" });
    await settle();
    expect(wrapper.find('[data-test="fleet-rollouts-detail-stale"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-rollout-outcome-revert"]').exists()).toBe(true);
  });

  it("retries a rollout that failed to load", async () => {
    vi.mocked(fleet.getRollout)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({
        data: {
          ...rollout({ id: "late", config: "late-config" }),
          members: [],
          still_on_previous: 0,
        },
      } as any);
    wrapper = await mountDrawer("late");
    const error = wrapper.find('[data-test="fleet-rollouts-detail-error"]');
    expect(error.exists()).toBe(true);
    error.findComponent({ name: "OEmptyState" }).vm.$emit("action", "retry");
    await settle();
    expect(fleet.getRollout).toHaveBeenCalledTimes(2);
    expect(drawer(wrapper).find("h2").text()).toBe("late-config");
  });

  it("asks the fleet to retry a halted rollout with that revision", async () => {
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-retry"]').trigger("click");
    expect(wrapper.emitted("retry")?.at(-1)?.[0]).toMatchObject({
      id: "r3",
      fleetId: "f1",
      toVersion: 2,
    });
  });

  it("passes the outcome's navigation up", async () => {
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-edit"]').trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([{ tab: "editor", query: { id: "edge" } }]);
  });

  it("says a scheduled rollout was scheduled, not started, and when it starts", async () => {
    const scheduled = rollout({
      id: "r9",
      status: "scheduled",
      scheduled_for: Date.now() + 2 * 3600_000,
      attempted: 0,
      accepted: 0,
      assigned: 0,
    });
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [scheduled] } } as any);
    vi.mocked(fleet.getRollout).mockResolvedValue({
      data: { ...scheduled, members: ["c1", "c2"], still_on_previous: 0 },
    } as any);
    wrapper = await mountDrawer();
    expect(bodyText(wrapper)).toContain("Starts in 2h");
    await wrapper.setProps({ rolloutId: "r9" });
    await settle();
    const d = drawer(wrapper);
    expect(d.text()).toContain("Scheduled by ana@acme.io");
    expect(d.text()).not.toContain("Started by");
  });

  it("titles the staged, halted, superseded and auto-reverted events", async () => {
    vi.mocked(fleet.getRollout).mockResolvedValueOnce({
      data: {
        ...items[1],
        strategy: "canary",
        status: "superseded",
        phases: [
          { ...phase(1, "done"), id: "p1", label: "canary" },
          { ...phase(2, "pending"), id: "p2", label: "remaining" },
        ],
        events: [
          { key: "deploying", at: 1, phase: 0 },
          { key: "observing", at: 2 },
          { key: "gatePassed", at: 3 },
          { key: "deploying", at: 4, phase: 1 },
          { key: "gateFailed", at: 5 },
          { key: "halted", at: 6 },
          { key: "superseded", at: 7 },
          { key: "autoReverted", at: 8 },
        ],
        members: ["c1", "c2", "c3"],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer("r2");
    const titles = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((i) => String(i.props("title")));
    expect(titles).toEqual([
      "Sending to 1 collector",
      "Observing for 10 minutes, then checking heartbeats for 5",
      "Health gates passed",
      "Sending to 2 collectors",
      "Health gate failed",
      "Halted",
      "Superseded by a newer desired version",
      "Reverted automatically to the stable version",
    ]);
  });

  it("adds the rejected event to the drawer timeline", async () => {
    vi.mocked(fleet.getRollout).mockResolvedValueOnce({
      data: {
        ...items[2],
        events: [
          { key: "deploying", at: 1 },
          { key: "rejected", at: 2 },
        ],
        members: ["c1"],
        still_on_previous: 0,
      },
    } as any);
    wrapper = await mountDrawer("r3");
    const titles = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((i) => String(i.props("title")));
    expect(titles).toEqual(["Sending to 2 collectors", "Rejected by 1 collector"]);
  });
});
