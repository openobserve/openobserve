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
import fleet, { type FleetRollout } from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetRollouts from "./FleetRollouts.vue";
import { apiCollector, apiFleet, apiRollout } from "./fleet.fixtures";

const { confirmMock, toastMock } = vi.hoisted(() => ({ confirmMock: vi.fn(), toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listRollouts: vi.fn(),
    getRollout: vi.fn(),
    listFleets: vi.fn(),
    listCollectors: vi.fn(),
    resumeRollout: vi.fn(),
    rollbackRollout: vi.fn(),
    skipRollout: vi.fn(),
  },
}));

const F1 = { id: "f1", name: "edge-fleet" };

const halted = apiRollout({
  id: "r3",
  fleet: F1,
  status: "halted",
  total: 3,
  running: 1,
  batching: { kind: "canary", first: 2 },
  halt: {
    class: "proven_bad",
    reason: "1 collector rejected: unknown receiver",
    at: Date.now(),
    exits: ["rollback", "fix_forward", "skip"],
  },
  phases: [
    {
      index: 0,
      size: 2,
      status: "failed",
      targeted: 2,
      sent: 2,
      confirmed: 1,
      rejected: 1,
      gate: null,
    },
    {
      index: 1,
      size: 1,
      status: "pending",
      targeted: 0,
      sent: 0,
      confirmed: 0,
      rejected: 0,
      gate: null,
    },
  ],
  members: [
    { collector_id: "c1", phase: 0, state: "running", excluded: false },
    { collector_id: "c2", phase: 0, state: "rejected", excluded: false },
    { collector_id: "c3", phase: 1, state: "pending", excluded: false },
  ],
  events: [
    { at: Date.now() - 60_000, key: "deploying", phase: 0, detail: null },
    { at: Date.now() - 30_000, key: "rejected", phase: 0, detail: "unknown receiver" },
    { at: Date.now() - 30_000, key: "halted", phase: 0, detail: null },
  ],
  started_at: Date.now() - 120_000,
});

const done = apiRollout({ id: "r1", fleet: F1, started_at: Date.now() - 600_000 });
const newer = apiRollout({
  id: "r5",
  fleet: F1,
  config: "edge-newer",
  started_at: Date.now() - 1_000,
});
const other = apiRollout({ id: "r2", config: "gateway", fleet: { id: "f2", name: "f2" } });
const items: FleetRollout[] = [done, other, halted, newer];

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
    props: { open: true, fleetId: "f1", fleetName: "edge-fleet", rolloutId },
    global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
  });
  await settle();
  return wrapper;
}

const org = () => store.state.selectedOrganization.identifier;

describe("FleetRollouts", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    confirmMock.mockResolvedValue(true);
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [
          apiFleet({
            id: "f1",
            name: "edge-fleet",
            state: {
              desired: { config: "edge", version: 2 },
              stable: { config: "edge", version: 1 },
              rollout: { id: "r3", status: "halted" },
              collectors: 3,
              online: 3,
              at_desired: 1,
            },
          }),
        ],
      },
    } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: {
        total: 3,
        items: [
          apiCollector({ id: "c1", name: "web-01" }),
          apiCollector({ id: "c2", name: "web-02" }),
          apiCollector({ id: "c3", name: "web-03" }),
        ],
      },
    } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items } } as any);
    vi.mocked(fleet.getRollout).mockImplementation(
      async (_o: string, id: string) => ({ data: items.find((r) => r.id === id) }) as any,
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
    const text = wrapper.find('[data-test="o2-table-body"]').text();
    expect(text).not.toContain("gateway");
    expect(text.indexOf("Proven bad")).toBeLessThan(text.indexOf("edge-newer"));
    expect(text).not.toMatch(/undefined|null/);
  });

  it("opens a rollout from its row and goes back to the list", async () => {
    wrapper = await mountDrawer();
    await wrapper.findAll('[data-test="o2-table-body"] tr')[0].trigger("click");
    expect(wrapper.emitted("update:rolloutId")?.at(-1)).toEqual(["r3"]);
    await wrapper.setProps({ rolloutId: "r3" });
    await settle();
    await wrapper.find('[data-test="fleet-rollouts-back"]').trigger("click");
    expect(wrapper.emitted("update:rolloutId")?.at(-1)).toEqual([null]);
  });

  it("shows the halt class and reason, the plan and the phases with counts", async () => {
    wrapper = await mountDrawer("r3");
    expect(wrapper.find('[data-test="fleet-rollout-outcome-title"]').text()).toBe(
      "Halted: Proven bad",
    );
    expect(wrapper.find('[data-test="fleet-rollout-outcome-body"]').text()).toContain(
      "unknown receiver",
    );
    expect(wrapper.find('[data-test="fleet-rollouts-plan"]').text()).toBe(
      "Canary: first 2, then the rest",
    );
    expect(wrapper.find('[data-test="fleet-rollout-phases-status-0"]').text()).toBe("Failed");
    expect(wrapper.find('[data-test="fleet-rollout-members-table"]').text()).toContain("web-02");
  });

  it("titles the timeline events, newest first", async () => {
    wrapper = await mountDrawer("r3");
    const titles = wrapper
      .find('[data-test="fleet-rollouts-timeline"]')
      .text()
      .replace(/\s+/g, " ");
    expect(titles).toContain("Halted");
    expect(titles).toContain("Rejected by 1 collector");
    expect(titles).toContain("Deploying phase 1");
    expect(titles.indexOf("Deploying phase 1")).toBeGreaterThan(titles.indexOf("Halted"));
  });

  it("offers the exits the server lists and explains the rest", async () => {
    wrapper = await mountDrawer("r3");
    const btn = (exit: string) => wrapper.find(`[data-test="fleet-rollout-outcome-${exit}"]`);
    expect(btn("rollback").attributes("disabled")).toBeUndefined();
    expect(btn("skip").attributes("disabled")).toBeUndefined();
    expect(btn("fix_forward").attributes("disabled")).toBeUndefined();
    expect(btn("resume").attributes("disabled")).toBeDefined();
  });

  it("rolls back after a confirmation that names the stable version", async () => {
    vi.mocked(fleet.rollbackRollout).mockResolvedValue({ data: halted } as any);
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-rollback"]').trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toContain("edge v1");
    expect(confirmMock.mock.calls[0][0].confirmVariant).toBe("destructive");
    expect(fleet.rollbackRollout).toHaveBeenCalledWith(org(), "r3");
  });

  it("skips exactly the failing members after a confirmation", async () => {
    vi.mocked(fleet.skipRollout).mockResolvedValue({ data: halted } as any);
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-skip"]').trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toContain("Excludes 1 failing collector");
    expect(fleet.skipRollout).toHaveBeenCalledWith(org(), "r3", ["c2"]);
  });

  it("does nothing when an exit is cancelled", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-rollback"]').trigger("click");
    await settle();
    expect(fleet.rollbackRollout).not.toHaveBeenCalled();
  });

  it("hands fix forward to the editor of the rollout's configuration", async () => {
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-fix_forward"]').trigger("click");
    await settle();
    expect(wrapper.emitted("fix-forward")?.[0]?.[0]).toMatchObject({ id: "r3", config: "edge" });
  });

  it("resumes a halt that offers it from its halted phase", async () => {
    const timedOut = {
      ...halted,
      halt: { ...halted.halt!, class: "cannot_see" as const, exits: ["resume" as const] },
    };
    vi.mocked(fleet.getRollout).mockResolvedValue({ data: timedOut } as any);
    vi.mocked(fleet.resumeRollout).mockResolvedValue({ data: timedOut } as any);
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-resume"]').trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toContain("phase 1");
    expect(fleet.resumeRollout).toHaveBeenCalledWith(org(), "r3");
  });

  it("shows the server's reason when an exit is refused", async () => {
    vi.mocked(fleet.rollbackRollout).mockRejectedValue({
      response: { status: 409, data: { message: "rollout is no longer halted" } },
    });
    wrapper = await mountDrawer("r3");
    await wrapper.find('[data-test="fleet-rollout-outcome-rollback"]').trigger("click");
    await settle();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "rollout is no longer halted" }),
    );
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
  ])("shows why a rollout cannot open (%j)", async (err, shown) => {
    vi.mocked(fleet.getRollout).mockRejectedValue(err);
    wrapper = await mountDrawer("gone");
    await settle();
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
  });

  it("says an empty fleet's rollout targeted no collectors and hides its phases", async () => {
    const empty = apiRollout({ id: "r0", fleet: F1, total: 0, running: 0, phases: [] });
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [empty] } } as any);
    vi.mocked(fleet.getRollout).mockResolvedValue({ data: empty } as any);
    wrapper = await mountDrawer("r0");
    expect(wrapper.find('[data-test="fleet-rollout-outcome-title"]').text()).toBe(
      "No collectors targeted",
    );
    expect(wrapper.find('[data-test="fleet-rollout-phases-r0"]').exists()).toBe(false);
  });

  it("says when a scheduled rollout starts", async () => {
    const scheduled = apiRollout({
      id: "r9",
      fleet: F1,
      status: "scheduled",
      start: { kind: "at", at: Date.now() + 30 * 60_000 },
    });
    vi.mocked(fleet.getRollout).mockResolvedValue({ data: scheduled } as any);
    wrapper = await mountDrawer("r9");
    expect(wrapper.find('[data-test="fleet-rollout-outcome-body"]').text()).toMatch(
      /Starts in (30|29)m/,
    );
  });
});
