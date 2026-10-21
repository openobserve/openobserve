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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";

import type { GateCode, Starter } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantLauncher, { launcherState } from "./AssistantLauncher.vue";

const { fake, open, loading } = vi.hoisted(() => ({
  fake: { current: null as any },
  open: vi.fn(),
  loading: { value: false },
}));

const STARTERS: Starter[] = [0, 1, 2, 3].map((i) => ({
  id: `s${i}`,
  kind: "page",
  label: raw(`Starter ${i}`),
  prompt: `Prompt ${i}`,
  chips: [],
  dataTest: `assistant-starter-${i}`,
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantHistory: () => fake.current.history,
  useAssistantCapability: () => fake.current.handle,
  openAssistant: (...args: unknown[]) => open(...args),
  useAssistantStarters: () => ({
    starters: computed(() => STARTERS),
    loading: computed(() => loading.value),
    scope: computed(() => ({ org: "default", streamCount: 3, timeRange: null, canWrite: "yes" })),
  }),
}));
vi.mock("@/components/ai-assistant/context/AssistantContextSeesPopover.vue", () => ({
  default: { name: "SeesStub", template: "<div><slot name='trigger' /></div>" },
}));
vi.mock("@/components/ai-assistant/gate/AssistantGateState.vue", () => ({
  default: {
    name: "GateStub",
    props: ["reason"],
    template: '<div data-test="assistant-gate-state" :data-gate="reason" />',
  },
}));

function setup(gate: GateCode = "available") {
  fake.current = fakeAssistant(gate);
  const router = fakeRouter([
    { path: "/billings/plans", name: "plans", component: { render: () => null } },
  ]);
  const wrapper = mount(AssistantLauncher, {
    global: { plugins: [router, fakeVuex()] },
    attachTo: document.body,
  });
  return { wrapper, router, store: fake.current.store };
}

const input = (wrapper: ReturnType<typeof setup>["wrapper"]) => wrapper.get("input");

describe("AssistantLauncher", () => {
  beforeEach(() => {
    open.mockReset().mockResolvedValue({ ok: true });
    loading.value = false;
    document.body.innerHTML = "";
  });

  it("maps gates: skeleton while loading, nothing on G0/G1, the locked state on G2", () => {
    expect(launcherState("loading")).toBe("loading");
    expect(launcherState("not_entitled")).toBeNull();
    expect(launcherState("not_configured")).toBeNull();
    expect(launcherState("unhealthy")).toBe("ready");
    expect(setup("not_entitled").wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(
      false,
    );
    const locked = setup("no_permission").wrapper;
    expect(locked.get('[data-test="assistant-gate-state"]').attributes("data-gate")).toBe(
      "no_permission",
    );
    expect(locked.find("input").exists()).toBe(false);
  });

  it("is one masked card named by its heading, with a named input and three starters", () => {
    const { wrapper } = setup();
    const card = wrapper.get('[data-test="assistant-launcher"]');
    expect(card.attributes("data-dd-privacy")).toBe("mask");
    const heading = wrapper.get(`#${card.attributes("aria-labelledby")}`);
    expect(heading.text()).toBe("O2 Assistant");
    expect(input(wrapper).attributes("aria-label")).toBe("Ask O2 Assistant");
    expect(input(wrapper).attributes("maxlength")).toBe("4000");
    expect(wrapper.findAll('[data-test^="assistant-launcher-starter-"]')).toHaveLength(3);
  });

  it("sends the typed line on Enter as a new chat in the full view (HOME-01)", async () => {
    const { wrapper } = setup();
    await input(wrapper).setValue("why 5xx?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open).toHaveBeenCalledWith({
      entryKind: "home_launcher",
      entryVerb: "ask",
      objectKind: "none",
      intent: "send",
      thread: "new",
      container: "full",
      payload: { text: "why 5xx?", chips: [] },
    });
    expect((input(wrapper).element as HTMLInputElement).value).toBe("");
  });

  it("stages on Shift+Enter, ignores an IME Enter and opens /assistant on an empty Enter", async () => {
    const { wrapper, router } = setup();
    await input(wrapper).setValue("draft");
    await input(wrapper).trigger("keydown", { key: "Enter", isComposing: true });
    expect(open).not.toHaveBeenCalled();
    await input(wrapper).trigger("keydown", { key: "Enter", shiftKey: true });
    expect(open.mock.calls[0][0]).toMatchObject({ intent: "stage", payload: { text: "draft" } });
    await input(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("assistant");
  });

  it("keeps the text on Escape and clears it only with the clear button (HOME-03, round 1 X-20)", async () => {
    const { wrapper } = setup();
    await input(wrapper).setValue("keep me");
    (input(wrapper).element as HTMLInputElement).focus();
    await input(wrapper).trigger("keydown", { key: "Escape" });
    expect((input(wrapper).element as HTMLInputElement).value).toBe("keep me");
    expect(document.activeElement).not.toBe(input(wrapper).element);
    const clear = wrapper.get('[data-test="assistant-launcher-clear"]');
    expect(clear.attributes("aria-label")).toBe("Clear question");
    await clear.trigger("click");
    expect((input(wrapper).element as HTMLInputElement).value).toBe("");
  });

  it("stages a starter without sending", async () => {
    const { wrapper } = setup();
    await wrapper.get('[data-test="assistant-launcher-starter-1"]').trigger("click");
    expect(open.mock.calls[0][0]).toMatchObject({ intent: "stage", payload: { text: "Prompt 1" } });
  });

  it("lists this tab's recent chats, a running one marked, and says when there are none", async () => {
    const { wrapper, store } = setup();
    expect(wrapper.find('[data-test="assistant-launcher-recent-empty"]').exists()).toBe(true);
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
    store.state.sessions[sid].turn = { state: "responding.writing" };
    await flushPromises();
    const row = wrapper.get('[data-test="assistant-launcher-recent-0"]');
    expect(row.attributes("data-running")).toBe("");
    expect(row.text()).toContain("Answering…");
  });

  it("shows skeleton rows while the starters load", () => {
    loading.value = true;
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-launcher-loading"]').exists()).toBe(true);
    expect(input(wrapper).attributes("disabled")).toBeDefined();
  });

  it("tags used-up credits next to the title", () => {
    fake.current = null;
    const { wrapper, store } = setup();
    void store;
    fake.current.capability.value = { ...fake.current.capability.value, creditMode: "exhausted" };
    return flushPromises().then(() => {
      expect(wrapper.get('[data-test="assistant-launcher-credits"]').text()).toBe(
        "Credits used up",
      );
    });
  });
});
