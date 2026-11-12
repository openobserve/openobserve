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
import { computed } from "vue";

import {
  fakeAssistant,
  fakeRouter,
  fakeVuex,
} from "@/components/ai-assistant/__tests__/fakeAssistant";
import { historyStubs } from "@/components/ai-assistant/__tests__/historyStubs";
import { SEARCH_DEBOUNCE_MS } from "@/components/ai-assistant/history/AssistantHistoryList.vue";
import type { AssistantHistory } from "@/composables/assistant";
import type { LocalRecord } from "@/composables/assistant/historyDb";
import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";
import assistant, { type ChatSummaryWire } from "@/services/assistant";
import { raw } from "@/types/i18n";
import { setOrgTimeZoneSource } from "@/utils/formatters";

import HomeChatsRail from "./HomeChatsRail.vue";

const { fake } = vi.hoisted(() => ({
  fake: { current: null as ReturnType<typeof fakeAssistant> | null },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current!.store,
  useAssistantCapability: () => fake.current!.handle,
  useAssistantHistory: () => fake.current!.history,
}));
vi.mock("@/services/ai_chat_share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/ai_chat_share")>();
  return {
    ...actual,
    default: { ...actual.default, listMine: vi.fn(async () => ({ data: { shares: [] } })) },
  };
});

const NOW = Date.UTC(2026, 9, 21, 12, 0);
const HOUR = 3_600_000;
const SID = (n: number) => `0190a1b2-c3d4-7e5f-8a9b-${String(n).padStart(12, "0")}`;

function chat(n: number, at: number, over: Partial<ChatSummaryWire> = {}): ChatSummaryWire {
  return {
    session_id: SID(n),
    title: `Chat ${n}`,
    created_at: at * 1_000,
    updated_at: at * 1_000,
    last_committed_seq: 1,
    ...over,
  };
}

function record(id: number, title: string): LocalRecord {
  return {
    id,
    timestamp: new Date(NOW - id * HOUR).toISOString(),
    title,
    messages: [{ role: "user", content: raw(title) }],
    sessionId: SID(id),
    userOrgKey: "k1",
  };
}

async function setup({
  seed = [] as LocalRecord[],
  persistence = false,
  patchHistory = (history: AssistantHistory) => history,
  thread = false,
} = {}) {
  fake.current = fakeAssistant("available", { persistence }, {}, 80, true);
  for (const row of seed) fake.current.db.rows.set(row.id, structuredClone(row));
  fake.current.history = patchHistory(fake.current.history);
  const router = fakeRouter();
  const wrapper = mount(HomeChatsRail, {
    props: { thread },
    global: { plugins: [router, fakeVuex()], stubs: historyStubs },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

const rows = (wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) =>
  wrapper.findAll('[data-test="assistant-history-row"]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setOrgTimeZoneSource(() => "UTC");
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setOrgTimeZoneSource(() => undefined);
  document.body.innerHTML = "";
});

describe("HomeChatsRail", () => {
  it("heads the shared chat list with Chats and New chat, groups the chats by day with a status or time each, from one list read", async () => {
    const listChats = vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        chat(1, NOW - HOUR, { title: "Waiting on approval", pending_approval: true }),
        chat(2, NOW - 2 * HOUR, { title: "Checkout errors" }),
        chat(3, NOW - 26 * HOUR, { title: "Slow login" }),
      ],
    });
    const { wrapper } = await setup({ persistence: true });
    expect(wrapper.get('[data-test="home-chats-rail-header"]').text()).toBe("Chats");
    expect(wrapper.get('[data-test="home-chats-rail-new"]').attributes("aria-label")).toBe(
      "New chat",
    );
    expect(wrapper.get('[data-test="assistant-history"]').attributes("data-mode")).toBe("rail");
    expect(wrapper.find('[data-test="assistant-history-search"]').exists()).toBe(true);
    const groups = wrapper.findAll('[data-test="assistant-history-group"]');
    expect(groups.map((group) => group.attributes("data-group"))).toEqual([
      "running",
      "today",
      "yesterday",
    ]);
    expect(groups[0].get('[data-test="assistant-history-row-state"]').text()).toBe("Needs you");
    expect(groups[1].text()).toContain("Checkout errors");
    expect(groups[1].find('[data-test="assistant-history-row-time"]').exists()).toBe(true);
    expect(groups[2].text()).toContain("Slow login");
    expect(listChats).toHaveBeenCalledTimes(1);
  });

  it("sits on the page's backdrop: no panel surface or band border, the main column's top padding, pill search and filters", async () => {
    const { wrapper } = await setup({ seed: [record(1, "Alpha")] });
    expect(wrapper.get('[data-test="home-chats-rail"]').classes()).toContain("pt-4");
    expect(wrapper.get('[data-test="home-chats-rail-header"]').classes()).not.toContain("border-b");
    const list = wrapper.get('[data-test="assistant-history"]').classes();
    expect(list).not.toContain("bg-surface-panel");
    const tools = wrapper.get('[data-test="assistant-history-tools"]').classes();
    expect(tools).not.toEqual(expect.arrayContaining(["border-b"]));
    expect(tools).not.toContain("border-border-default");
    expect(wrapper.get('[data-test="assistant-history-search"]').classes()).toEqual(
      expect.arrayContaining(["[&>div]:h-7", "[&>div]:rounded-full"]),
    );
    expect(wrapper.get('[data-test="assistant-history-view-all"]').classes()).toEqual(
      expect.arrayContaining(["h-6!", "rounded-full!"]),
    );
  });

  it("lays every row out as status dot, one-line title and the time at the row's end, with the menu over the time", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        chat(1, NOW - HOUR, { title: "Waiting on approval", pending_approval: true }),
        chat(2, NOW - 2 * HOUR, { title: "Checkout errors" }),
      ],
    });
    const { wrapper } = await setup({ persistence: true });
    const lights = wrapper.findAll('[data-test="assistant-history-row-light"]');
    expect(lights.map((light) => light.attributes("data-signal"))).toEqual(["attention", "ready"]);
    expect(lights[1].find(".rounded-full").exists()).toBe(true);
    for (const row of rows(wrapper)) {
      expect(row.classes()).toContain("min-h-9");
      expect(row.get('[data-test="o-truncated-text"]').classes()).toContain("truncate");
    }
    const time = wrapper.get('[data-test="assistant-history-row-time"]').classes();
    expect(time).toContain("min-w-7");
    expect(time).not.toContain("w-12");
    expect(wrapper.get('[data-test="assistant-history-row-state"]').classes()).toContain("min-w-7");
    expect(wrapper.get('[data-test="assistant-history-row-menu"]').classes()).toContain(
      "absolute!",
    );
  });

  it("keeps the browser-only footer on one line, its explanation behind the info icon", async () => {
    const { wrapper } = await setup({ seed: [record(1, "Alpha")] });
    const line = wrapper.get('[data-test="assistant-local-only-line"]');
    expect(line.get('[data-test="o-truncated-text"]').classes()).toContain("truncate");
    expect(line.text()).toBe("Saved in this browser only");
    const info = wrapper.get('[data-test="assistant-local-info"]');
    expect(info.get("span.sr-only").text()).toBe("About browser history");
  });

  it("hands New chat and Escape to the Home Ask box", async () => {
    const focus = vi.fn();
    const off = onOverviewFocusRequest(focus);
    const { wrapper } = await setup({ seed: [record(1, "Alpha")] });
    await wrapper.get('[data-test="home-chats-rail-new"]').trigger("click");
    expect(focus).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="assistant-history-search"] input')
      .trigger("keydown", { key: "Escape" });
    expect(focus).toHaveBeenCalledTimes(2);
    off();
  });

  it("beside an open chat marks it, and New chat goes back to the Ask box while Escape hands focus to the chat", async () => {
    const focus = vi.fn();
    const off = onOverviewFocusRequest(focus);
    const { wrapper, router } = await setup({
      seed: [record(1, "Alpha"), record(2, "Gamma")],
      thread: true,
    });
    fake.current!.store.state.shell.activeSid = SID(2);
    await flushPromises();
    const current = wrapper.findAll('[data-test="assistant-history-item"][data-current]');
    expect(current.map((row) => row.attributes("data-sid"))).toEqual([SID(2)]);
    await router.push({ name: "home", query: { tab: "ai", thread: SID(2), row: "incident:7" } });
    await wrapper.get('[data-test="home-chats-rail-new"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(router.currentRoute.value.query).toEqual({ tab: "ai", row: "incident:7", focus: "ask" });
    await wrapper
      .get('[data-test="assistant-history-search"] input')
      .trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(focus).not.toHaveBeenCalled();
    off();
  });

  it("filters the chats with the list's own search box", async () => {
    const { wrapper } = await setup({ seed: [record(1, "Alpha"), record(2, "Gamma")] });
    expect(rows(wrapper)).toHaveLength(2);
    await wrapper.get('[data-test="assistant-history-search"] input').setValue("gamma");
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
    await flushPromises();
    expect(rows(wrapper).map((row) => row.text())).toEqual([expect.stringContaining("Gamma")]);
  });

  it("opens a chat in the full assistant view", async () => {
    const { wrapper, router } = await setup({ seed: [record(1, "Alpha")] });
    await rows(wrapper)[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("assistant");
    expect(router.currentRoute.value.params.chatId).toBe(SID(1));
    expect(router.currentRoute.value.query.org_identifier).toBe("default");
  });

  it("says No chats yet with no chats", async () => {
    const { wrapper } = await setup();
    expect(wrapper.get('[data-test="assistant-history-empty"]').text()).toContain("No chats yet");
    expect(rows(wrapper)).toHaveLength(0);
  });

  it("says a failed read with Retry", async () => {
    const retry = vi.fn(async () => undefined);
    const { wrapper } = await setup({
      patchHistory: (history) =>
        Object.assign(Object.create(history), {
          listState: computed(() => ({ status: "error", offline: false })),
          retry,
        }),
    });
    expect(wrapper.get('[data-test="assistant-history-error-title"]').text()).toBe(
      "Couldn't load your chats",
    );
    await wrapper.get('[data-test="assistant-history-error-retry"]').trigger("click");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
