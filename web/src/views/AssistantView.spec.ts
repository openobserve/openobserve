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

import { closeLockedPanel } from "@/components/ai-assistant/shell/lockedPanel";

import AssistantView, { chatRef, viewFor } from "./AssistantView.vue";

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
  router.addRoute({ path: "/assistant/:chatId?", name: "assistant", component: AssistantView });
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
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    const sid = store.state.shell.activeSid;
    await router.push("/assistant");
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("full");
    await router.push("/logs");
    await flushPromises();
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
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
    expect(pitch.router.currentRoute.value.name).not.toBe("assistant");
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
