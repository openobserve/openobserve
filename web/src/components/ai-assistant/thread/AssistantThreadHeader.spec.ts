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
import { nextTick, ref } from "vue";

import type { AssistantCapability } from "@/composables/assistant";
import { registerHistoryTarget } from "@/composables/assistant/shortcuts";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";
import { fakeRuns, runRow } from "../runs/runsTestKit";
import AssistantThreadHeader, {
  assistantThreadHostKey,
  type AssistantThreadHeaderProps,
} from "./AssistantThreadHeader.vue";

const { fake, exporter, track, toast } = vi.hoisted(() => ({
  fake: { current: null as any, runs: null as any },
  exporter: {
    exportChat: vi.fn(),
    exportAll: vi.fn(),
    busy: { value: new Set<string>() },
  },
  track: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useAssistantHistory: () => fake.current.history,
  useAssistantRuns: () => fake.runs.runs,
  useChatExport: () => exporter,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

async function setup(
  props: Partial<AssistantThreadHeaderProps> = {},
  { over = {} as Partial<AssistantCapability>, messages = true, title = "Checkout 5xx spike" } = {},
) {
  fake.current = fakeAssistant("available", { persistence: false, ...over }, {}, 80, true);
  fake.runs = fakeRuns();
  const { store } = fake.current;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  if (messages) {
    store.state.sessions[sid].messages.push({ role: "user", content: raw("q"), turnId: "t1" });
    store.setTitle(sid, raw(title), "generated");
  }
  const newChat = vi.fn();
  const chatsOpen = ref(false);
  const chats = { open: chatsOpen, set: vi.fn((open: boolean) => (chatsOpen.value = open)) };
  const wrapper = mount(AssistantThreadHeader, {
    props: { sid, placement: "sidebar", container: "sidebar", ...props },
    slots: {
      "container-actions": '<button data-test="close-stub">×</button>',
      "menu-layout": '<div data-test="layout-stub" />',
    },
    global: {
      plugins: [fakeRouter(), fakeVuex()],
      stubs: historyStubs,
      provide: { [assistantThreadHostKey as symbol]: { newChat, chats } },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, sid, newChat, chats, runs: fake.runs, ...fake.current };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  track.mockClear();
  toast.mockClear();
});

describe("AssistantThreadHeader", () => {
  const title = '[data-test="assistant-thread-title-button"]';

  it("keeps no agent chip and no mark logo on the bar", async () => {
    const { wrapper, store, sid } = await setup({}, { over: { agents: [] } });
    store.state.sessions[sid].agentId = "sre";
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-agent-identity"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-mark"]').exists()).toBe(false);
  });

  it("draws the title as a menu button, with no + in an empty chat", async () => {
    const { wrapper } = await setup({}, { messages: false });
    const heading = wrapper.get('[data-test="assistant-thread-title"]');
    expect(heading.element.tagName).toBe("H2");
    expect(heading.text()).toContain("New chat");
    const button = wrapper.get(title);
    expect(button.attributes("aria-haspopup")).toBe("menu");
    expect(button.attributes("aria-label")).toBe("New chat, chats and chat actions");
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(false);
  });

  it("keeps the title button a 2.75 rem target below md and on coarse pointers", async () => {
    const { wrapper } = await setup();
    const classes = wrapper.get(title).classes();
    expect(classes).toEqual(
      expect.arrayContaining(["min-w-0", "max-md:min-h-11", "pointer-coarse:min-h-11"]),
    );
  });

  it("renames inline from the title menu: sticky renamed, Escape restores without a request", async () => {
    const { wrapper, sid, store, db } = await setup();
    vi.useFakeTimers();
    await wrapper.get('[data-test="assistant-thread-menu-rename"]').trigger("click");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    await flushPromises();
    const input = wrapper.get('[data-test="assistant-thread-rename"] input');
    await input.setValue("Payments p95");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(store.state.sessions[sid].titleSource).toBe("renamed");
    expect([...db.rows.values()][0]?.title).toBe("Payments p95");
    (wrapper.vm as unknown as { startRename(): void }).startRename();
    await flushPromises();
    const again = wrapper.get('[data-test="assistant-thread-rename"] input');
    await again.setValue("Something else");
    await again.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(document.activeElement).toBe(wrapper.get(title).element);
  });

  it("starts a new chat at once even while an answer runs, and says the old one keeps going", async () => {
    const { wrapper, newChat, store, sid } = await setup();
    await wrapper.get('[data-test="assistant-thread-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    newChat.mockImplementation(() => store.setActive(null));
    store.setActive(sid);
    store.state.sessions[sid].turn = { state: "responding.writing" } as never;
    await nextTick();
    await wrapper.get('[data-test="assistant-thread-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "“Checkout 5xx spike” keeps answering" }),
    );
    const open = vi.spyOn(store, "openSession").mockResolvedValue(undefined as never);
    toast.mock.calls[0][0].action.handler();
    expect(open).toHaveBeenCalledWith({ sid }, { focus: true });
  });

  it("orders Tab stops title, +, then the container's controls", async () => {
    const { wrapper } = await setup();
    const order = wrapper
      .findAll("button")
      .map((b) => b.attributes("data-test"))
      .filter((id) =>
        ["assistant-thread-title-button", "assistant-thread-new", "close-stub"].includes(id ?? ""),
      );
    expect(order).toEqual(["assistant-thread-title-button", "assistant-thread-new", "close-stub"]);
  });

  it("opens All chats from the menu, with Back and + in place of the title row", async () => {
    const { wrapper, chats, newChat, runs } = await setup();
    runs.rows.value = [runRow("a")];
    await nextTick();
    await wrapper.get('[data-test="assistant-title-menu-all"]').trigger("click");
    expect(chats.set).toHaveBeenCalledWith(true);
    await nextTick();
    expect(wrapper.attributes("data-view")).toBe("chats");
    expect(wrapper.get('[data-test="assistant-chats-title"]').text()).toBe("All chats");
    expect(wrapper.get('[data-test="assistant-chats-back"]').attributes("aria-label")).toBe(
      "Back to chat: Checkout 5xx spike",
    );
    expect(wrapper.find('[data-test="assistant-thread-title"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="close-stub"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-chats-new"]').trigger("click");
    expect(chats.set).toHaveBeenLastCalledWith(false);
    expect(newChat).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the title when Back closes All chats", async () => {
    const { wrapper, chats } = await setup();
    chats.open.value = true;
    await nextTick();
    await wrapper.get('[data-test="assistant-chats-back"]').trigger("click");
    await flushPromises();
    expect(chats.open.value).toBe(false);
    expect(document.activeElement).toBe(wrapper.get(title).element);
  });

  it("hands All chats to the full view's rail instead of opening a second list", async () => {
    const rail = document.createElement("div");
    document.body.append(rail);
    const run = vi.fn();
    const off = registerHistoryTarget({ el: () => rail, priority: 2, run });
    const { wrapper, chats, runs } = await setup();
    runs.rows.value = [runRow("a")];
    await nextTick();
    await wrapper.get('[data-test="assistant-title-menu-all"]').trigger("click");
    await flushPromises();
    expect(run).toHaveBeenCalledTimes(1);
    expect(chats.set).not.toHaveBeenCalled();
    off();
  });

  it("leads a window's menu with New chat and draws no + on its bar", async () => {
    const { wrapper, newChat } = await setup({ placement: "window" });
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-title-menu-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
  });

  it("keeps only the chat's actions in the full view, whose rail is the list", async () => {
    const { wrapper, runs } = await setup({ placement: "full" });
    runs.rows.value = [runRow("a")];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-menu-all"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(true);
  });

  it("folds Layout into the title menu below 24 rem, and the tag under the chat's name", async () => {
    const { wrapper, store, sid } = await setup({ narrow: true });
    store.state.sessions[sid].turn = { state: "done", saved: "not_saved" };
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-menu-layout"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-save-tag"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-title-menu-header"]').text()).toContain("Not saved");
  });

  it("describes the heading by the not-saved tag at 24 rem and wider", async () => {
    const { wrapper, store, sid } = await setup();
    expect(wrapper.find('[data-test="assistant-title-menu-layout"]').exists()).toBe(false);
    store.state.sessions[sid].turn = { state: "done", saved: "not_saved" };
    await nextTick();
    const tag = wrapper.get('[data-test="assistant-thread-save-tag"]');
    expect(tag.text()).toBe("Not saved");
    expect(wrapper.get('[data-test="assistant-thread-title"]').attributes("aria-describedby")).toBe(
      tag.attributes("id"),
    );
  });

  it("downloads from the title menu", async () => {
    const { wrapper, sid } = await setup();
    await wrapper.get('[data-test="assistant-thread-menu-download-markdown"]').trigger("click");
    expect(exporter.exportChat).toHaveBeenCalledWith(sid, "markdown");
  });

  it("keeps the chats and drops the actions for a read-only role", async () => {
    const { wrapper, runs } = await setup({}, { over: { canChat: "no" } });
    runs.rows.value = [runRow("a")];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-title-menu-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-menu-delete"]').exists()).toBe(false);
  });

  it("marks waiting chats in amber over answering ones, and names the count", async () => {
    const { wrapper, sid, runs } = await setup();
    const mark = () => wrapper.find('[data-test="assistant-title-mark"]');
    expect(mark().exists()).toBe(false);
    runs.rows.value = [runRow(sid, { group: "needs_you" }), runRow("a"), runRow("b")];
    await nextTick();
    expect(mark().attributes("data-state")).toBe("working");
    expect(mark().text()).toBe("2");
    expect(wrapper.get(title).attributes("aria-label")).toBe(
      "Checkout 5xx spike, chats and chat actions, 2 other chats answering",
    );
    runs.rows.value = [runRow("a", { group: "needs_you" }), runRow("b")];
    await nextTick();
    expect(mark().attributes("data-state")).toBe("attention");
    expect(mark().text()).toBe("1");
    expect(wrapper.get(title).attributes("aria-label")).toBe(
      "Checkout 5xx spike, chats and chat actions, 1 other chat needs you",
    );
  });

  it("never marks a failed chat", async () => {
    const { wrapper, runs } = await setup();
    runs.rows.value = [runRow("a", { group: "failed", status: "failed" })];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-mark"]').exists()).toBe(false);
  });
});
