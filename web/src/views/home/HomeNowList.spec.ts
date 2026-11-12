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

import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { homeReturnFor } from "@/composables/goto/homeReturn";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import HomeNowList from "./HomeNowList.vue";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  store: {
    state: { userOrgKey: "k1", sessions: {} as Record<string, { turn: unknown }> },
  },
  creditMode: { value: null as string | null },
  gate: { value: "available" },
  runs: { active: 0, cap: 3 },
  requestOpen: vi.fn(),
}));

vi.mock("@/composables/assistant", async () => {
  const { computed, reactive } = await import("vue");
  mocks.store.state = reactive(mocks.store.state);
  return {
    openAssistant: mocks.open,
    contextChipFor: (field: string, id: string) => ({ id: `${field}:${id}`, kind: "incident" }),
    useAssistantCapability: () =>
      computed(() => ({ creditMode: mocks.creditMode.value, gate: mocks.gate.value })),
    useAssistantRuns: () => ({
      active: computed(() => mocks.runs.active),
      cap: computed(() => mocks.runs.cap),
      requestOpen: mocks.requestOpen,
    }),
    useAssistantStore: () => mocks.store,
  };
});

const service = (name = "checkout"): OverviewNowRow => ({
  kind: "service",
  key: `service:${name}`,
  id: name,
  bucket: "degraded",
  changedAt: 1_762_300_000_000_000,
  service: name,
  errorRate: 6,
  requests: 100,
  p99Ms: null,
  p99Ratio: null,
  baselineErrorRate: 0.4,
  baselineHours: 24,
  signal: "errors",
  coverage: "none",
  partial: false,
});

const checkout = service();

const snapshot = (rows: OverviewNowRow[] = [checkout]): OverviewNowSnapshot => ({
  rows,
  selectedKey: null,
  window: { start: 1_762_296_400_000_000, end: 1_762_300_000_000_000 },
  services: {
    available: true,
    partial: false,
    dataUntil: Date.UTC(2026, 10, 5, 9, 40) * 1000,
    window: null,
    allRegions: true,
  },
  noData: false,
});

const mountList = (props: Record<string, unknown> = {}) =>
  mount(HomeNowList, {
    props: {
      snapshot: snapshot(),
      org: "acme",
      timezone: "UTC",
      trend: null,
      returnState: { period: "1h" },
      createAlert: { enabled: true },
      ...props,
    } as never,
    global: { plugins: [i18n, store] },
  });

describe("HomeNowList", () => {
  beforeEach(() => {
    mocks.open.mockReset().mockResolvedValue({ ok: true, sid: "s1" });
    mocks.creditMode.value = null;
    mocks.gate.value = "available";
    mocks.runs.active = 0;
    for (const sid of Object.keys(mocks.store.state.sessions))
      delete mocks.store.state.sessions[sid];
  });

  it("titles the list Problems with no alert with its count and note, as one joined list", () => {
    const wrapper = mountList({ snapshot: snapshot([checkout, service("cart")]) });
    expect(wrapper.get("h2").text()).toBe("Problems with no alert");
    const count = wrapper.get('[data-test="home-now-count"]');
    expect(count.text()).toBe("2");
    expect(count.classes()).not.toContain("bg-linear-to-br");
    expect(wrapper.get('[data-test="home-now-problems-note"]').text()).toBe(
      "Matched by service name in your alert queries",
    );
    expect(wrapper.get('[data-test="home-now-rows"]').classes()).not.toContain("gap-2");
    const row = wrapper.get('[data-test="home-now-row-service:checkout"]').classes();
    expect(row).toContain("border-b-[0.0625em]");
    expect(row).not.toContain("rounded-surface");
    for (const gone of ["services-until", "all-regions", "more-degraded", "clear", "loading"])
      expect(wrapper.find(`[data-test="home-now-${gone}"]`).exists()).toBe(false);
  });

  it("offers Create alert to an editor and shows it disabled to a viewer", async () => {
    const wrapper = mountList();
    expect(wrapper.get('[data-test="home-now-row-no-alert"]').text()).toBe(
      "No alert matches this service",
    );
    await wrapper.get('[data-test="home-now-row-create-alert"]').trigger("click");
    expect(wrapper.emitted("createAlert")).toEqual([[checkout]]);
    const viewer = mountList({ createAlert: { enabled: false } });
    const create = viewer.get('[data-test="home-now-row-create-alert"]');
    expect(create.attributes("aria-disabled")).toBe("true");
    await create.trigger("click");
    expect(viewer.emitted("createAlert")).toBeUndefined();
  });

  it("hands a row to a new sidebar chat, selects it and arms the way back", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("select")).toEqual([[checkout]]);
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ objectKind: "service_edge", container: "sidebar", thread: "new" }),
    );
    expect(homeReturnFor("s1" as never)).toEqual({ period: "1h", row: "service:checkout" });
  });

  it("does not send at the run cap and says how many chats run", async () => {
    mocks.runs.active = 3;
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="home-now-row-note"]').text()).toContain(
      "Not sent: 3 chats running",
    );
  });

  it("names the page a row opens when the assistant cannot chat, and opens it", async () => {
    for (const [creditMode, gate] of [
      ["exhausted", "available"],
      [null, "off_for_org"],
    ] as const) {
      mocks.creditMode.value = creditMode;
      mocks.gate.value = gate;
      const wrapper = mountList();
      const button = wrapper.get('[data-test="home-now-row-investigate"]');
      expect(button.text()).toBe("Open service");
      await button.trigger("click");
      await flushPromises();
      expect(wrapper.emitted("select")).toEqual([[checkout]]);
      expect(wrapper.emitted("fallback")).toEqual([[checkout]]);
    }
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("notes a server run-cap refusal on the row whose chat the door accepted, and opens All chats from it", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
    mocks.store.state.sessions.s1 = { turn: { state: "connecting" } };
    await flushPromises();
    mocks.store.state.sessions.s1.turn = {
      state: "refused",
      error: { code: "run_limit_member", active: 4, limit: 4 },
    };
    await flushPromises();
    expect(wrapper.get('[data-test="home-now-row-note"]').text()).toContain(
      "Not sent: 4 chats running",
    );
    mocks.requestOpen.mockReset();
    await wrapper.get('[data-test="home-now-row-show-runs"]').trigger("click");
    expect(mocks.requestOpen).toHaveBeenCalledTimes(1);
  });

  it("leaves no note when the accepted chat ends any other way", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    mocks.store.state.sessions.s1 = { turn: { state: "done", saved: "server" } };
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("clears row notes when the range changes, and keeps them on a refresh of the same range", async () => {
    mocks.runs.active = 3;
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ snapshot: { ...snapshot(), window: { start: 1, end: 2 } } } as never);
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(true);
    await wrapper.setProps({ returnState: { period: "6h" } } as never);
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("keeps a row's note and refusal watch across a row selection, and drops both on a range change", async () => {
    const other = service("cart");
    const refused = () => ({
      turn: { state: "refused", error: { code: "run_limit_member", active: 4, limit: 4 } },
    });
    mocks.open
      .mockResolvedValueOnce({ ok: true, sid: "s1" })
      .mockResolvedValueOnce({ ok: true, sid: "s2" });
    const wrapper = mountList({ snapshot: snapshot([checkout, other]) });
    await wrapper.findAll('[data-test="home-now-row-investigate"]')[0].trigger("click");
    await flushPromises();
    await wrapper.findAll('[data-test="home-now-row-investigate"]')[1].trigger("click");
    await flushPromises();
    mocks.store.state.sessions.s2 = refused();
    await flushPromises();
    const notes = () => wrapper.findAll('[data-test="home-now-row-note"]');
    expect(notes()).toHaveLength(1);
    await wrapper.setProps({ returnState: { period: "1h", row: other.key } } as never);
    expect(notes()).toHaveLength(1);
    mocks.store.state.sessions.s1 = refused();
    await flushPromises();
    expect(notes()).toHaveLength(2);
    await wrapper.setProps({ returnState: { period: "6h", row: other.key } } as never);
    expect(notes()).toHaveLength(0);
  });

  it("stops a pending refusal watch on a range change", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ returnState: { period: "6h" } } as never);
    mocks.store.state.sessions.s1 = {
      turn: { state: "refused", error: { code: "run_limit_member", active: 4, limit: 4 } },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("keeps each row busy until its own Investigate settles", async () => {
    const pending: Array<(v: unknown) => void> = [];
    mocks.open.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const wrapper = mountList({ snapshot: snapshot([checkout, service("cart")]) });
    const buttons = wrapper.findAll('[data-test="home-now-row-investigate"]');
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await flushPromises();
    pending[1]({ ok: true, sid: "s2" });
    await flushPromises();
    const rows = wrapper.findAllComponents({ name: "HomeNowRow" });
    expect(rows.map((r) => r.props("busy"))).toEqual([true, false]);
    pending[0]({ ok: true, sid: "s1" });
    await flushPromises();
    expect(rows.map((r) => r.props("busy"))).toEqual([false, false]);
  });
});
