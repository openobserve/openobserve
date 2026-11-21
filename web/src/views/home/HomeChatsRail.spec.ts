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
import { SEARCH_DEBOUNCE_MS } from "@/components/ai-assistant/history/AssistantChatSearch.vue";
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
  historySearch = false,
  patchHistory = (history: AssistantHistory) => history,
  thread = false,
  investigations = false,
} = {}) {
  fake.current = fakeAssistant("available", { persistence, historySearch }, {}, 80, true);
  for (const row of seed) fake.current.db.rows.set(row.id, structuredClone(row));
  fake.current.history = patchHistory(fake.current.history);
  const router = fakeRouter();
  const wrapper = mount(HomeChatsRail, {
    props: { thread, investigations },
    global: { plugins: [router, fakeVuex()], stubs: historyStubs },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

const rows = (wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) =>
  wrapper.findAll('[data-test="assistant-history-row"]');

async function search(wrapper: Awaited<ReturnType<typeof setup>>["wrapper"], q: string) {
  await wrapper.get('[data-test="assistant-history-search-open"]').trigger("click");
  await flushPromises();
  await wrapper.get('[data-test="assistant-chat-search-input"] input').setValue(q);
  await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
  await flushPromises();
  return wrapper.findAll('[data-test="assistant-chat-search-result"]');
}

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
  it("heads the shared chat list with Chats, search and New chat, groups the chats by day with no time per row, from one list read", async () => {
    const listChats = vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        chat(1, NOW - HOUR, { title: "Waiting on approval", pending_approval: true }),
        chat(2, NOW - 2 * HOUR, { title: "Checkout errors" }),
        chat(3, NOW - 26 * HOUR, { title: "Slow login" }),
      ],
    });
    const { wrapper } = await setup({ persistence: true });
    expect(wrapper.get('[data-test="assistant-history-heading"]').text()).toBe("Chats");
    expect(wrapper.get('[data-test="home-chats-rail-new"]').attributes("aria-label")).toBe(
      "New chat",
    );
    expect(wrapper.get('[data-test="assistant-history"]').attributes("data-mode")).toBe("rail");
    expect(
      wrapper.get('[data-test="assistant-history-search-open"]').attributes("aria-label"),
    ).toBe("Search chats");
    const groups = wrapper.findAll('[data-test="assistant-history-group"]');
    expect(groups.map((group) => group.attributes("data-group"))).toEqual([
      "needs_you",
      "today",
      "yesterday",
    ]);
    expect(groups[0].get('[data-test="assistant-history-row-state"]').text()).toBe("Needs you");
    expect(groups[1].text()).toContain("Checkout errors");
    expect(wrapper.find('[data-test="assistant-history-row-time"]').exists()).toBe(false);
    expect(groups[2].text()).toContain("Slow login");
    expect(listChats).toHaveBeenCalledTimes(1);
  });

  it("sits on the page's backdrop: no panel surface or band border, the main column's top padding, filter and list menu shown on hover", async () => {
    const { wrapper } = await setup({ seed: [record(1, "Alpha")] });
    expect(wrapper.get('[data-test="home-chats-rail"]').classes()).toContain("pt-4");
    const list = wrapper.get('[data-test="assistant-history"]').classes();
    expect(list).not.toContain("bg-surface-panel");
    expect(list).toContain("group/list");
    const tools = wrapper.get('[data-test="assistant-history-tools"]').classes();
    expect(tools).not.toContain("border-b");
    expect(tools).not.toContain("border-border-default");
    expect(wrapper.find('[data-test="assistant-history-search"]').exists()).toBe(false);
    const menu = wrapper.get('[data-test="assistant-history-list-menu"]').classes();
    expect(menu).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover/list:opacity-100",
        "group-focus-within/list:opacity-100",
        "pointer-coarse:opacity-100",
      ]),
    );
    expect(list).toEqual(expect.arrayContaining(["px-3"]));
    expect(wrapper.get('[data-test="assistant-history-item"]').classes()).toEqual(
      expect.arrayContaining(["-mx-3", "px-3"]),
    );
    expect(wrapper.find('[data-test="assistant-history-views"]').exists()).toBe(false);
  });

  it("lays every row out as a one-line title, the status light only where there is one, then the menu", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        chat(1, NOW - HOUR, { title: "Waiting on approval", pending_approval: true }),
        chat(2, NOW - 2 * HOUR, { title: "Checkout errors" }),
      ],
    });
    const { wrapper } = await setup({ persistence: true });
    const lights = wrapper.findAll('[data-test="assistant-history-row-light"]');
    expect(lights.map((light) => light.attributes("data-signal"))).toEqual(["attention"]);
    for (const row of rows(wrapper)) {
      expect(row.classes()).toContain("min-h-9");
      expect(row.get('[data-test="o-truncated-text"]').classes()).toContain("truncate");
    }
    expect(wrapper.find('[data-test="assistant-history-row-time"]').exists()).toBe(false);
    const state = wrapper.get('[data-test="assistant-history-row-state"]');
    expect(state.classes()).toEqual(["sr-only"]);
    expect(state.text()).toBe("Needs you");
    expect(wrapper.findAll('[data-test="assistant-history-row-menu"]')).toHaveLength(2);
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
    await rows(wrapper)[0].trigger("keydown", { key: "Escape" });
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
    await rows(wrapper)[0].trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(focus).not.toHaveBeenCalled();
    off();
  });

  it("searches the chats in a dialog, highlights the match and opens the chosen chat with Enter", async () => {
    const { wrapper, router } = await setup({ seed: [record(1, "Alpha"), record(2, "Gamma")] });
    expect(rows(wrapper)).toHaveLength(2);
    const results = await search(wrapper, "gamma");
    expect(results.map((row) => row.text())).toEqual([expect.stringContaining("Gamma")]);
    expect(results[0].get("mark").text()).toBe("Gamma");
    expect(results[0].attributes("aria-selected")).toBe("true");
    await wrapper.get('[data-test="assistant-chat-search-input"] input').trigger("keydown", {
      key: "Enter",
    });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("assistant");
    expect(router.currentRoute.value.params.chatId).toBe(SID(2));
    expect(fake.current!.history.filter.value).toMatchObject({ kind: "all" });
  });

  it("asks the server with q when it searches, shows only its answer and leaves the list behind alone", async () => {
    const listChats = vi
      .spyOn(assistant, "listChats")
      .mockImplementation(async (_org, params = {}) =>
        params.q
          ? { chats: [chat(3, NOW - 3 * HOUR, { title: "Older nginx parser" })] }
          : {
              chats: [
                chat(1, NOW - HOUR, { title: "Alpha" }),
                chat(2, NOW - HOUR, { title: "Beta" }),
              ],
            },
      );
    const { wrapper } = await setup({ persistence: true, historySearch: true });
    await search(wrapper, "nginx");
    expect(listChats).toHaveBeenCalledWith("default", expect.objectContaining({ q: "nginx" }));
    await vi.waitFor(() =>
      expect(
        wrapper.findAll('[data-test="assistant-chat-search-result"]').map((row) => row.text()),
      ).toEqual([expect.stringContaining("Older nginx parser")]),
    );
    expect(rows(wrapper)).toHaveLength(2);
    expect(fake.current!.history.filter.value).toMatchObject({ kind: "all" });
  });

  it("reads a server match whose stored title hides the hit, and shows the matched prompt as its snippet", async () => {
    vi.spyOn(assistant, "listChats").mockImplementation(async (_org, params = {}) => ({
      chats: params.q
        ? [
            chat(4, NOW - HOUR, {
              title: "Say in one short sentence what you will do, then list my…",
            }),
          ]
        : [chat(1, NOW - HOUR, { title: "Alpha" })],
    }));
    const getChat = vi.spyOn(assistant, "getChat").mockResolvedValue({
      ...chat(4, NOW - HOUR),
      turns: [
        {
          turn_id: "t1",
          user: { text: "Say in one short sentence what you will do, then list my streams" },
          frames: [{ type: "message_delta", content: "I'll list your streams." }],
        },
      ],
    } as never);
    const { wrapper } = await setup({ persistence: true, historySearch: true });
    await search(wrapper, "streams");
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="assistant-chat-search-snippet"]').exists()).toBe(true),
    );
    expect(getChat).toHaveBeenCalledWith("default", SID(4), undefined);
    const snippet = wrapper.get('[data-test="assistant-chat-search-snippet"]');
    expect(snippet.text()).toBe("… what you will do, then list my streams");
    expect(snippet.get("mark").text()).toBe("streams");
  });

  it("shows a snippet of a loaded message that holds the match, and moves the choice with the arrows", async () => {
    const seed = [record(1, "Alpha"), record(2, "Gamma")];
    seed[0].messages.push({
      role: "assistant",
      content: raw("You have 47 log streams in default"),
    });
    const { wrapper } = await setup({ seed });
    const results = await search(wrapper, "streams");
    expect(results).toHaveLength(1);
    expect(results[0].get('[data-test="assistant-chat-search-snippet"]').text()).toBe(
      "You have 47 log streams in default",
    );
    expect(results[0].find('[data-test="assistant-chat-search-title"] mark').exists()).toBe(false);
    const all = await search(wrapper, "a");
    expect(all.length).toBe(2);
    const input = wrapper.get('[data-test="assistant-chat-search-input"] input');
    await input.trigger("keydown", { key: "ArrowDown" });
    const now = wrapper.findAll('[data-test="assistant-chat-search-result"]');
    expect(now.map((row) => row.attributes("aria-selected"))).toEqual(["false", "true"]);
    expect(input.attributes("aria-activedescendant")).toBe(now[1].attributes("id"));
  });

  it("keeps the highlighted chat when a peeked match loads and the results recompute", async () => {
    vi.spyOn(assistant, "listChats").mockImplementation(async (_org, params = {}) => ({
      chats: params.q
        ? [
            chat(1, NOW - HOUR, { title: "Hidden one" }),
            chat(2, NOW - 2 * HOUR, { title: "Hidden two" }),
          ]
        : [chat(1, NOW - HOUR, { title: "Alpha" })],
    }));
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(assistant, "getChat").mockImplementation(async (_org, sid) => {
      await gate;
      return {
        ...chat(sid === SID(1) ? 1 : 2, NOW - HOUR),
        turns: [{ turn_id: "t1", user: { text: "list my streams" }, frames: [] }],
      } as never;
    });
    const { wrapper } = await setup({ persistence: true, historySearch: true });
    await search(wrapper, "streams");
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-test="assistant-chat-search-result"]')).toHaveLength(2),
    );
    await wrapper
      .get('[data-test="assistant-chat-search-input"] input')
      .trigger("keydown", { key: "ArrowDown" });
    release();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="assistant-chat-search-snippet"]').exists()).toBe(true),
    );
    const now = wrapper.findAll('[data-test="assistant-chat-search-result"]');
    expect(now.map((row) => row.attributes("aria-selected"))).toEqual(["false", "true"]);
  });

  it("opens the chat matching what was typed when Enter beats the search debounce", async () => {
    const { wrapper, router } = await setup({ seed: [record(1, "Alpha"), record(2, "Gamma")] });
    expect(await search(wrapper, "a")).toHaveLength(2);
    const input = wrapper.get('[data-test="assistant-chat-search-input"] input');
    await input.setValue("gamma");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.params.chatId).toBe(SID(2));
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

  it("on the investigate page lists only investigations, with no filter controls, and leaves the stored filter alone", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        chat(1, NOW - HOUR, { title: "Checkout latency", agent_type: "sre" }),
        chat(2, NOW - 2 * HOUR, { title: "Write a query", agent_type: "o2-ai" }),
        chat(3, NOW - 3 * HOUR, { title: "Error spike", agent_type: "sre" }),
      ],
    });
    const { wrapper } = await setup({
      persistence: true,
      investigations: true,
      patchHistory: (history) => {
        history.setFilter({ kind: "shared" });
        return history;
      },
    });
    const history = fake.current!.history;
    const stored = { ...history.filter.value };
    expect(wrapper.get('[data-test="assistant-history-heading"]').text()).toBe("Investigations");
    expect(
      wrapper.get('[data-test="assistant-history-search-open"]').attributes("aria-label"),
    ).toBe("Search investigations");
    expect(wrapper.find('[data-test="assistant-history-list-menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-history-filter"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-history-filter-active"]').exists()).toBe(false);
    expect(rows(wrapper).map((row) => row.text())).toEqual([
      expect.stringContaining("Checkout latency"),
      expect.stringContaining("Error spike"),
    ]);
    const results = await search(wrapper, "spike");
    expect(results.map((row) => row.text())).toEqual([expect.stringContaining("Error spike")]);
    expect(history.filter.value).toEqual(stored);
  });

  it("on the investigate page keeps reading older pages until an investigation shows", async () => {
    const listChats = vi
      .spyOn(assistant, "listChats")
      .mockImplementation(async (_org, params = {}) =>
        params.cursor === "p2"
          ? { chats: [chat(3, NOW - 30 * HOUR, { title: "Old spike", agent_type: "sre" })] }
          : {
              chats: [chat(1, NOW - HOUR, { title: "Write a query", agent_type: "o2-ai" })],
              next_cursor: "p2",
            },
      );
    const { wrapper } = await setup({ persistence: true, investigations: true });
    await flushPromises();
    expect(listChats).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: "p2" }),
    );
    expect(rows(wrapper).map((row) => row.text())).toEqual([expect.stringContaining("Old spike")]);
  });

  it("on the investigate page reads past a page that holds only hidden helper chats", async () => {
    const pages: Record<string, Awaited<ReturnType<typeof assistant.listChats>>> = {
      first: {
        chats: [chat(1, NOW - HOUR, { title: "Write a query", agent_type: "o2-ai" })],
        next_cursor: "p2",
      },
      p2: {
        chats: [chat(2, NOW - 2 * HOUR, { title: "Helper", agent_type: "generate_query" })],
        next_cursor: "p3",
      },
      p3: { chats: [chat(3, NOW - 30 * HOUR, { title: "Old spike", agent_type: "sre" })] },
    };
    vi.spyOn(assistant, "listChats").mockImplementation(
      async (_org, params = {}) => pages[params.cursor ?? "first"],
    );
    const { wrapper } = await setup({ persistence: true, investigations: true });
    await flushPromises();
    expect(rows(wrapper).map((row) => row.text())).toEqual([expect.stringContaining("Old spike")]);
  });

  it("on the investigate page names an empty list as no investigations, not a filter miss", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [chat(1, NOW - HOUR, { title: "Write a query", agent_type: "o2-ai" })],
    });
    const { wrapper } = await setup({ persistence: true, investigations: true });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-history-filter-empty"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-history-investigations-empty"]').text()).toContain(
      "No investigations yet",
    );
  });
});
