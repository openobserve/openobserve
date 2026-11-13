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
import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import ThreadsBar from "./ThreadsBar.vue";

const mocks = vi.hoisted(() => ({
  incidents: { value: [] as unknown[] | null, error: false },
  rows: { value: [] as unknown[] },
  push: vi.fn(),
  floatChat: vi.fn(),
  open: vi.fn(),
  route: { name: "logs" as string, query: {} as Record<string, string> },
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
      open: mocks.open,
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
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push }),
  useRoute: () => mocks.route,
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
    props: { order: [] },
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

  it("badges every listed chat and previews the waiting one first", async () => {
    const wrapper = mountBar();
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-launcher-badge"]').text()).toBe("2");
    await wrapper.get('[data-test="assistant-launcher"]').trigger("pointerenter");
    const previews = wrapper.findAll('[data-test="assistant-launcher-preview"]');
    expect(previews.map((p) => p.attributes("data-signal"))).toEqual(["approval", "running"]);
  });

  it("draws no incidents section or note when no run is live", async () => {
    reactive(mocks.incidents).value = [];
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="threads-bar-incidents-none"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No incident has a live RCA run");
  });

  it("shows no incidents off enterprise", async () => {
    config.isEnterprise = "false";
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="threads-bar-thread-s1"]').exists()).toBe(true);
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

  it("focuses the first thread when no incident is live", async () => {
    reactive(mocks.incidents).value = [];
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar-incidents-all"]').exists()).toBe(false);
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

  it("caps the open panel at the bar's page-area width, so a narrow page never pushes it past its start", async () => {
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    expect(wrapper.get('[data-test="threads-bar-panel"]').classes()).toContain(
      "max-w-[min(100%,calc(100vw-2rem))]",
    );
  });

  it("opens an incident on its analysis tab", async () => {
    const wrapper = mountBar();
    await flushPromises();
    mocks.shortcut?.();
    await flushPromises();
    await wrapper.get('[data-test="threads-bar-incident-i6"]').trigger("click");
    expect(mocks.push).toHaveBeenCalledWith({
      name: "incidentDetail",
      params: { id: "i6" },
      query: { org_identifier: "default", tab: "incidentAnalysis" },
    });
  });

  it("opens a previewed chat as Float", async () => {
    const wrapper = mountBar();
    await flushPromises();
    await wrapper.get('[data-test="assistant-launcher"]').trigger("pointerenter");
    await wrapper.get('[data-test="assistant-launcher-preview"]').trigger("click");
    expect(mocks.floatChat).toHaveBeenCalledWith("s1");
  });

  it("opens a chat on Home instead of as Float while Home's Ask box is on screen", async () => {
    mocks.route.name = "home";
    const stopListening = onOverviewFocusRequest(() => undefined);
    try {
      const wrapper = mountBar();
      await flushPromises();
      await wrapper.get('[data-test="assistant-launcher"]').trigger("pointerenter");
      await wrapper.get('[data-test="assistant-launcher-preview"]').trigger("click");
      expect(mocks.floatChat).not.toHaveBeenCalled();
      expect(mocks.open).toHaveBeenCalledWith({ kind: "full" }, { sid: "s1", focus: "composer" });
      expect(mocks.push).toHaveBeenCalledWith({
        name: "home",
        query: { tab: "ai", thread: "s1" },
      });
    } finally {
      stopListening();
      mocks.route.name = "logs";
    }
  });

  it("opens the Threads panel from the icon", async () => {
    const wrapper = mountBar();
    await flushPromises();
    await wrapper.get('[data-test="assistant-launcher-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="threads-bar-panel"]').exists()).toBe(true);
  });

  it("hides the whole icon when there is nothing to list", async () => {
    reactive(mocks.incidents).value = [];
    reactive(mocks.rows).value = [];
    const wrapper = mountBar();
    await flushPromises();
    expect(wrapper.find('[data-test="threads-bar"]').exists()).toBe(false);
  });
});
