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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";
import AssistantThreadHeader, {
  assistantThreadHostKey,
  type AssistantThreadHeaderProps,
} from "./AssistantThreadHeader.vue";

const { fake, exporter, track, toast } = vi.hoisted(() => ({
  fake: { current: null as any },
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
    props: { sid, placement: "sidebar", density: "default", container: "sidebar", ...props },
    slots: { "container-actions": '<button data-test="close-stub">×</button>' },
    global: {
      plugins: [fakeRouter(), fakeVuex()],
      stubs: historyStubs,
      provide: { [assistantThreadHostKey as symbol]: { newChat, chats } },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, sid, newChat, chats, ...fake.current };
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
  it("tags an incident analysis chat with its origin, and no other chat", async () => {
    const { wrapper, store, sid } = await setup();
    expect(wrapper.find('[data-test="assistant-thread-origin"]').exists()).toBe(false);
    store.state.sessions[sid].origin = {
      entryKind: "object_verb",
      objectKind: "incident",
      container: "rca",
    };
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-thread-origin"]').text()).toBe("Incident");
  });

  it("names a new chat and disables rename until a message is sent", async () => {
    const { wrapper } = await setup({}, { messages: false });
    const title = wrapper.get('[data-test="assistant-thread-title"]');
    expect(title.element.tagName).toBe("H2");
    expect(title.text()).toContain("New chat");
    expect(title.find('[data-test="assistant-thread-title-button"]').exists()).toBe(false);
    const tips = wrapper.findAllComponents(OTooltip).map((tip) => tip.props("content"));
    expect(tips).toContain("Send a message first");
    expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(false);
  });

  it("keeps the title button at least 1.5 rem when squeezed and 2.75 rem below md and on coarse pointers", async () => {
    const { wrapper } = await setup();
    const classes = wrapper.get('[data-test="assistant-thread-title-button"]').classes();
    for (const cls of [
      "min-h-6",
      "min-w-6",
      "max-md:min-h-11",
      "max-md:min-w-11",
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    ]) {
      expect(classes).toContain(cls);
    }
    expect(classes).not.toContain("min-w-0");
    // The heading reserves the same floor, so a squeezed title never slides under the controls beside it.
    const heading = wrapper.get('[data-test="assistant-thread-title"]').classes();
    expect(heading).toEqual(
      expect.arrayContaining(["min-w-6", "max-md:min-w-11", "pointer-coarse:min-w-11"]),
    );
    const chats = wrapper.get(
      '[data-test="assistant-thread-history"] span.sr-only, [data-test="assistant-thread-history"] span[class*="sr-only"]',
    );
    expect(chats.classes()).toContain("@max-[32rem]:sr-only");
    expect(wrapper.get('[data-test="assistant-thread-history"]').attributes("aria-label")).toBe(
      "Chats",
    );
  });

  it("renames inline: the title becomes sticky renamed, Escape restores without a request", async () => {
    const { wrapper, sid, store, db } = await setup();
    await wrapper.get('[data-test="assistant-thread-title-button"]').trigger("click");
    await nextTick();
    const input = wrapper.get('[data-test="assistant-thread-rename"] input');
    await input.setValue("Payments p95");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(store.state.sessions[sid].titleSource).toBe("renamed");
    expect([...db.rows.values()][0]?.title).toBe("Payments p95");
    store.setTitle(sid, raw("A generated title"), "generated");
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    await wrapper.get('[data-test="assistant-thread-title-button"]').trigger("click");
    await nextTick();
    const again = wrapper.get('[data-test="assistant-thread-rename"] input');
    await again.setValue("Something else");
    await again.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-thread-title-button"]').element,
    );
  });

  it("caps the title at 200 characters with a counter from 180", async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-test="assistant-thread-title-button"]').trigger("click");
    await nextTick();
    const input = wrapper.get('[data-test="assistant-thread-rename"] input');
    await input.setValue("x".repeat(179));
    expect(wrapper.text()).not.toMatch(/\d+\/200/);
    await input.setValue("x".repeat(250));
    expect(wrapper.text()).toContain("200/200");
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
    expect(wrapper.find('[data-test="assistant-thread-new-dialog"]').exists()).toBe(false);
    expect(newChat).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "“Checkout 5xx spike” keeps answering" }),
    );
    const open = vi.spyOn(store, "openSession").mockResolvedValue(undefined as never);
    toast.mock.calls[0][0].action.handler();
    expect(open).toHaveBeenCalledWith({ sid }, { focus: true });
  });

  it("orders Tab stops title, Chats, Download, New, overflow, then the shell controls", async () => {
    const { wrapper } = await setup();
    const order = wrapper
      .findAll("button")
      .map((b) => b.attributes("data-test"))
      .filter((id) =>
        [
          "assistant-thread-title-button",
          "assistant-thread-history",
          "assistant-thread-download",
          "assistant-thread-new",
          "assistant-thread-menu",
          "close-stub",
        ].includes(id ?? ""),
      );
    expect(order).toEqual([
      "assistant-thread-title-button",
      "assistant-thread-history",
      "assistant-thread-download",
      "assistant-thread-new",
      "assistant-thread-menu",
      "close-stub",
    ]);
    expect(wrapper.find("[tabindex]:not([tabindex='0']):not([tabindex='-1'])").exists()).toBe(
      false,
    );
  });

  it("opens the Chats view from Chats, with Back and New in place of the title row", async () => {
    const { wrapper, chats, newChat } = await setup();
    await wrapper.get('[data-test="assistant-thread-history"]').trigger("click");
    expect(chats.set).toHaveBeenCalledWith(true);
    await nextTick();
    expect(wrapper.attributes("data-view")).toBe("chats");
    expect(wrapper.get('[data-test="assistant-chats-title"]').text()).toBe("Chats");
    expect(wrapper.get('[data-test="assistant-chats-back"]').attributes("aria-label")).toBe(
      "Back to chat: Checkout 5xx spike",
    );
    expect(wrapper.find('[data-test="assistant-thread-title"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="close-stub"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-chats-new"]').trigger("click");
    expect(chats.set).toHaveBeenLastCalledWith(false);
    expect(newChat).toHaveBeenCalledTimes(1);
  });

  it("returns focus to Chats when Back closes the view", async () => {
    const { wrapper, chats } = await setup();
    chats.open.value = true;
    await nextTick();
    await wrapper.get('[data-test="assistant-chats-back"]').trigger("click");
    await flushPromises();
    expect(chats.open.value).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-thread-history"]').element,
    );
  });

  it("hands Chats to the full view's rail instead of opening a second list", async () => {
    const rail = document.createElement("div");
    document.body.append(rail);
    const run = vi.fn();
    const off = registerHistoryTarget({ el: () => rail, priority: 2, run });
    const { wrapper, chats } = await setup();
    await wrapper.get('[data-test="assistant-thread-history"]').trigger("click");
    await flushPromises();
    expect(run).toHaveBeenCalledTimes(1);
    expect(chats.set).not.toHaveBeenCalled();
    off();
  });

  it("keeps an IME composition's Enter out of the rename", async () => {
    const { wrapper, sid, store } = await setup();
    await wrapper.get('[data-test="assistant-thread-title-button"]').trigger("click");
    await nextTick();
    const input = wrapper.get('[data-test="assistant-thread-rename"] input');
    await input.setValue("日本");
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Checkout 5xx spike");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("日本");
  });

  it("moves Chats and New into the overflow when dense, and opens the same Chats view", async () => {
    const { wrapper, chats } = await setup({ density: "dense", placement: "docked" });
    expect(wrapper.find('[data-test="assistant-thread-history"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-menu-new"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-thread-menu-history"]').trigger("click");
    expect(chats.set).toHaveBeenCalledWith(true);
  });

  it("keeps Chats and New direct at the default density whatever the container's width", async () => {
    const { wrapper } = await setup({ density: "default", placement: "sidebar" });
    expect(wrapper.find('[data-test="assistant-thread-history"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-menu-new"]').exists()).toBe(false);
  });

  it("describes the heading by the not-saved tag", async () => {
    const { wrapper, store, sid } = await setup();
    store.state.sessions[sid].turn = { state: "done", saved: "not_saved" };
    await nextTick();
    const tag = wrapper.get('[data-test="assistant-thread-save-tag"]');
    expect(tag.text()).toBe("Not saved");
    expect(wrapper.get('[data-test="assistant-thread-title"]').attributes("aria-describedby")).toBe(
      tag.attributes("id"),
    );
  });

  it("downloads from the header in local mode and from the overflow in server mode", async () => {
    const local = await setup();
    await local.wrapper.get('[data-test="assistant-thread-download-markdown"]').trigger("click");
    expect(exporter.exportChat).toHaveBeenCalledWith(local.sid, "markdown");
    document.body.innerHTML = "";
    const server = await setup({}, { over: { persistence: true } });
    expect(server.wrapper.find('[data-test="assistant-thread-download"]').exists()).toBe(false);
    expect(server.wrapper.find('[data-test="assistant-thread-menu-download-json"]').exists()).toBe(
      true,
    );
  });

  it("shows only the title and Chats for a read-only role", async () => {
    const { wrapper } = await setup({}, { over: { canChat: "no" } });
    expect(wrapper.find('[data-test="assistant-thread-history"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-title-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-menu-delete"]').exists()).toBe(false);
  });
});
