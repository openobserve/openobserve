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
import { defineComponent, h } from "vue";

import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { movedToTab, takeFullTabHandoff } from "@/composables/assistant/pure";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";
import AssistantModeButtons, { placementMode } from "./AssistantModeButtons.vue";
import type { AssistantModeButtonsProps } from "./AssistantModeButtons.vue";

const { fake, lg, track } = vi.hoisted(() => ({
  fake: { current: null as any },
  lg: { value: true },
  track: vi.fn(),
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive } = await import("vue");
  const state = reactive(lg);
  return {
    default: () => ({
      lgUp: computed(() => state.value),
      mdUp: computed(() => state.value),
      isMobile: computed(() => !state.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => state.value),
    }),
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => {
  const { computed } = await import("vue");
  const original = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...original,
    useAssistantStore: () => fake.current.store,
    useAssistantHistory: () => fake.current.history,
    useAssistantCapability: () => fake.current.handle,
    useAssistantStarters: () => ({
      starters: computed(() => []),
      loading: computed(() => false),
      scope: computed(() => ({ org: "default", streamCount: 1, timeRange: null, canWrite: "yes" })),
    }),
  };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "sidebar" } as const;

// The bare menu renders its items inside whichever dropdown hosts it, so a spec opens one around it.
async function setup(props: Partial<AssistantModeButtonsProps>) {
  const router = fakeRouter();
  await router.push("/logs");
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          ODropdown,
          { open: true },
          {
            trigger: () => h("button", "open"),
            default: () =>
              h(AssistantModeButtons, {
                placement: "sidebar",
                sid: fake.current.store.state.shell.activeSid,
                bare: true,
                ...props,
              }),
          },
        ),
    }),
    {
      global: {
        plugins: [router, fakeVuex()],
        stubs: { ODropdownSub: historyStubs.ODropdownSub },
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return { wrapper, router };
}

const item = (name: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="assistant-shell-place-${name}"]`);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  lg.value = true;
  fake.current = fakeAssistant();
  fake.current.store.createSession({ origin: ORIGIN });
  fake.current.store.open({ kind: "sidebar" }, { focus: "none" });
});

afterEach(() => {
  document.body.innerHTML = "";
  track.mockClear();
});

describe("header move group", () => {
  it("draws the current place pressed beside the places the chat can move to", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    mount(AssistantModeButtons, {
      props: { placement: "sidebar", sid: fake.current.store.state.shell.activeSid },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    const order = [...document.body.querySelectorAll("[data-test^='assistant-shell-place-']")];
    expect(order.map((el) => el.getAttribute("data-test"))).toEqual([
      "assistant-shell-place-full",
      "assistant-shell-place-sidebar",
      "assistant-shell-place-window",
    ]);
    expect(item("sidebar")?.getAttribute("aria-pressed")).toBe("true");
    expect(item("full")?.getAttribute("aria-pressed")).toBe("false");
    expect(item("window")?.getAttribute("aria-pressed")).toBe("false");
    // The current placement is marked by its icon colour, not a filled tile.
    expect(item("sidebar")?.className).toContain("text-accent!");
    expect(item("sidebar")?.className).not.toContain("subtle-active-bg");
    item("sidebar")!.click();
    await flushPromises();
    expect(fake.current.store.state.shell.placement.kind).toBe("sidebar");
  });
});

describe("Open as", () => {
  it("marks Full page as opening a new tab, in the menu and on the header button", async () => {
    await setup({});
    expect(item("full-new-tab")).not.toBeNull();
    expect(item("full")?.textContent).toContain("(opens in a new tab)");
    expect(item("window-new-tab")).toBeNull();
  });

  it("offers only the other places: full page and floating window from the sidebar", async () => {
    await setup({});
    expect(item("sidebar")).toBeNull();
    expect(item("window")).not.toBeNull();
    expect(item("full")).not.toBeNull();
    expect(item("dock")).toBeNull();
  });

  it("offers side panel and floating window from the full page, and side panel and full page from a window", async () => {
    await setup({ placement: "full" });
    expect(item("full")).toBeNull();
    expect(item("sidebar")).not.toBeNull();
    expect(item("window")).not.toBeNull();
    document.body.innerHTML = "";
    const sid = fake.current.store.state.shell.activeSid;
    fake.current.store.floatChat(sid);
    await setup({ placement: "window", sid });
    expect(item("window")).toBeNull();
    expect(item("sidebar")).not.toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("floats the chat and closes the sidebar", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    await setup({});
    item("window")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toMatchObject({ state: "open" });
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(track).toHaveBeenCalledWith("ai_window_opened", { from: "layout" });
    expect(track).toHaveBeenCalledWith("ai_container_moved", {
      from: "sidebar",
      to: "window",
      turn_running: false,
    });
  });

  it("hides Floating window at the cap of 4", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    for (let i = 0; i < 4; i += 1)
      store.floatChat(store.createSession({ origin: ORIGIN, detached: true }), { focus: "none" });
    await setup({ sid });
    expect(item("window")).toBeNull();
  });

  it("drops Floating window below lg, where windows do not exist", async () => {
    lg.value = false;
    await setup({ placement: "full" });
    expect(item("window")).toBeNull();
    expect(item("sidebar")).not.toBeNull();
    expect(item("full")).toBeNull();
  });

  it("offers only Full view on the sheet", async () => {
    lg.value = false;
    await setup({ sheet: true });
    expect(item("sidebar")).toBeNull();
    expect(item("window")).toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("offers only Full view in a modal dock (decision 11)", async () => {
    await setup({ placement: "docked", dockHost: "alert_query" });
    expect(item("window")).toBeNull();
    expect(item("sidebar")).toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("opens a window's chat at full page in a new browser tab and closes it here", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    store.state.sessions[sid].record.serverBacked = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { router } = await setup({ placement: "window", sid });
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith(`/?tab=ai&thread=${sid}`, "_blank");
    expect(store.windowOf(sid)).toBeFalsy();
    expect(store.windowAnnouncement.value?.key).toBe("assistant.announce.openedInTab");
    expect(store.state.sessions[sid]).toBeDefined();
    expect(router.currentRoute.value.name).toBe("logs");
    open.mockRestore();
  });

  it("opens a running chat not saved yet in a new tab on that chat, telling the tab to wait for it", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    store.state.sessions[sid].messages.push({
      role: "user",
      content: raw("why 5xx?"),
      turnId: "t1",
    });
    store.state.sessions[sid].turn = { state: "responding.writing" } as never;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const save = vi.spyOn(fake.current.history, "save");
    const { router } = await setup({ placement: "window", sid });
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith(`/?tab=ai&thread=${sid}`, "_blank");
    expect(router.currentRoute.value.name).toBe("logs");
    expect(store.state.sessions[sid].turn.state).toBe("responding.writing");
    expect(takeFullTabHandoff(store.state.userOrgKey, sid, false)).toMatchObject({
      target: sid,
      pending: true,
    });
    expect(save).toHaveBeenCalledWith(sid, { live: true });
    open.mockRestore();
  });

  it("hands the new tab the card a waiting chat holds, so it can be answered there", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    const session = store.state.sessions[sid];
    session.record.serverBacked = true;
    session.messages.push({ role: "user", content: raw("mute it"), turnId: "t1" });
    session.pendingApproval = {
      id: "apr_1",
      sessionId: sid,
      turnId: "t1",
      kind: "permission",
      destructive: false,
      operation: "CreateDowntime",
      tool: "CreateDowntime",
      targets: [],
      expiresAt: 9_000_000_000_000,
      askedIn: "here",
      grantable: false,
      editable: false,
      question: "Create the downtime?",
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({});
    item("full")!.click();
    await flushPromises();
    const handoff = takeFullTabHandoff(store.state.userOrgKey, sid, false);
    expect(handoff?.card).toMatchObject({
      turnId: "t1",
      block: { id: "apr_1", tool: "CreateDowntime", expiresAt: 9_000_000_000_000 },
    });
    expect(handoff?.card?.block).not.toHaveProperty("sessionId");
    open.mockRestore();
  });

  it("names a chat not yet created as the one Full page took, so the panel's close says so", async () => {
    const { store } = fake.current;
    store.state.shell.activeSid = null;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({ sid: null });
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith("/?tab=ai&thread=", "_blank");
    expect(movedToTab.value).toEqual({ sid: null });
    expect(store.state.shell.placement.kind).toBe("hidden");
    movedToTab.value = null;
    open.mockRestore();
  });

  it("closes the side panel here once its chat opens at full page in a new tab", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.state.sessions[sid].record.serverBacked = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({});
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith(`/?tab=ai&thread=${sid}`, "_blank");
    expect(store.state.shell.placement.kind).toBe("hidden");
    open.mockRestore();
  });

  it("keeps the phone sheet's Full page in this tab", async () => {
    lg.value = false;
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.state.sessions[sid].record.serverBacked = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { router } = await setup({ sheet: true });
    item("full")!.click();
    await flushPromises();
    expect(open).not.toHaveBeenCalled();
    expect(store.state.shell.placement.kind).toBe("full");
    expect(router.currentRoute.value.query.thread).toBe(sid);
    open.mockRestore();
  });

  it("hands the new tab the draft's photos and the agent picked for it", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    const image = {
      id: "i1",
      data: "AAAA",
      mimeType: "image/png" as const,
      filename: "a.png",
      size: 3,
    };
    store.state.sessions[sid].composer.images.push(image);
    store.state.sessions[sid].agentId = "sre";
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({});
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith("/?tab=ai&thread=", "_blank");
    expect(takeFullTabHandoff(store.state.userOrgKey, "fresh", true)).toMatchObject({
      target: null,
      images: [image],
      agentId: "sre",
    });
    open.mockRestore();
  });

  it("opens an unsent chat as a new full-page chat in a new tab that takes its draft", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.state.sessions[sid].composer.text = "why 5xx?";
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({});
    item("full")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith("/?tab=ai&thread=", "_blank");
    const handoff = takeFullTabHandoff(store.state.userOrgKey, "fresh", true);
    expect(handoff).toMatchObject({ target: null, text: "why 5xx?" });
    expect(store.state.sessions[sid].composer.text).toBe("why 5xx?");
    open.mockRestore();
  });

  it("starts an empty full-page chat in a new tab from a chat with messages, leaving that chat as it was", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.state.sessions[sid].messages.push({
      role: "user",
      content: raw("why 5xx?"),
      turnId: "t1",
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({});
    expect(item("full-new")!.textContent).toContain("New chat in full page");
    item("full-new")!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith("/?tab=ai&thread=", "_blank");
    expect(store.state.shell.activeSid).toBe(sid);
    expect(store.state.shell.placement.kind).toBe("sidebar");
    open.mockRestore();
  });

  it("offers no separate new full-page chat when the chat is already empty", async () => {
    await setup({});
    expect(item("full")).not.toBeNull();
    expect(item("full-new")).toBeNull();
  });

  it("asks the side panel for focus again once the full view's page has taken over", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    const { router } = await setup({ placement: "full", sid });
    await router.push({ name: "home", query: { thread: sid } });
    await flushPromises();
    item("sidebar")!.click();
    const asked = store.focusRequest.value?.seq ?? 0;
    await router.push({ name: "home" });
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("sidebar");
    expect(store.focusRequest.value?.seq).toBeGreaterThan(asked);
  });

  it("pins a window's chat from Side panel", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    await setup({ placement: "window", sid });
    item("sidebar")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toBeNull();
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });

  it("names the two other moves, in the board's order, with no check mark", async () => {
    await setup({});
    const items = document.body.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    expect([...items].map((el) => el.getAttribute("data-test"))).toEqual([
      "assistant-shell-place-full",
      "assistant-shell-place-window",
    ]);
    expect([...items].map((el) => el.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Full page (opens in a new tab)",
      "Floating window",
    ]);
    expect(document.body.querySelector("[aria-checked]")).toBeNull();
    expect(document.body.querySelector('[role="separator"]')).toBeNull();
  });

  it("draws the moves as direct buttons named by their mode, with no trigger", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    const wrapper = mount(AssistantModeButtons, {
      props: { placement: "sidebar", sid: fake.current.store.state.shell.activeSid },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-open-as-button"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="assistant-shell-place-sidebar"]').attributes("aria-pressed"),
    ).toBe("true");
    expect(wrapper.get('[data-test="assistant-shell-place-full"]').attributes("aria-label")).toBe(
      "Full page",
    );
    expect(wrapper.get('[data-test="assistant-shell-place-window"]').attributes("aria-label")).toBe(
      "Floating window",
    );
    await wrapper.get('[data-test="assistant-shell-place-window"]').trigger("click");
    await flushPromises();
    expect(fake.current.store.state.shell.placement.kind).toBe("hidden");
    wrapper.unmount();
  });
  it.each([
    ["/logs?org_identifier=acme&stream=app&sql=x&from=1", { org_identifier: "acme" }],
    ["/?org_identifier=acme&period=7d", { org_identifier: "acme", period: "7d" }],
  ])("T-02-02: Full Page from %s keeps only the keys that belong on Home", async (url, query) => {
    const router = fakeRouter();
    await router.push(url);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = mount(AssistantModeButtons, {
      props: { placement: "sidebar", sid: fake.current.store.state.shell.activeSid },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.get('[data-test="assistant-shell-place-full"]').trigger("click");
    await flushPromises();
    const href = router.resolve({ name: "home", query: { ...query, tab: "ai", thread: "" } }).href;
    expect(open).toHaveBeenCalledWith(href, "_blank");
    open.mockRestore();
    wrapper.unmount();
  });
});

describe("placementMode", () => {
  it("names the sheet, and every other placement as itself", () => {
    expect(placementMode("sidebar", true)).toBe("sheet");
    expect(placementMode("sidebar", false)).toBe("sidebar");
    expect(placementMode("window", false)).toBe("window");
    expect(placementMode("full", false)).toBe("full");
  });
});
