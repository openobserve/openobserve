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
import type { AssistantCapability, GateCode } from "@/composables/assistant";

import { SHELL_ROUTE_CONTEXT } from "@/components/ai-assistant/shell/AssistantShell.vue";
import { closeLockedPanel } from "@/components/ai-assistant/shell/lockedPanel";

import AssistantView, { chatRef, RAIL_DEFAULT_REM, railPx, viewFor } from "./AssistantView.vue";

const SID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantHistory: () => fake.current.history,
  useAssistantCapability: () => fake.current.handle,
  useAssistantStarters: () => ({
    starters: computed(() => []),
    loading: computed(() => false),
    scope: computed(() => ({ org: "default", streamCount: 1, timeRange: null, canWrite: "yes" })),
  }),
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));
vi.mock("@/views/Error404.vue", () => ({
  default: { template: '<div data-test="error-404">not found</div>' },
}));

async function setup(
  path = "/assistant",
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
  prepare?: (store: any) => void,
) {
  fake.current = fakeAssistant(gate, over);
  prepare?.(fake.current.store);
  const router = fakeRouter();
  // Home hands the view its `?thread=`; the spec routes the same id in as the prop.
  router.addRoute({
    path: "/assistant/:chatId?",
    name: "assistant",
    component: AssistantView,
    props: (to) => ({ chatId: typeof to.params.chatId === "string" ? to.params.chatId : null }),
  });
  await router.push(path);
  const wrapper = mount(
    { template: "<router-view />" },
    { global: { plugins: [router, fakeVuex()] }, attachTo: document.body },
  );
  return { wrapper, router, store: fake.current.store };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("viewFor and chatRef", () => {
  it.each([
    ["loading", true, "loading"],
    ["not_entitled", false, "gate"],
    ["not_configured", true, "gate"],
    ["not_configured", false, "not_found"],
    ["off_for_org", false, "gate"],
    ["no_permission", false, "gate"],
    ["unhealthy", false, "shell"],
    ["available", false, "shell"],
  ] as const)("renders %s for admin=%s as %s", (gate, admin, view) => {
    expect(viewFor(gate, admin)).toBe(view);
  });

  it("reads a session id or a local chat id from the route", () => {
    expect(chatRef(SID)).toEqual({ sid: SID });
    expect(chatRef("1723456789012")).toEqual({ chatId: 1723456789012 });
    expect(chatRef("not-a-chat")).toBeNull();
  });
});

describe("AssistantView", () => {
  it("opens a new session in the full view with the welcome and focuses its container", async () => {
    const { wrapper, store } = await setup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-view-title"]').text()).toBe("O2 Assistant");
    expect(store.state.shell.placement.kind).toBe("full");
    expect(store.state.shell.activeSid).not.toBeNull();
    expect(store.focusRequest.value?.target).toBe("composer");
    expect(wrapper.find('[data-test="assistant-shell-full"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-welcome"]').exists()).toBe(true);
  });

  it("opens the Threads rail at the board's width, not the layout's 230px default", async () => {
    const { wrapper } = await setup();
    await flushPromises();
    const layout = wrapper.findComponent({ name: "OPageLayout" });
    expect(layout.props("sidebarWidth")).toBe(railPx(RAIL_DEFAULT_REM));
    expect(railPx(RAIL_DEFAULT_REM)).toBeGreaterThanOrEqual(340);
    const [min, max] = layout.props("splitterLimits") as [number, number];
    expect(min).toBeLessThan(railPx(RAIL_DEFAULT_REM));
    expect(max).toBeGreaterThan(railPx(RAIL_DEFAULT_REM));
  });

  it("starts a new chat on the window the previous chat was asking about", async () => {
    const { wrapper, store } = await setup();
    await flushPromises();
    const first = store.state.shell.activeSid as string;
    store.state.sessions[first].messages.push({ role: "user", content: "hi" });
    store.setTimeOverride(first, { from: 1, to: 2, period: "24h" });
    await flushPromises();
    await wrapper.find('[data-test="assistant-thread-new"]').trigger("click");
    await flushPromises();
    const next = store.state.shell.activeSid as string;
    expect(next).not.toBe(first);
    expect(store.state.sessions[next].composer.timeOverride).toEqual({
      from: 1,
      to: 2,
      period: "24h",
    });
  });

  it("keeps the conversation mounted when the URL catches up with the chat on screen", async () => {
    const { wrapper, router, store } = await setup();
    await flushPromises();
    const sid = store.state.shell.activeSid as string;
    store.state.sessions[sid].messages.push({ role: "user", content: "hi" });
    const open = vi.spyOn(store, "openSession");
    const focus = store.focusRequest.value;
    await router.replace(`/assistant/${sid}`);
    await flushPromises();
    expect(open).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(false);
    expect(store.focusRequest.value).toBe(focus);
    expect(store.state.shell.activeSid).toBe(sid);
  });

  it("shows the transcript skeleton, never the welcome, while a routed chat loads", async () => {
    let resolve!: (sid: string) => void;
    let open: ReturnType<typeof vi.fn> | undefined;
    const { wrapper } = await setup(`/assistant/${SID}`, "available", {}, (store) => {
      open = vi
        .spyOn(store, "openSession")
        .mockImplementation(() => new Promise<string>((r) => (resolve = r))) as never;
    });
    await flushPromises();
    expect(open).toHaveBeenCalled();
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-welcome"]').exists()).toBe(false);
    resolve(SID);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(false);
  });

  it("says the chat isn't available when the routed chat cannot be opened", async () => {
    const { wrapper } = await setup(`/assistant/${SID}`);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-not-found"]').exists()).toBe(true);
  });

  it("restores the previous placement on leave without touching the session", async () => {
    const { store, router } = await setup("/logs");
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar" }, { focus: "none" });
    const sid = store.state.shell.activeSid;
    await router.push("/assistant");
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("full");
    await router.push("/logs");
    await flushPromises();
    expect(store.state.shell.placement).toEqual({ kind: "sidebar" });
    expect(store.state.shell.activeSid).toBe(sid);
  });

  it("renders the hero gate for G0, G2 and G1 admins, and not found for G1 members", async () => {
    for (const [gate, admin, selector] of [
      ["not_entitled", false, '[data-gate="not_entitled"][data-size="hero"]'],
      ["no_permission", false, '[data-gate="no_permission"][data-size="hero"]'],
      ["not_configured", true, '[data-gate="not_configured"][data-size="hero"]'],
      ["not_configured", false, '[data-test="error-404"]'],
    ] as const) {
      const { wrapper } = await setup("/assistant", gate, { isAdmin: admin });
      await flushPromises();
      expect(wrapper.find(selector).exists()).toBe(true);
      expect(wrapper.find("[data-assistant-root]").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("shows the page skeleton until the gate resolves", async () => {
    const { wrapper } = await setup("/assistant", "loading");
    expect(wrapper.find('[data-test="assistant-view-loading"]').exists()).toBe(true);
  });

  it("ignores a slow chat load once the route has moved to another chat", async () => {
    const OTHER = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
    const pending: Record<string, (value: string) => void> = {};
    const failing: Record<string, (reason: Error) => void> = {};
    const { wrapper, router } = await setup(`/assistant/${SID}`, "available", {}, (store) => {
      vi.spyOn(store, "openSession").mockImplementation(
        (ref: { sid: string }) =>
          new Promise<string>((resolve, reject) => {
            pending[ref.sid] = resolve;
            failing[ref.sid] = reject;
          }),
      );
    });
    await flushPromises();
    await router.push(`/assistant/${OTHER}`);
    await flushPromises();
    pending[OTHER](OTHER);
    await flushPromises();
    failing[SID](new Error("gone"));
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-not-found"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(false);
  });

  it("ends a superseded load when Back returns to the chat on screen and keeps that chat", async () => {
    const { wrapper, router, store } = await setup();
    await flushPromises();
    const shown = store.state.shell.activeSid as string;
    store.state.sessions[shown].messages.push({ role: "user", content: "hi" });
    await router.replace(`/assistant/${shown}`);
    await flushPromises();
    const real = store.openSession.bind(store);
    let finish!: () => void;
    vi.spyOn(store, "openSession").mockImplementation((ref: { sid: string }) => {
      if (ref.sid !== SID) return real(ref);
      return new Promise<string>((resolve) => {
        finish = () => {
          store.state.sessions[SID] = { ...store.state.sessions[shown], sid: SID };
          store.state.shell.activeSid = SID;
          resolve(SID);
        };
      });
    });
    await router.push(`/assistant/${SID}`);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(true);
    await router.back();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(false);
    finish();
    await flushPromises();
    expect(store.state.shell.activeSid).toBe(shown);
    expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(false);
  });

  it("keeps a chat deleted in another tab on its deleted state once the URL drops its id", async () => {
    const { wrapper, router, store } = await setup();
    await flushPromises();
    const sid = store.state.shell.activeSid as string;
    store.state.sessions[sid].messages.push({ role: "user", content: "hi" });
    await router.replace(`/assistant/${sid}`);
    await flushPromises();
    fake.current.history.deletedNotice.value = { sid, via: "tab" };
    store.dropSession(sid, "deleted_elsewhere");
    await flushPromises();
    await router.replace("/assistant");
    await flushPromises();
    expect(store.state.shell.activeSid).toBeNull();
    expect(wrapper.find('[data-test="assistant-shell-deleted"]').text()).toContain(
      "deleted in another tab",
    );
  });

  it("keeps the deleted state when the store re-readies with no chat in the URL", async () => {
    const { wrapper, router, store } = await setup();
    await flushPromises();
    const sid = store.state.shell.activeSid as string;
    store.state.sessions[sid].messages.push({ role: "user", content: "hi" });
    await router.replace(`/assistant/${sid}`);
    await flushPromises();
    await router.replace("/assistant");
    await flushPromises();
    fake.current.history.deletedNotice.value = { sid, via: "tab" };
    store.dropSession(sid, "deleted_elsewhere");
    await flushPromises();
    store.state.ready = false;
    await flushPromises();
    store.state.ready = true;
    await flushPromises();
    expect(store.state.shell.activeSid).toBeNull();
    expect(wrapper.find('[data-test="assistant-shell-deleted"]').text()).toContain(
      "deleted in another tab",
    );
  });

  it.each(["new chat", "back"] as const)(
    "keeps the chat on screen when a routed load finishes after %s left it",
    async (how) => {
      let finish!: () => void;
      const { wrapper, router, store } = await setup("/assistant");
      // Home hosts the full thread under `?thread=`, so New chat stays on this route record.
      router.addRoute({
        path: "/home-thread",
        name: "home",
        component: AssistantView,
        props: (to) => ({ chatId: typeof to.query.thread === "string" ? to.query.thread : null }),
      });
      await router.push({ name: "home", query: { thread: "" } });
      await flushPromises();
      const plain = store.state.shell.activeSid as string;
      vi.spyOn(store, "openSession").mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            finish = () => {
              const shown = store.state.shell.activeSid as string;
              store.state.sessions[SID] = { ...store.state.sessions[shown], sid: SID };
              store.setActive(SID);
              resolve(SID);
            };
          }),
      );
      await router.push({ name: "home", query: { thread: SID } });
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-shell-loading"]').exists()).toBe(true);
      if (how === "back") await router.back();
      else
        (wrapper.findComponent(AssistantView).vm.$.provides as any)[SHELL_ROUTE_CONTEXT].newChat();
      await flushPromises();
      const kept = store.state.shell.activeSid as string;
      if (how === "back") expect(kept).toBe(plain);
      expect(kept).toBeTruthy();
      expect(router.currentRoute.value.query.thread).toBeFalsy();
      finish();
      await flushPromises();
      expect(store.state.shell.activeSid).toBe(kept);
    },
  );

  it("closes the hero pitch back to the previous page and explains in place", async () => {
    const { wrapper, router } = await setup("/logs", "no_permission");
    await router.push("/assistant");
    await flushPromises();
    await wrapper.get('[data-test="assistant-gate-learn-more"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="assistant-view-learn-dialog"]')).not.toBeNull();
    wrapper.unmount();
    const pitch = await setup("/logs", "not_entitled");
    await pitch.router.push("/assistant");
    await flushPromises();
    await pitch.wrapper.get('[data-test="assistant-gate-close"]').trigger("click");
    await flushPromises();
    expect(pitch.router.currentRoute.value.name).toBe("home");
  });

  it("goes back to Home's briefing from the bar's Home button, dropping the thread", async () => {
    const { wrapper, router } = await setup("/assistant");
    await flushPromises();
    await wrapper.get('[data-test="assistant-view-back-home"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(router.currentRoute.value.query.thread).toBeUndefined();
  });

  it("keeps the Home button to its icon on a phone, still named Home, so the thread title is not cut", async () => {
    const { wrapper } = await setup("/assistant");
    await flushPromises();
    const back = wrapper.get('[data-test="assistant-view-back-home"]');
    expect(back.attributes("aria-label")).toBe("Home");
    expect(back.get("span.max-md\\:sr-only").text()).toBe("Home");
    expect(back.classes()).toEqual(expect.arrayContaining(["max-md:min-h-11", "max-md:min-w-11"]));
  });

  it("focuses the hero's primary action only when the locked sidebar moved here", async () => {
    const plain = await setup("/assistant", "no_permission");
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-test")).not.toBe("assistant-gate-ask-admin");
    plain.wrapper.unmount();
    closeLockedPanel("move");
    await setup("/assistant", "no_permission");
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-test")).toBe("assistant-gate-ask-admin");
  });
});
