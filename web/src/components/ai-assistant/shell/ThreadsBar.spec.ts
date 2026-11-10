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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import config from "@/aws-exports";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import ThreadsBar from "./ThreadsBar.vue";

const mocks = vi.hoisted(() => ({
  incidents: { value: [] as unknown[] | null, error: false },
  rows: { value: [] as unknown[] },
  push: vi.fn(),
  floatChat: vi.fn(),
  shortcut: null as null | (() => void),
}));

vi.mock("@tanstack/vue-query", async () => {
  const { computed, reactive: live } = await import("vue");
  const list = live(mocks.incidents);
  return {
    useQuery: () => ({
      data: computed(() => (list.value === null ? undefined : { incidents: list.value })),
      isError: computed(() => list.error),
    }),
  };
});
vi.mock("@/composables/assistant", async () => {
  const { computed, reactive: live } = await import("vue");
  const rows = live(mocks.rows);
  return {
    useAssistantRuns: () => ({ rows: computed(() => rows.value), open: vi.fn() }),
    useAssistantStore: () => ({
      state: { sessions: { s1: { sid: "s1" } } },
      floatChat: mocks.floatChat,
      openSession: vi.fn(() => Promise.resolve()),
    }),
  };
});
vi.mock("@/composables/useFeatureLock", async (importOriginal) => {
  const { ref } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/useFeatureLock")>()),
    useLicenseLock: () => ({ locked: ref(false), lockedReason: ref("") }),
  };
});
vi.mock("@/lib/vue-shortcut-manager", () => ({
  useShortcuts: (list: { id: string; handler: () => void }[]) => {
    mocks.shortcut = list.find((s) => s.id === "threadsBarOpen")?.handler ?? null;
  },
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./AssistantTray.vue", () => ({
  default: { name: "AssistantTray", template: "<div />" },
  trayState: () => "idle",
}));

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    this.callback();
  }
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const live = (id: string, created_at: number) => ({
  id,
  title: `INC ${id}`,
  severity: "P1",
  created_at,
  rca: { state: "running", stale: false },
});

const mountBar = () =>
  mount(ThreadsBar, {
    props: { order: [], visibleBars: 2 },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });

describe("ThreadsBar", () => {
  const original = config.isEnterprise;

  beforeEach(() => {
    config.isEnterprise = "true";
    store.state.zoConfig = { ...store.state.zoConfig, incidents_enabled: true };
    reactive(mocks.incidents).value = Array.from({ length: 7 }, (_, i) => live(`i${i}`, i));
    reactive(mocks.incidents).error = false;
    reactive(mocks.rows).value = [
      { sid: "s1", title: "Add a p95 panel", group: "needs_you" },
      { sid: "s2", title: "Why slow", group: "answering" },
    ];
    mocks.push.mockReset().mockResolvedValue(undefined);
    mocks.floatChat.mockReset().mockReturnValue({ ok: true });
  });

  afterEach(() => {
    config.isEnterprise = original;
    document.body.innerHTML = "";
  });

  it("shows the newest five live incident runs, N more, and own threads with their signal", async () => {
    const wrapper = mountBar();
    await flushPromises();
    const incidentPills = wrapper.findAll('[data-test^="threads-bar-pill-incident-"]');
    expect(incidentPills.map((p) => p.attributes("data-test"))).toEqual([
      "threads-bar-pill-incident-i6",
      "threads-bar-pill-incident-i5",
      "threads-bar-pill-incident-i4",
      "threads-bar-pill-incident-i3",
      "threads-bar-pill-incident-i2",
    ]);
    expect(wrapper.get('[data-test="threads-bar-pill-more"]').text()).toContain("2");
    expect(wrapper.get('[data-test="threads-bar-pill-thread-s1"]').attributes("data-signal")).toBe(
      "approval",
    );
    expect(wrapper.get('[data-test="threads-bar-pill-thread-s2"]').attributes("data-signal")).toBe(
      "running",
    );
  });

  it("collapses the incidents section to one line when no run is live", async () => {
    reactive(mocks.incidents).value = [];
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="threads-bar-incidents-none"]').text()).toContain(
      "No incident has a live RCA run",
    );
  });

  it("says the incident list is loading or failed until a page arrives, never that no run is live", async () => {
    reactive(mocks.incidents).value = null;
    const wrapper = mountBar();
    mocks.shortcut?.();
    await flushPromises();
    const note = () => wrapper.get('[data-test="threads-bar-incidents-note"]');
    expect(note().attributes("data-state")).toBe("incidentsLoading");
    reactive(mocks.incidents).error = true;
    await flushPromises();
    expect(note().attributes("data-state")).toBe("incidentsFailed");
    expect(note().text()).not.toContain("No incident has a live RCA run");
  });

  it("keeps the 50+ open hint on the one-line section when a full page holds no live run", async () => {
    reactive(mocks.incidents).value = Array.from({ length: 50 }, (_, i) => ({
      ...live(`i${i}`, i),
      rca: { state: "done", stale: false },
    }));
    const wrapper = mountBar();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="threads-bar-incidents-full"]').text()).toContain("50+ open");
  });

  it("shows no incidents off enterprise", async () => {
    config.isEnterprise = "false";
    const wrapper = mountBar();
    await flushPromises();
    expect(wrapper.find('[data-test^="threads-bar-pill-incident-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="threads-bar-pill-thread-s1"]').exists()).toBe(true);
  });

  it("opens on the shortcut, moves with the arrows, opens with Enter and closes on Escape", async () => {
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    const panel = wrapper.get('[data-test="threads-bar-panel"]');
    const items = panel.findAll("[data-threads-item]");
    const first = items.findIndex(
      (item) => item.attributes("data-test") === "threads-bar-thread-s1",
    );
    expect(document.activeElement).toBe(items[first].element);
    await panel.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[first + 1].element);
    await panel.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[first].element);
    await panel.trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-test="threads-bar-panel"]').exists()).toBe(false);
  });

  it("focuses the first thread, not the incidents link, so Enter never leaves the page", async () => {
    reactive(mocks.incidents).value = [];
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents-all"]').exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get('[data-test="threads-bar-thread-s1"]').element);
  });

  it("left-aligns thread and incident titles in the panel", async () => {
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    for (const sel of [
      '[data-test="threads-bar-thread-s1"]',
      '[data-test="threads-bar-incident-i6"]',
    ])
      expect(wrapper.get(sel).find(".text-start").exists()).toBe(true);
  });

  it("paints every pill opaque over the outline variant's transparent fill", async () => {
    const wrapper = mountBar();
    await flushPromises();
    const pills = wrapper.findAll(
      '[data-test="threads-bar-toggle"], [data-test^="threads-bar-pill-"]',
    );
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) expect(pill.classes()).toContain("bg-surface-base!");
  });

  it("keeps the toggle from shrinking and lets the pills shrink to fit the page area", async () => {
    const wrapper = mountBar();
    await flushPromises();
    expect(wrapper.get('[data-test="threads-bar-toggle"]').classes()).toContain("shrink-0");
    expect(wrapper.get('[data-test="threads-bar-pill-thread-s1"]').classes()).toContain("min-w-0");
    expect(wrapper.get('[data-test="threads-bar"]').classes()).toContain(
      "max-w-[var(--o-threads-bar-max,none)]",
    );
  });

  it("caps the open panel at the bar's page-area width, so a narrow page never pushes it past its start", async () => {
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.get('[data-test="threads-bar-panel"]').classes()).toContain(
      "max-w-[min(100%,calc(100vw-2rem))]",
    );
  });

  it("publishes the band it covers for the page to reserve, and clears it when gone", async () => {
    const main = document.createElement("main");
    main.dataset.test = "main-content";
    main.getBoundingClientRect = () => ({ width: 800 }) as DOMRect;
    document.body.append(main);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: window.innerHeight - 46, height: 34 } as DOMRect);
    const wrapper = mountBar();
    await flushPromises();
    const inset = () => document.documentElement.style.getPropertyValue("--o-threads-bar-inset");
    expect(Number(inset())).toBeCloseTo(46 / 16);
    expect(
      wrapper
        .get('[data-test="threads-bar"]')
        .element.style.getPropertyValue("--o-threads-bar-max"),
    ).toBe("48.5rem");
    wrapper.unmount();
    expect(inset()).toBe("");
    rect.mockRestore();
  });

  it("opens an incident pill on its analysis tab", async () => {
    const wrapper = mountBar();
    await flushPromises();
    await wrapper.get('[data-test="threads-bar-pill-incident-i6"]').trigger("click");
    expect(mocks.push).toHaveBeenCalledWith({
      name: "incidentDetail",
      params: { id: "i6" },
      query: { org_identifier: "default", tab: "incidentAnalysis" },
    });
  });

  it("opens a thread pill as Float", async () => {
    const wrapper = mountBar();
    await flushPromises();
    await wrapper.get('[data-test="threads-bar-pill-thread-s1"]').trigger("click");
    expect(mocks.floatChat).toHaveBeenCalledWith("s1");
  });
});
