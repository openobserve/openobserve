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

import { contextRegistry } from "@/composables/contextProviders/registry";
import { requestOverviewFocus } from "@/composables/goto/goToRequests";
import { GO_TO_PAGES, type GoToPage } from "@/composables/goto/types";

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

// Each mount registers a focus listener, so every launcher a case left behind is unmounted.
const mounted: { unmount(): void }[] = [];

function setup(gate: GateCode = "available", history: Record<string, unknown> = {}) {
  fake.current = fakeAssistant(gate);
  fake.current.history = Object.assign(fake.current.history, history);
  const router = fakeRouter([
    { path: "/billings/plans", name: "plans", component: { render: () => null } },
  ]);
  const wrapper = mount(AssistantLauncher, {
    global: { plugins: [router, fakeVuex()] },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, router, store: fake.current.store };
}

const input = (wrapper: ReturnType<typeof setup>["wrapper"]) => wrapper.get("input");

const PAGES: GoToPage[] = [
  {
    id: "logs",
    label: raw("Logs"),
    route: { path: "/logs", query: { org_identifier: "default" } },
  },
];

function setupOn(
  props: Record<string, unknown>,
  routes: { path: string; name: string }[] = [],
): ReturnType<typeof setup> {
  fake.current = fakeAssistant("available");
  const router = fakeRouter(
    [
      { path: "/billings/plans", name: "plans" },
      { path: "/logs", name: "logs" },
      { path: "/home", name: "home" },
      ...routes,
    ].map((r) => ({ ...r, component: { render: () => null } })),
  );
  const wrapper = mount(AssistantLauncher, {
    props,
    global: {
      plugins: [router, fakeVuex()],
      provide: { [GO_TO_PAGES as symbol]: computed(() => PAGES) },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, router, store: fake.current.store };
}

describe("AssistantLauncher", () => {
  afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()));

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

  it("carries a Home starter's provenance into the staged payload (PO A26)", async () => {
    STARTERS[1].home = true;
    const { wrapper } = setup();
    await wrapper.get('[data-test="assistant-launcher-starter-1"]').trigger("click");
    delete STARTERS[1].home;
    expect(open.mock.calls[0][0].payload).toMatchObject({ text: "Prompt 1", homeStarter: true });
  });

  it("stages a starter's window as a time chip ending at the click", async () => {
    STARTERS[0].period = "1h";
    const { wrapper } = setup();
    await wrapper.get('[data-test="assistant-launcher-starter-0"]').trigger("click");
    delete STARTERS[0].period;
    const chips = open.mock.calls[0][0].payload.chips;
    expect(chips[0]).toMatchObject({ kind: "time", provenance: "door" });
    expect(chips[0].ref.to - chips[0].ref.from).toBe(3_600_000);
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
    expect(row.attributes("data-status")).toBe("answering");
    expect(row.get('[data-test="assistant-launcher-recent-status"]').text()).toBe("Answering");
  });

  it("puts a chat that needs the user first in Your chats, with its state in words", async () => {
    const { wrapper, store } = setup();
    const waiting = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[waiting].messages.push({ role: "user", content: raw("old") });
    store.state.sessions[waiting].pendingApproval = { id: "a1" } as never;
    store.setActive(null);
    for (const title of ["b", "c", "d"]) {
      const sid = store.createSession({
        origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      });
      store.state.sessions[sid].messages.push({ role: "user", content: raw(title) });
      store.setActive(null);
    }
    await flushPromises();
    const first = wrapper.get('[data-test="assistant-launcher-recent-0"]');
    expect(first.attributes("data-status")).toBe("needs_you");
    expect(first.text()).toContain("Needs you");
    expect(wrapper.findAll('[data-test^="assistant-launcher-recent-"]').length).toBeLessThanOrEqual(
      4,
    );
    expect(wrapper.get('[data-test="assistant-launcher-your-chats"]').classes()).toContain(
      "max-md:order-first",
    );
  });

  it("keeps a read-only Your chats under the locked row on G2 (PO A7)", () => {
    const { wrapper } = setup("no_permission");
    expect(wrapper.find('[data-test="assistant-gate-state"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-launcher-suggestions"]').exists()).toBe(false);
  });

  it("hides while the sidebar is open, so Home never shows a second assistant", async () => {
    const { wrapper, store } = setup();
    expect(wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(true);
    store.state.shell.placement = { kind: "sidebar" };
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(false);
    store.state.shell.placement = { kind: "hidden" };
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-launcher-suggestions"]').exists()).toBe(true);
  });

  it("holds the time prefix and the i inside the input, and opens the full view in place", () => {
    const { wrapper } = setup();
    const field = wrapper.get('[data-test="assistant-launcher-input"]');
    expect(field.find('[data-test="assistant-context-chip-time"]').text()).toBe("Last 15 min");
    expect(field.find('[data-test="assistant-launcher-sees"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-launcher-open"]').text()).toBe("Open full view");
    expect(input(wrapper).attributes("placeholder")).toBe("Ask about your data");
  });

  it("turns Ask on only with text", async () => {
    const { wrapper } = setup();
    const ask = () => wrapper.get('[data-test="assistant-launcher-ask"]');
    expect(ask().attributes("disabled")).toBeDefined();
    await input(wrapper).setValue("why?");
    expect(ask().attributes("disabled")).toBeUndefined();
  });

  it("states a failed list with the same words as the title menu, and retries", async () => {
    const retry = vi.fn();
    const listState = computed(() => ({ status: "error", offline: false }));
    const { wrapper } = setup("available", { listState, retry });
    await flushPromises();
    const row = wrapper.get('[data-test="assistant-launcher-recent-failed"]');
    expect(row.text()).toContain("Couldn't load your chats");
    await wrapper.get('[data-test="assistant-launcher-recent-retry"]').trigger("click");
    expect(retry).toHaveBeenCalled();
  });

  it("opens What the assistant sees from a named icon that takes no text width (PO A34)", () => {
    const { wrapper } = setup();
    const sees = wrapper.get('[data-test="assistant-launcher-sees"]');
    expect(sees.text()).toBe("");
    expect(sees.attributes("aria-label")).toBe("What the assistant sees");
  });

  it("shows at most three suggestions and no other suggestion group (PO A34)", () => {
    const { wrapper } = setup();
    expect(wrapper.findAll('[data-test^="assistant-launcher-starter-"]')).toHaveLength(3);
    expect(wrapper.findAll("h3").map((heading) => heading.text())).toEqual(["Recent"]);
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

  describe("on the Overview", () => {
    afterEach(() => contextRegistry.cleanup());

    const HOME_PAGE = {
      currentPage: "home",
      page: "home_overview",
      org_id: "default",
      overviewIncidents: [
        { id: "inc-7", title: "Checkout errors", severity: "P1", status: "open", alert_count: 3 },
      ],
      overviewServices: [],
    };

    it("stays visible with the dock open and keeps the chats for the right column", async () => {
      const { wrapper, store } = setupOn({ layout: "overview" });
      store.state.shell.placement = { kind: "sidebar" };
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(false);
      const chats = setupOn({ layout: "chats" }).wrapper;
      expect(chats.find("input").exists()).toBe(false);
      expect(chats.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(true);
    });

    it("always starts a new chat, in the dock while it is open", async () => {
      const { wrapper, store } = setupOn({ layout: "overview" });
      store.state.shell.placement = { kind: "sidebar" };
      await flushPromises();
      await input(wrapper).setValue("why 5xx?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ thread: "new", container: "sidebar", intent: "send" }),
      );
    });

    it("mirrors the page range in the time chip and moves the page range from it", async () => {
      const range = { from: 1_000, to: 3_601_000, period: "1h" };
      const { wrapper } = setupOn({ layout: "overview", pageRange: range });
      await flushPromises();
      const prefix = wrapper.findComponent({ name: "AssistantTimePrefix" });
      expect(prefix.props("window")).toMatchObject({ ...range, source: "page" });
      prefix.vm.$emit("change", { from: 0, to: 1, period: "24h" });
      expect(wrapper.emitted("update:pageRange")).toEqual([[{ from: 0, to: 1, period: "24h" }]]);
      await input(wrapper).setValue("what changed?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0].payload.timeOverride).toEqual(range);
    });

    it("leaves a removed page chip out of the next question only", async () => {
      contextRegistry.register("home", { getContext: () => HOME_PAGE as never });
      contextRegistry.setActive("home");
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      const chips = () => wrapper.find('[data-test="assistant-launcher-page-chips"]');
      expect(chips().text()).toContain("Incidents on Overview (1)");
      await chips().get('[data-test="assistant-context-chip-remove"]').trigger("click");
      expect(chips().find('[data-state="ghost"]').exists()).toBe(true);
      await input(wrapper).setValue("why?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0].payload.removedPageKeys).toEqual(["overviewIncidents"]);
      expect(chips().find('[data-state="ghost"]').exists()).toBe(false);
      await input(wrapper).setValue("and now?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[1][0].payload.removedPageKeys).toBeUndefined();
    });

    it("lists Go to matches before the ask and opens an arrowed match with the way back", async () => {
      const { wrapper, router } = setupOn({
        layout: "overview",
        pageRange: { from: 1_000, to: 2_000, period: "1h" },
      });
      await flushPromises();
      await input(wrapper).setValue("logs");
      await flushPromises();
      const options = wrapper.findAll('[data-test^="assistant-launcher-go-to-results-option-"]');
      expect(options.map((o) => o.attributes("data-kind"))).toEqual(["page", "ask"]);
      expect(input(wrapper).attributes("role")).toBe("combobox");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("logs");
      expect(router.currentRoute.value.query.home_return).toBe("period=1h&focus=ask");
      expect(open).not.toHaveBeenCalled();
    });

    it("asks on Enter when nothing is arrowed onto", async () => {
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      await input(wrapper).setValue("why is checkout failing");
      await flushPromises();
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0]).toMatchObject({ payload: { text: "why is checkout failing" } });
    });

    it("answers the ⌘K focus request while it can take a question", async () => {
      expect(requestOverviewFocus()).toBe(false);
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      expect(requestOverviewFocus()).toBe(true);
      expect(document.activeElement).toBe(input(wrapper).element);
      mounted.splice(0).forEach((w) => w.unmount());
      expect(requestOverviewFocus()).toBe(false);
    });

    it("clears and focuses the field once on focus=ask, then drops the key", async () => {
      const { wrapper, router } = setupOn({ layout: "overview" });
      await router.replace({ name: "home", query: { focus: "ask", row: "incident:7" } });
      await flushPromises();
      expect(document.activeElement).toBe(input(wrapper).element);
      expect(router.currentRoute.value.query).toEqual({ row: "incident:7" });
    });
  });
});
