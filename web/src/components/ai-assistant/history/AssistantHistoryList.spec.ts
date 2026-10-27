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

import type { LocalRecord } from "@/composables/assistant/historyDb";
import aiChatShare from "@/services/ai_chat_share";
import { raw } from "@/types/i18n";
import { setOrgTimeZoneSource } from "@/utils/formatters";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";

import AssistantHistoryConfirm from "./AssistantHistoryConfirm.vue";
import AssistantHistoryList, {
  type AssistantHistoryListProps,
  VIRTUAL_FROM,
} from "./AssistantHistoryList.vue";

const { fake, exporter } = vi.hoisted(() => ({
  fake: { current: null as any },
  exporter: {
    exportChat: vi.fn(),
    exportAll: vi.fn(),
    busy: { value: new Set<string>() },
  },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useAssistantHistory: () => fake.current.history,
  useChatExport: () => exporter,
}));
vi.mock("@/services/ai_chat_share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/ai_chat_share")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      listForChat: vi.fn(async () => ({ data: { shares: [{ id: "a" }, { id: "b" }] } })),
      listMine: vi.fn(async () => ({ data: { shares: [] } })),
    },
  };
});

// 00:10 on 22 Oct in Kolkata; 23:50 the evening before is Yesterday there, not Today.
const NOW = Date.UTC(2026, 9, 21, 18, 40);
const ZONE = "Asia/Kolkata";

function record(id: number, at: number, over: Partial<LocalRecord> = {}): LocalRecord {
  return {
    id,
    timestamp: new Date(at).toISOString(),
    title: `Chat ${id}`,
    messages: [{ role: "user", content: raw(`question ${id}`) }],
    sessionId: `0190ffff-c3d4-7e5f-8a9b-${String(id).padStart(12, "0")}`,
    userOrgKey: "k1",
    ...over,
  };
}

const SEED = [
  record(1, NOW - 5 * 60_000, { title: "Alpha today" }),
  record(2, Date.UTC(2026, 9, 21, 18, 20), { title: "Beta late last night" }),
  record(3, NOW - 3 * 86_400_000, { title: "Gamma this week" }),
  record(4, NOW - 30 * 86_400_000, { title: "Delta older", pinned: true }),
  record(5, NOW - 40 * 86_400_000, { title: "Epsilon older" }),
];

async function setup(
  props: Partial<AssistantHistoryListProps> = {},
  { seed = SEED, canChat = "yes" as const, persistence = false } = {},
) {
  fake.current = fakeAssistant("available", { persistence, canChat }, {}, 80, true);
  for (const row of seed) fake.current.db.rows.set(row.id, structuredClone(row));
  const router = fakeRouter();
  const wrapper = mount(AssistantHistoryList, {
    props: { mode: "popover", currentSid: null, container: "sidebar", ...props },
    global: { plugins: [router, fakeVuex()], stubs: historyStubs },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router, ...fake.current };
}

const rowButtons = (wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) =>
  wrapper.findAll('[data-test="assistant-history-row"]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setOrgTimeZoneSource(() => ZONE);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  setOrgTimeZoneSource(() => undefined);
  document.body.innerHTML = "";
});

describe("AssistantHistoryList", () => {
  it("groups by calendar day in the org zone, pinned first and only there", async () => {
    const { wrapper } = await setup();
    const groups = wrapper.findAll('[data-test="assistant-history-group"]');
    expect(groups.map((g) => g.attributes("data-group"))).toEqual([
      "pinned",
      "today",
      "yesterday",
      "week",
      "older",
    ]);
    expect(groups.map((g) => g.get("h3").text())).toEqual([
      "Pinned",
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Older",
    ]);
    expect(groups[2].text()).toContain("Beta late last night");
    expect(groups[0].text()).toContain("Delta older");
    expect(groups[4].text()).not.toContain("Delta older");
  });

  it("is an APG list with actions: no listbox, groups named by their headings, no control inside a row button", async () => {
    const { wrapper } = await setup();
    const list = wrapper.get('[data-test="assistant-history-list"]');
    expect(list.element.tagName).toBe("UL");
    expect(list.attributes("aria-label")).toBe("Chats");
    expect(wrapper.find('[role="listbox"], [role="option"]').exists()).toBe(false);
    for (const group of wrapper.findAll('[data-test="assistant-history-group"]')) {
      expect(group.attributes("role")).toBe("group");
      const heading = wrapper.get(`#${group.attributes("aria-labelledby")}`);
      expect(heading.element.tagName).toBe("H3");
    }
    for (const button of rowButtons(wrapper))
      expect(button.find("button, a, input, [tabindex]").exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-history"]').attributes("data-dd-privacy")).toBe(
      "mask",
    );
  });

  it("describes itself by the mode line in local mode", async () => {
    const { wrapper } = await setup();
    const list = wrapper.get('[data-test="assistant-history-list"]');
    const line = wrapper.get(`#${list.attributes("aria-describedby")}`);
    expect(line.text()).toBe("Saved in this browser only · 5 of 100");
  });

  it("roves one tab stop over the row buttons with arrows, Home, End and type-ahead", async () => {
    const { wrapper } = await setup();
    const buttons = () => rowButtons(wrapper).map((b) => b.element as HTMLElement);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    await wrapper
      .get('[data-test="assistant-history-search"] input')
      .trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons()[0]);
    await rowButtons(wrapper)[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons()[1]);
    await rowButtons(wrapper)[1].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(buttons().at(-1));
    await rowButtons(wrapper).at(-1)!.trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(buttons()[0]);
    await rowButtons(wrapper)[0].trigger("keydown", { key: "g" });
    expect(document.activeElement?.textContent).toContain("Gamma this week");
    expect(buttons().filter((b) => b.tabIndex === 0)).toEqual([document.activeElement]);
  });

  it("marks the current chat on exactly one row", async () => {
    const { wrapper } = await setup({ currentSid: SEED[2].sessionId! });
    const current = wrapper.findAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].text()).toContain("Gamma this week");
  });

  it("searches on the client and offers Clear search when nothing matches", async () => {
    const { wrapper, history } = await setup();
    history.setFilter({ q: "gamma" });
    await flushPromises();
    expect(rowButtons(wrapper)).toHaveLength(1);
    expect(wrapper.get('[data-test="assistant-history-search-line"]').text()).toBe(
      "1 chat matches",
    );
    history.setFilter({ q: "zzz" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-history-no-match"]').text()).toContain(
      "No chats match “zzz”",
    );
  });

  it("shows the empty state without Delete all chats", async () => {
    const { wrapper } = await setup({}, { seed: [] });
    expect(wrapper.find('[data-test="assistant-history-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-history-clear-all"]').exists()).toBe(false);
  });

  it("leaves speaking to the shell, so two lists never say one outcome twice", async () => {
    const { wrapper, history } = await setup();
    await history.rename(SEED[0].sessionId!, "Renamed");
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(String(history.announcement.value?.text)).toBe("Renamed");
    expect(fake.current.toast).not.toHaveBeenCalled();
  });

  it("confirms a delete in a dialog that starts on Cancel, then removes the row", async () => {
    const { wrapper, db, history } = await setup();
    await wrapper.findAll('[data-test="assistant-history-item"]')[1].trigger("pointerenter");
    await wrapper.get('[data-test="assistant-history-row-delete"]').trigger("click");
    const dialog = wrapper.get('[data-test="assistant-history-delete-dialog"]');
    expect(dialog.get("h2").text()).toBe("Delete “Alpha today”?");
    expect(dialog.text()).toContain("This removes the chat from this browser.");
    await dialog.get('[data-stub="primary"]').trigger("click");
    await flushPromises();
    expect(db.rows.has(1)).toBe(false);
    expect(String(history.announcement.value?.text)).toBe("Chat deleted");
  });

  it("asks to type the word before clearing 25 chats or more", async () => {
    const many = Array.from({ length: 25 }, (_, i) => record(i + 1, NOW - i * 60_000));
    const { wrapper, db } = await setup({}, { seed: many });
    await wrapper.get('[data-test="assistant-history-clear-all"]').trigger("click");
    const dialog = wrapper.get('[data-test="assistant-history-clear-all-dialog"]');
    expect(dialog.get("h2").text()).toBe("Delete all 25 chats?");
    const confirm = dialog.get('[data-stub="primary"]');
    expect(confirm.attributes("disabled")).toBeDefined();
    await dialog.get('[data-test="assistant-history-clear-all-confirm"] input').setValue("delete");
    expect(confirm.attributes("disabled")).toBeUndefined();
    expect(confirm.text()).toBe("Delete 25 chats");
    await confirm.trigger("click");
    await flushPromises();
    expect(db.rows.size).toBe(0);
  });

  it("lands on the search once everything is cleared", async () => {
    const { wrapper, db } = await setup();
    await wrapper.get('[data-test="assistant-history-clear-all"]').trigger("click");
    await wrapper
      .get('[data-test="assistant-history-clear-all-dialog"] [data-stub="primary"]')
      .trigger("click");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.rows.size).toBe(0);
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-history-search"] input').element,
    );
  });

  it("says a filter chip is empty and offers Show all", async () => {
    const { wrapper, history } = await setup({}, { seed: SEED.filter((row) => !row.pinned) });
    history.setFilter({ kind: "pinned" });
    await flushPromises();
    const empty = wrapper.get('[data-test="assistant-history-filter-empty"]');
    expect(empty.text()).toContain("No chats in this view");
    expect(wrapper.find('[data-test="assistant-history-no-match"]').exists()).toBe(false);
    await empty.get("button").trigger("click");
    expect(history.filter.value.kind).toBe("all");
  });

  it("offers a Shared filter only where the server keeps share links", async () => {
    const options = (wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) =>
      wrapper
        .get('[data-test="assistant-history-filter"]')
        .findAll('[role="radio"], button')
        .map((item) => item.text());
    const local = await setup();
    expect(options(local.wrapper)).not.toContain("Shared");
    local.wrapper.unmount();
    const server = await setup({}, { persistence: true });
    expect(server.history.mode.value).toBe("server");
    expect(options(server.wrapper)).toContain("Shared");
    expect(aiChatShare.listMine).not.toHaveBeenCalled();
    vi.mocked(aiChatShare.listMine).mockResolvedValueOnce({
      data: { shares: [{ session_id: SEED[0].sessionId }] },
    } as never);
    const noted = vi.spyOn(server.history, "noteShared");
    server.history.setFilter({ kind: "shared" });
    await flushPromises();
    expect(aiChatShare.listMine).toHaveBeenCalledTimes(1);
    expect(noted).toHaveBeenLastCalledWith([SEED[0].sessionId]);
    server.history.setFilter({ kind: "all" });
  });

  it("lists as shared only chats whose link has not expired", async () => {
    const server = await setup({}, { persistence: true });
    const micros = Date.now() * 1_000;
    vi.mocked(aiChatShare.listMine).mockResolvedValueOnce({
      data: {
        shares: [
          { session_id: SEED[0].sessionId, expires_at: micros - 1_000_000 },
          { session_id: SEED[1].sessionId, expires_at: micros + 3_600_000_000 },
          { session_id: SEED[2].sessionId, expires_at: null },
        ],
      },
    } as never);
    const noted = vi.spyOn(server.history, "noteShared");
    server.history.setFilter({ kind: "shared" });
    await flushPromises();
    expect(noted).toHaveBeenLastCalledWith([SEED[1].sessionId, SEED[2].sessionId]);
    server.history.setFilter({ kind: "all" });
  });

  it("windows the rows past the virtual threshold and keeps them a list", async () => {
    const many = Array.from({ length: VIRTUAL_FROM + 10 }, (_, i) =>
      record(i + 1, NOW - i * 60_000),
    );
    const { wrapper } = await setup({}, { seed: many });
    const list = wrapper.get('[data-test="assistant-history-list"]');
    expect(list.attributes("data-virtual")).toBe("");
    expect(list.attributes("role")).toBe("list");
    expect(wrapper.findAll('[data-test="assistant-history-row"]').length).toBeLessThan(many.length);
  });

  it("keeps the rows a plain list at the threshold", async () => {
    const many = Array.from({ length: VIRTUAL_FROM }, (_, i) => record(i + 1, NOW - i * 60_000));
    const { wrapper } = await setup({}, { seed: many });
    const list = wrapper.get('[data-test="assistant-history-list"]');
    expect(list.attributes("data-virtual")).toBeUndefined();
    expect(wrapper.findAll('[data-test="assistant-history-row"]')).toHaveLength(VIRTUAL_FROM);
  });

  it("renders read-only for a role that can list but not chat", async () => {
    const { wrapper } = await setup({}, { canChat: "no" });
    expect(wrapper.get('[data-test="assistant-history"]').attributes("data-readonly")).toBe("");
    expect(wrapper.find('[data-test="assistant-history-new"]').exists()).toBe(false);
    await wrapper.findAll('[data-test="assistant-history-item"]')[1].trigger("pointerenter");
    expect(wrapper.find('[data-test="assistant-history-row-rename"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-history-row-delete"]').exists()).toBe(false);
  });

  it("opens a row in its container and tells the host to close", async () => {
    const { wrapper, store } = await setup();
    await rowButtons(wrapper)[1].trigger("click");
    await flushPromises();
    expect(wrapper.emitted("opened")?.[0]).toEqual([SEED[0].sessionId]);
    expect(store.state.shell.activeSid).toBe(SEED[0].sessionId);
  });

  it("routes the rail to the full view", async () => {
    const { wrapper, router } = await setup({ mode: "rail", container: "full_view" });
    await rowButtons(wrapper)[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.chatId).toBe(SEED[0].sessionId);
  });
});

describe("AssistantHistoryConfirm", () => {
  it("names every chat and asks for the word when the count is unknown", async () => {
    const wrapper = mount(AssistantHistoryConfirm, {
      props: {
        kind: "clear_all",
        open: true,
        mode: "server",
        org: "o1",
        orgName: "Acme",
        count: null,
      },
      global: { stubs: historyStubs },
    });
    await flushPromises();
    const dialog = wrapper.get('[data-test="assistant-history-clear-all-dialog"]');
    expect(dialog.get("h2").text()).toBe("Delete all your chats in Acme?");
    const confirm = dialog.get('[data-stub="primary"]');
    expect(confirm.text()).toBe("Delete all chats");
    expect(confirm.attributes("disabled")).toBeDefined();
    await dialog.get('[data-test="assistant-history-clear-all-confirm"] input').setValue("delete");
    expect(confirm.attributes("disabled")).toBeUndefined();
  });

  it("uses the singular for one chat", async () => {
    const wrapper = mount(AssistantHistoryConfirm, {
      props: { kind: "clear_all", open: true, mode: "local", org: "o1", orgName: "Acme", count: 1 },
      global: { stubs: historyStubs },
    });
    await flushPromises();
    const dialog = wrapper.get('[data-test="assistant-history-clear-all-dialog"]');
    expect(dialog.get('[data-stub="primary"]').text()).toBe("Delete 1 chat");
    expect(dialog.find('[data-test="assistant-history-clear-all-confirm"]').exists()).toBe(false);
  });
});
