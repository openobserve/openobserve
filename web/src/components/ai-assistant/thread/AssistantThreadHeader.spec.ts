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
const { md, lg } = vi.hoisted(() => ({ md: { value: true }, lg: { value: true } }));

vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const { computed } = await import("vue");
  const real = (await importOriginal<typeof import("@/composables/useBreakpoint")>()).default;
  return {
    default: () => ({
      ...real(),
      mdUp: computed(() => md.value),
      lgUp: computed(() => lg.value),
    }),
  };
});

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
  {
    over = {} as Partial<AssistantCapability>,
    messages = true,
    title = "Checkout 5xx spike",
    slots = {} as Record<string, string>,
  } = {},
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
      ...slots,
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
  lg.value = true;
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

  it("draws the title as a menu button, with + drawn but unavailable in an empty chat", async () => {
    const { wrapper } = await setup({}, { messages: false });
    const heading = wrapper.get('[data-test="assistant-thread-title"]');
    expect(heading.attributes("role")).toBe("heading");
    expect(heading.attributes("aria-level")).toBe("2");
    expect(heading.text()).toContain("New chat");
    const button = wrapper.get(title);
    expect(button.attributes("aria-haspopup")).toBe("menu");
    expect(button.attributes("aria-label")).toBe("New chat, chats and chat actions");
    expect(wrapper.get('[data-test="assistant-thread-new"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(false);
  });

  it("disables a window's New chat at the window cap and says why", async () => {
    const { wrapper, store } = await setup({ placement: "window", container: "window" });
    const button = () => wrapper.get('[data-test="assistant-thread-new"]');
    expect(button().attributes("aria-disabled")).not.toBe("true");
    store.state.shell.windows = Array.from({ length: 4 }, (_, i) => ({ sid: `w${i}` }) as never);
    await flushPromises();
    expect(button().attributes("aria-disabled")).toBe("true");
    expect(wrapper.text() + document.body.textContent).toContain("Close a chat to start a new one");
  });

  it("offers New chat once an empty chat holds an image or a chip, not only typed text", async () => {
    const { wrapper, store, sid } = await setup({}, { messages: false });
    const ready = () =>
      wrapper.get('[data-test="assistant-thread-new"]').attributes("aria-disabled") !== "true";
    expect(ready()).toBe(false);
    store.state.sessions[sid].composer.images = [{ id: "i1" } as never];
    await flushPromises();
    expect(ready()).toBe(true);
    store.state.sessions[sid].composer.images = [];
    store.state.sessions[sid].composer.chips = [{ id: "c1" } as never];
    await flushPromises();
    expect(ready()).toBe(true);
  });

  const editTrigger = '[data-test="assistant-thread-title-edit-trigger"]';
  const editInput = '[data-test="assistant-thread-title-edit-input"]';

  it("makes the title itself click-to-rename, with the chats menu behind its own chevron", async () => {
    const { wrapper } = await setup();
    const heading = wrapper.get('[data-test="assistant-thread-title"]');
    expect(heading.get(editTrigger).text()).toBe("Checkout 5xx spike");
    expect(wrapper.get(title).text()).not.toContain("Checkout 5xx spike");
    expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(false);
  });

  it("keeps the menu button a 2.75 rem target below md and on coarse pointers", async () => {
    const { wrapper } = await setup();
    const classes = wrapper.get(title).classes();
    expect(classes).toEqual(
      expect.arrayContaining(["max-md:min-h-11", "max-md:min-w-11", "pointer-coarse:min-h-11"]),
    );
  });

  async function openRename(wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) {
    await wrapper.get(editTrigger).trigger("click");
    await flushPromises();
    return wrapper.get(editInput);
  }

  it("renames by clicking the title: sticky renamed, Escape restores without a request", async () => {
    const { wrapper, sid, store, db } = await setup();
    const input = await openRename(wrapper);
    await input.setValue("Payments p95");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(store.state.sessions[sid].titleSource).toBe("renamed");
    expect([...db.rows.values()][0]?.title).toBe("Payments p95");
    (wrapper.vm as unknown as { startRename(): void }).startRename();
    await flushPromises();
    const again = wrapper.get(editInput);
    await again.setValue("Something else");
    await again.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
    expect(document.activeElement).toBe(wrapper.get(editTrigger).element);
  });

  it("leaves focus where the user moved it when the rename field blurs", async () => {
    const { wrapper } = await setup();
    const other = document.createElement("button");
    document.body.appendChild(other);
    const input = await openRename(wrapper);
    (input.element as HTMLInputElement).focus();
    other.focus();
    await flushPromises();
    expect(document.activeElement).toBe(other);
  });

  it("returns focus to the title after Enter even while the rename is saving", async () => {
    const { wrapper, sid, history } = await setup();
    const input = await openRename(wrapper);
    (input.element as HTMLInputElement).focus();
    history.pending[sid] = "rename";
    await input.setValue("Payments p95");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get(editTrigger).element);
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

  it("starts a new chat from a waiting approval without saying it keeps answering", async () => {
    const { wrapper, newChat, store, sid } = await setup();
    newChat.mockImplementation(() => store.setActive(null));
    store.setActive(sid);
    store.state.sessions[sid].turn = { state: "awaiting_approval" } as never;
    await nextTick();
    await wrapper.get('[data-test="assistant-thread-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("ai_thread_action", { action: "new", had_running: true });
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

  it("draws + on a window's bar and keeps New chat at the head of its menu", async () => {
    const { wrapper, newChat } = await setup({ placement: "window", narrow: true });
    await wrapper.get('[data-test="assistant-thread-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="assistant-title-menu-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(2);
  });

  it("moves New chat into the title menu on a phone's Full page, so the title keeps the bar (B-shell3-7)", async () => {
    md.value = false;
    const { wrapper, newChat } = await setup({ placement: "full" });
    expect(wrapper.find('[data-test="assistant-thread-new"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-title-menu-new"]').trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
    md.value = true;
  });

  it("keeps only the chat's actions in the full view, whose rail is the list", async () => {
    const { wrapper, runs } = await setup({ placement: "full" });
    runs.rows.value = [runRow("a")];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-menu-all"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-menu-pin"]').exists()).toBe(true);
    expect(wrapper.find(editTrigger).exists()).toBe(true);
  });

  it("keeps Layout on the bar below 24 rem, and the tag under the chat's name", async () => {
    const { wrapper, store, sid } = await setup({ narrow: true });
    store.state.sessions[sid].turn = { state: "done", saved: "not_saved" };
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-menu-layout"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-thread-save-tag"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-title-menu-header"]').text()).toContain("Not saved");
  });

  it("folds Layout into the title menu only on a sheet", async () => {
    const { wrapper } = await setup({ placement: "sheet" });
    expect(wrapper.find('[data-test="assistant-title-menu-layout"]').exists()).toBe(true);
  });

  it("shows a single move as a direct item, with no one-row Layout submenu", async () => {
    const { wrapper } = await setup({ placement: "sheet", layoutDirect: true });
    expect(wrapper.find('[data-test="layout-stub"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-title-menu-layout"]').exists()).toBe(false);
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

  it("has no slot for what the assistant sees: the composer box's corner holds that ⓘ", async () => {
    const { wrapper } = await setup(
      {},
      { slots: { "menu-sees": '<div data-test="assistant-thread-menu-sees" />' } },
    );
    expect(wrapper.find('[data-test="assistant-thread-menu-download-markdown"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="assistant-thread-menu-sees"]').exists()).toBe(false);
  });

  it("downloads from the title menu", async () => {
    const { wrapper, sid } = await setup();
    await wrapper.get('[data-test="assistant-thread-menu-download-markdown"]').trigger("click");
    expect(exporter.exportChat).toHaveBeenCalledWith(sid, "markdown");
  });

  describe("as a toolbar", () => {
    const toolbar = { placement: "full", container: "full_view", toolbar: true } as const;

    it("leads with the chat's title as the page heading, then +, the container's controls and More", async () => {
      const { wrapper } = await setup(toolbar);
      const heading = wrapper.get('[data-test="assistant-thread-heading"]');
      expect(heading.attributes("role")).toBe("heading");
      expect(heading.attributes("aria-level")).toBe("1");
      expect(heading.text()).not.toBe("");
      expect(wrapper.find(title).exists()).toBe(false);
      const ids = wrapper
        .findAll("button")
        .map((b) => b.attributes("data-test"))
        .filter((id) =>
          ["assistant-thread-new", "close-stub", "assistant-thread-more"].includes(id ?? ""),
        );
      expect(ids).toEqual(["assistant-thread-new", "close-stub", "assistant-thread-more"]);
      const more = wrapper.get('[data-test="assistant-thread-more"]');
      expect(more.attributes("aria-label")).toBe("More actions");
      expect(more.attributes("aria-haspopup")).toBe("menu");
      expect(wrapper.find('[data-test="assistant-title-menu-all"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="layout-stub"]').exists()).toBe(false);
    });

    it("puts New Chat first below lg too", async () => {
      lg.value = false;
      const { wrapper, newChat } = await setup(toolbar);
      const ids = wrapper
        .findAll("button")
        .map((b) => b.attributes("data-test"))
        .filter((id) =>
          ["assistant-thread-new", "close-stub", "assistant-thread-more"].includes(id ?? ""),
        );
      expect(ids).toEqual(["assistant-thread-new", "close-stub", "assistant-thread-more"]);
      const add = wrapper.get('[data-test="assistant-thread-new"]');
      expect(add.attributes("aria-label")).toBe("New chat");
      await add.trigger("click");
      expect(newChat).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="assistant-title-menu-new"]').exists()).toBe(false);
      lg.value = true;
    });

    it("runs the title menu's own actions from More: download, pin and delete, with no Rename", async () => {
      const { wrapper, sid, history } = await setup(toolbar);
      await wrapper.get('[data-test="assistant-thread-menu-download-markdown"]').trigger("click");
      expect(exporter.exportChat).toHaveBeenLastCalledWith(sid, "markdown");
      await wrapper.get('[data-test="assistant-thread-menu-download-json"]').trigger("click");
      expect(exporter.exportChat).toHaveBeenLastCalledWith(sid, "json");
      const pin = vi.spyOn(history, "pin").mockResolvedValue(undefined as never);
      await wrapper.get('[data-test="assistant-thread-menu-pin"]').trigger("click");
      expect(pin).toHaveBeenCalledWith(sid, true);
      expect(wrapper.find('[data-test="assistant-thread-menu-delete"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="assistant-thread-menu-rename"]').exists()).toBe(false);
    });

    it("renames the chat by clicking its heading, as the incident detail's title does", async () => {
      const { wrapper, sid, store } = await setup(toolbar);
      const edit = '[data-test="assistant-thread-heading-edit';
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      const input = wrapper.get(`${edit}-input"]`);
      await input.setValue("Payments p95");
      await input.trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(String(store.state.sessions[sid].title)).toBe("Payments p95");
      expect(wrapper.find('[data-test="assistant-thread-more"]').exists()).toBe(true);
    });

    it("shows the title as plain text that describes itself as Rename chat, with no pencil or hint", async () => {
      const { wrapper } = await setup(toolbar);
      const trigger = wrapper.get('[data-test="assistant-thread-heading-edit-trigger"]');
      expect(trigger.text()).toBe("Checkout 5xx spike");
      expect(trigger.find("svg, [data-test='o-icon']").exists()).toBe(false);
      expect(wrapper.get(`#${trigger.attributes("aria-describedby")}`).text()).toBe("Rename chat");
    });

    it("cancels a rename on Escape and saves one on blur", async () => {
      const { wrapper, sid, history } = await setup(toolbar);
      const rename = vi.spyOn(history, "rename").mockResolvedValue(undefined as never);
      const edit = '[data-test="assistant-thread-heading-edit';
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      await wrapper.get(`${edit}-input"]`).setValue("Dropped");
      await wrapper.get(`${edit}-input"]`).trigger("keydown", { key: "Escape" });
      await flushPromises();
      expect(wrapper.find(`${edit}-input"]`).exists()).toBe(false);
      expect(rename).not.toHaveBeenCalled();
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      await wrapper.get(`${edit}-input"]`).setValue("Kept");
      await wrapper.get(`${edit}-input"]`).trigger("blur");
      await flushPromises();
      expect(rename).toHaveBeenCalledWith(sid, "Kept");
    });

    it("keeps the heading focusable while a rename saves, so Enter returns focus to it", async () => {
      const { wrapper, sid, history } = await setup(toolbar);
      const edit = '[data-test="assistant-thread-heading-edit';
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      history.pending[sid] = "rename";
      const input = wrapper.get(`${edit}-input"]`);
      await input.setValue("Payments p95");
      await input.trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get(`${edit}-trigger"]`).element);
    });

    it("names the heading by the chat title, not by the rename button", async () => {
      const { wrapper } = await setup(toolbar);
      const heading = wrapper.get('[data-test="assistant-thread-heading"]');
      const label = wrapper.get(`#${heading.attributes("aria-labelledby")}`);
      expect(label.text()).toBe("Checkout 5xx spike");
    });

    it("names the title button by the title it shows and labels only the edit field", async () => {
      const { wrapper } = await setup(toolbar);
      const edit = '[data-test="assistant-thread-heading-edit';
      expect(wrapper.get(`${edit}-trigger"]`).attributes("aria-label")).toBeUndefined();
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      expect(wrapper.get(`${edit}-input"]`).attributes("aria-label")).toBe("Chat title");
    });

    it("gives an empty inline edit the accessible name from its aria-label (C-05)", async () => {
      const { default: OInlineEdit } = await import("@/lib/forms/InlineEdit/OInlineEdit.vue");
      const w = mount(OInlineEdit, {
        props: { modelValue: "", ariaLabel: raw("Rename incident") },
      });
      expect(w.get("button").attributes("aria-label")).toBe("Rename incident");
      expect(w.get("button").attributes("aria-describedby")).toBeUndefined();
    });

    it("saves a rename typed while another rename is saving, once the first ends", async () => {
      const { wrapper, sid, history } = await setup(toolbar);
      const rename = vi.spyOn(history, "rename").mockResolvedValue(undefined as never);
      const edit = '[data-test="assistant-thread-heading-edit';
      await wrapper.get(`${edit}-trigger"]`).trigger("click");
      await flushPromises();
      history.pending[sid] = "rename";
      const input = wrapper.get(`${edit}-input"]`);
      await input.setValue("Second name");
      await input.trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(rename).not.toHaveBeenCalled();
      delete history.pending[sid];
      await flushPromises();
      expect(rename).toHaveBeenCalledWith(sid, "Second name");
    });

    it("shows the heading as plain text when the chat cannot be renamed", async () => {
      const { wrapper } = await setup(toolbar, { over: { canChat: "no" } });
      expect(wrapper.get('[data-test="assistant-thread-heading"]').text()).not.toBe("");
      expect(wrapper.find('[data-test="assistant-thread-heading-edit-trigger"]').exists()).toBe(
        false,
      );
    });

    it("shows no More for a read-only role, as the title menu offers it no actions", async () => {
      const { wrapper } = await setup(toolbar, { over: { canChat: "no" } });
      expect(wrapper.find('[data-test="assistant-thread-more"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="close-stub"]').exists()).toBe(true);
    });
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
    // A phone shows the count on the header button; the title's name still says it (B-shell3-7).
    expect(mark().classes()).toContain("max-md:hidden");
  });

  it("gives a window's bar its own chat's state instead of the logo and the others' mark", async () => {
    const { wrapper, store, sid, runs } = await setup({ placement: "window", container: "window" });
    const own = () => wrapper.find('[data-test="assistant-thread-title-status"]');
    expect(wrapper.find('[data-test="assistant-thread-logo"]').exists()).toBe(false);
    expect(own().exists()).toBe(false);
    store.state.sessions[sid].turn = { state: "responding.writing" } as never;
    runs.rows.value = [runRow("a", { group: "needs_you" })];
    await nextTick();
    expect(own().attributes("data-state")).toBe("working");
    expect(wrapper.find('[data-test="assistant-title-mark"]').exists()).toBe(false);
    store.state.sessions[sid].turn = { state: "awaiting_approval" } as never;
    await nextTick();
    expect(own().attributes("data-state")).toBe("attention");
    store.state.sessions[sid].turn = { state: "awaiting_consent" } as never;
    await nextTick();
    expect(own().attributes("data-state")).toBe("attention");
  });

  it("folds the moves into the title menu only in a narrow window", async () => {
    const wide = await setup({ placement: "window", container: "window" });
    await wide.wrapper.get(title).trigger("click");
    await flushPromises();
    expect(wide.wrapper.find('[data-test="layout-stub"]').exists()).toBe(false);
    wide.wrapper.unmount();
    const narrow = await setup({ placement: "window", container: "window", narrow: true });
    await narrow.wrapper.get(title).trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="layout-stub"]')).not.toBeNull();
  });

  it("never marks a failed chat", async () => {
    const { wrapper, runs } = await setup();
    runs.rows.value = [runRow("a", { group: "failed", status: "failed" })];
    await nextTick();
    expect(wrapper.find('[data-test="assistant-title-mark"]').exists()).toBe(false);
  });
});
