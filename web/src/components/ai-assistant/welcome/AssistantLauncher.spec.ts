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
import OFile from "@/lib/forms/File/OFile.vue";
import { requestOverviewFocus } from "@/composables/goto/goToRequests";

import type { CapabilityAgent, GateCode, Starter } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantComposerPlusMenu, {
  type ComposerPlusAction,
} from "../composer/AssistantComposerPlusMenu.vue";
import AssistantLauncher, { launcherState } from "./AssistantLauncher.vue";
import AssistantLauncherAgent from "./AssistantLauncherAgent.vue";

const ROSTER: CapabilityAgent[] = [
  { id: "o2-ai", pickable: true, available: true },
  { id: "sre", pickable: true, available: true },
];

const { fake, open, loading, mentionPick, startersRead, toastCall } = vi.hoisted(() => ({
  fake: { current: null as any },
  open: vi.fn(),
  loading: { value: false },
  mentionPick: { current: null as any },
  startersRead: vi.fn(),
  toastCall: vi.fn(),
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
  useAssistantStarters: () => {
    startersRead();
    return {
      starters: computed(() => STARTERS),
      loading: computed(() => loading.value),
      scope: computed(() => ({ org: "default", streamCount: 3, timeRange: null, canWrite: "yes" })),
    };
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastCall(...args),
}));
vi.mock("@/components/ai-assistant/context/AssistantMentionMenu.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "AssistantMentionMenu",
      props: {
        open: null,
        query: null,
        org: null,
        listboxId: null,
        sid: null,
        hideAgents: Boolean,
      },
      setup(props, { expose }) {
        expose({
          current: () => mentionPick.current,
          move: () => undefined,
          choose: () => undefined,
        });
        return () =>
          props.open
            ? h("div", {
                "data-test": "assistant-mention-panel",
                "data-query": props.query,
                "data-hide-agents": String(props.hideAgents),
              })
            : null;
      },
    }),
  };
});
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

const input = (wrapper: ReturnType<typeof setup>["wrapper"]) => wrapper.get("textarea");

// The + menu's own spec covers its dropdown; here an item is picked as the menu reports it.
const plus = (wrapper: ReturnType<typeof setup>["wrapper"], action: ComposerPlusAction) =>
  wrapper.findComponent(AssistantComposerPlusMenu).vm.$emit("select", action);

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
    startersRead.mockReset();
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
    expect(locked.find("textarea").exists()).toBe(false);
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

  it("opens the composer's @ menu on Home and sends the picked stream as a chip, not as text", async () => {
    const chip = {
      id: "mention:stream:logs|ta_composer_logs",
      kind: "stream",
      label: raw("ta_composer_logs"),
      ref: { type: "stream", id: "ta_composer_logs", org: "default", streamType: "logs" },
      sizeBytes: 16,
      provenance: "mention",
      sent: "whitelist",
    };
    mentionPick.current = { id: chip.id, kind: "stream", label: chip.label, chip };
    const { wrapper } = setupOn({ layout: "overview" });
    await flushPromises();
    await input(wrapper).setValue("@ta_comp");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-mention-panel"]').attributes("data-query")).toBe(
      "ta_comp",
    );
    await input(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(open).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="assistant-mention-panel"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="assistant-launcher-mention-chip"]')).toHaveLength(1);
    expect((input(wrapper).element as HTMLTextAreaElement).value).toBe("");
    await input(wrapper).setValue("count errors");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0].payload).toMatchObject({ text: "count errors", chips: [chip] });
    expect(wrapper.findAll('[data-test="assistant-launcher-mention-chip"]')).toHaveLength(0);
  });

  it("types an @ at the caret from the + menu's Add Context and opens the @ menu", async () => {
    const { wrapper } = setupOn({ layout: "overview" });
    await flushPromises();
    await input(wrapper).setValue("count errors");
    plus(wrapper, "context");
    await flushPromises();
    expect((input(wrapper).element as HTMLTextAreaElement).value).toBe("count errors @");
    expect(document.activeElement).toBe(input(wrapper).element);
    expect(wrapper.get('[data-test="assistant-mention-panel"]').attributes("data-query")).toBe("");
  });

  it("keeps an unmatched @query as text and lists context only in the @ menu", async () => {
    mentionPick.current = null;
    const { wrapper } = setupOn({ layout: "overview" });
    await flushPromises();
    await input(wrapper).setValue("@nothing");
    await flushPromises();
    expect(
      wrapper.get('[data-test="assistant-mention-panel"]').attributes("data-hide-agents"),
    ).toBe("true");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open).not.toHaveBeenCalled();
    expect((input(wrapper).element as HTMLTextAreaElement).value).toBe("@nothing");
  });

  it("sends the agent picked on the agent chip with the new chat, then goes back to the default", async () => {
    const { wrapper } = setupOn({ layout: "overview" });
    fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
    await flushPromises();
    const agentChip = () => wrapper.get('[data-test="assistant-launcher-agent"]');
    expect(agentChip().attributes("data-agent")).toBe("o2-ai");
    wrapper.findComponent(AssistantLauncherAgent).vm.$emit("update:modelValue", "sre");
    await flushPromises();
    expect(agentChip().attributes("data-agent")).toBe("sre");
    await input(wrapper).setValue("why did checkout fail?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0]).toMatchObject({ agent: "sre" });
    await flushPromises();
    expect(agentChip().attributes("data-agent")).toBe("o2-ai");
    await input(wrapper).setValue("and now?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[1][0]).not.toHaveProperty("agent");
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
    expect(wrapper.get('[data-test="assistant-launcher-all-chats"]').text()).toBe("All threads");
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

  it("always shows the time chip after +, Last 15 min by default, and a pick from the chip replaces it with no remove", async () => {
    const { wrapper } = setup();
    const field = wrapper.get('[data-test="assistant-launcher-input"]');
    const chip = () => field.find('[data-test="assistant-context-chip-time"]');
    const remove = () => chip().find('[data-test="assistant-context-chip-remove"]');
    expect(chip().text()).toBe("Last 15 min");
    expect(remove().exists()).toBe(false);
    await chip().trigger("click");
    await flushPromises();
    (document.body.querySelector('[data-test="assistant-context-time-1h"]') as HTMLElement).click();
    await flushPromises();
    expect(chip().text()).toBe("Last 1 h");
    expect(remove().exists()).toBe(false);
    await input(wrapper).setValue("why?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0].payload.timeOverride).toMatchObject({ period: "1h" });
  });

  it("is the composer everywhere else is: no strip while empty, + and the time chip left, Send right", () => {
    const { wrapper } = setup();
    const field = wrapper.get('[data-test="assistant-composer-frame"]');
    expect(field.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
    const left = field.get('[data-test="assistant-composer-bar-left"]');
    expect(left.find('[data-test="assistant-context-chip-time"]').exists()).toBe(true);
    expect(left.find('[data-test="assistant-agent-pill"]').exists()).toBe(false);
    expect(left.findAll("button")[0].attributes("data-test")).toBe("assistant-composer-plus");
    expect(wrapper.findComponent(AssistantComposerPlusMenu).props("actions")).toEqual([
      "attach",
      "context",
    ]);
    expect(wrapper.find('[data-test="assistant-launcher-chip-row"]').exists()).toBe(false);
    const right = field.get('[data-test="assistant-composer-bar-right"]');
    expect(right.find('[data-test="assistant-launcher-ask"]').classes()).toContain("rounded-full");
    expect(wrapper.find('[data-test="assistant-launcher-narrow-tools"]').exists()).toBe(false);
  });

  it("gives Home's field the glow frame and a gradient Send once there is text", async () => {
    const { wrapper } = setupOn({ layout: "overview" });
    const box = wrapper.get('[data-test="assistant-composer-frame"] > div');
    expect(box.classes()).toEqual(
      expect.arrayContaining(["bg-gradient-brand-ribbon", "rounded-3xl", "assistant-border-flow"]),
    );
    const ask = () => wrapper.get('[data-test="assistant-launcher-ask"]');
    expect(ask().classes()).not.toContain("bg-gradient-ai");
    await input(wrapper).setValue("why?");
    expect(ask().classes()).toContain("bg-gradient-ai");
    const card = setup().wrapper;
    expect(card.get('[data-test="assistant-composer-frame"] > div').classes()).not.toContain(
      "bg-gradient-brand-ribbon",
    );
    await input(card).setValue("why?");
    expect(card.get('[data-test="assistant-launcher-ask"]').classes()).not.toContain(
      "bg-gradient-ai",
    );
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

  it("shows at most three suggestions and no other suggestion group (PO A34)", () => {
    const { wrapper } = setup();
    expect(wrapper.findAll('[data-test^="assistant-launcher-starter-"]')).toHaveLength(3);
    expect(wrapper.findAll("h3").map((heading) => heading.text())).toEqual(["Recent threads"]);
  });

  it("shows skeleton rows while the starters load, and keeps the field typable unless the gate loads", () => {
    loading.value = true;
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-launcher-loading"]').exists()).toBe(true);
    expect(input(wrapper).attributes("disabled")).toBeUndefined();
    const gated = setup("loading");
    expect(input(gated.wrapper).attributes("disabled")).toBeDefined();
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

  describe("Attach Image", () => {
    const png = (name: string, size = 10) =>
      new File([new Uint8Array(size)], name, { type: "image/png" });
    const pick = (wrapper: ReturnType<typeof setup>["wrapper"], files: File[]) =>
      wrapper.findComponent(OFile).vm.$emit("change", files);
    const thumbs = (wrapper: ReturnType<typeof setup>["wrapper"]) =>
      wrapper.findAll('[data-test="assistant-launcher-image-chip"]');

    beforeEach(() => toastCall.mockReset());

    it("opens the picker from + and shows the pick as a removable thumbnail chip in a row above the field", async () => {
      const click = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(() => undefined);
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      plus(wrapper, "attach");
      expect(click).toHaveBeenCalled();
      click.mockRestore();
      pick(wrapper, [png("shot.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(1));
      const left = wrapper.get('[data-test="assistant-composer-bar-left"]');
      const row = wrapper.get('[data-test="assistant-launcher-chip-row"]');
      expect(left.find('[data-test="assistant-launcher-chips"]').exists()).toBe(false);
      expect(row.element.compareDocumentPosition(wrapper.get("textarea").element)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const chip = row.get('[data-test="assistant-launcher-image-chip"]');
      expect(chip.text()).toBe("shot.png");
      expect(chip.get('[data-test="assistant-context-chip-thumb"]').attributes("src")).toBe(
        "data:image/png;base64,AAAAAAAAAAAAAA==",
      );
      expect(wrapper.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
      await chip.get('[data-test="assistant-context-chip-remove"]').trigger("click");
      expect(thumbs(wrapper)).toHaveLength(0);
    });

    it("hands the images to the new chat with the line on Enter and on Shift+Enter, and sends images alone", async () => {
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      pick(wrapper, [png("a.png"), png("b.png", 20)]);
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="assistant-launcher-chips"]').text()).toContain("+1"),
      );
      await input(wrapper).setValue("what is this?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0]).toMatchObject({
        intent: "send",
        payload: { text: "what is this?" },
      });
      expect(open.mock.calls[0][0].payload.images).toEqual([
        expect.objectContaining({
          filename: "a.png",
          mimeType: "image/png",
          size: 10,
          data: "AAAAAAAAAAAAAA==",
        }),
        expect.objectContaining({ filename: "b.png", mimeType: "image/png", size: 20 }),
      ]);
      expect(thumbs(wrapper)).toHaveLength(0);
      pick(wrapper, [png("c.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(1));
      await input(wrapper).setValue("draft");
      await input(wrapper).trigger("keydown", { key: "Enter", shiftKey: true });
      expect(open.mock.calls[1][0]).toMatchObject({
        intent: "stage",
        payload: { text: "draft", images: [expect.objectContaining({ filename: "c.png" })] },
      });
      pick(wrapper, [png("d.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(1));
      expect(
        wrapper.get('[data-test="assistant-launcher-ask"]').attributes("disabled"),
      ).toBeUndefined();
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[2][0].payload).toMatchObject({
        text: "",
        images: [expect.objectContaining({ filename: "d.png" })],
      });
    });

    it("refuses with the composer's lines: a fifth image, a wrong type and an image over the size cap", async () => {
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      pick(
        wrapper,
        ["1", "2", "3", "4", "5"].map((n) => png(`${n}.png`)),
      );
      await vi.waitFor(() => expect(toastCall).toHaveBeenCalledTimes(1));
      expect(toastCall.mock.calls[0][0].message).toMatch(/^5\.png wasn't added\. Up to 4 images/);
      pick(wrapper, [new File([new Uint8Array(4)], "a.gif", { type: "image/gif" })]);
      await vi.waitFor(() => expect(toastCall).toHaveBeenCalledTimes(2));
      expect(toastCall.mock.calls[1][0].message).toBe("Only PNG and JPEG images can be attached");
      wrapper.findComponent(OFile).vm.$emit("size-error", [png("big.png", 3 * 1024 * 1024)]);
      expect(toastCall.mock.calls[2][0].message).toMatch(/^big\.png is .+ Up to 4 images/);
      await input(wrapper).setValue("why?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(
        open.mock.calls[0][0].payload.images.map((i: { filename: string }) => i.filename),
      ).toEqual(["1.png", "2.png", "3.png", "4.png"]);
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

    it("stays visible with the dock open, with no starters or recent chats", async () => {
      const { wrapper, store } = setupOn({ layout: "overview" });
      store.state.shell.placement = { kind: "sidebar" };
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="assistant-launcher-suggestions"]').exists()).toBe(false);
    });

    it("draws the agent chip right after the time chip in both layouts, only with a choice of agents", async () => {
      for (const mountIt of [() => setupOn({ layout: "overview" }), () => setup()]) {
        const { wrapper } = mountIt();
        expect(wrapper.find('[data-test="assistant-launcher-agent"]').exists()).toBe(false);
        fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
        await flushPromises();
        const chips = wrapper
          .get('[data-test="assistant-composer-bar-left"]')
          .findAll('[data-test^="assistant-"]')
          .map((el) => el.attributes("data-test"));
        expect(chips.indexOf("assistant-launcher-agent")).toBe(
          chips.indexOf("assistant-context-chip-time") + 1,
        );
        // The two chips sit a gap apart, as + and the time chip do.
        const agentChip = wrapper.get('[data-test="assistant-launcher-agent"]').element;
        expect(agentChip.parentElement?.classList.contains("gap-2")).toBe(true);
        // Home's chips keep the kit's small radius, not a pill.
        for (const test of ["assistant-launcher-agent", "assistant-context-chip-time"]) {
          const classes = wrapper.get(`[data-test="${test}"]`).classes();
          expect(classes).toContain("rounded-default");
          expect(classes).not.toContain("rounded-full");
        }
        expect(wrapper.html()).not.toContain(":rounded-full");
        expect(wrapper.find('[data-test="assistant-agent-pill"]').exists()).toBe(false);
      }
    });

    it("reads no starters, so their load never holds the field", () => {
      loading.value = true;
      const { wrapper } = setupOn({ layout: "overview" });
      expect(startersRead).not.toHaveBeenCalled();
      expect(wrapper.get('[data-test="assistant-launcher"]').attributes("data-state")).toBe(
        "ready",
      );
      expect(wrapper.find('[data-test="assistant-launcher-loading"]').exists()).toBe(false);
      setup();
      expect(startersRead).toHaveBeenCalledTimes(1);
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

    it("shows no page chip in the Ask box even with alert and incident rows, and Enter still sends the range", async () => {
      contextRegistry.register("home", {
        getContext: () =>
          ({
            ...HOME_PAGE,
            overviewAlerts: [{ id: "a-1", name: "High 5xx", state: "firing" }],
          }) as never,
      });
      contextRegistry.setActive("home");
      const range = { from: 1_000, to: 3_601_000, period: "1h" };
      const { wrapper } = setupOn({ layout: "overview", pageRange: range });
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-launcher-page-chip"]').exists()).toBe(false);
      expect(wrapper.find('[data-state="ghost"]').exists()).toBe(false);
      await input(wrapper).setValue("why?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0].payload).toEqual({
        text: "why?",
        chips: [],
        timeOverride: range,
      });
    });

    it("sends Enter's line, its @ chips and the page range as a new chat in the full view", async () => {
      const chip = {
        id: "mention:stream:logs|checkout",
        kind: "stream",
        label: raw("checkout"),
        ref: { type: "stream", id: "checkout", org: "default", streamType: "logs" },
        sizeBytes: 8,
        provenance: "mention",
        sent: "whitelist",
      };
      mentionPick.current = { id: chip.id, kind: "stream", label: chip.label, chip };
      const range = { from: 1_000, to: 3_601_000, period: "1h" };
      const { wrapper } = setupOn({ layout: "overview", pageRange: range });
      await flushPromises();
      await input(wrapper).setValue("@check");
      await flushPromises();
      await input(wrapper).trigger("keydown", { key: "Enter" });
      await input(wrapper).setValue("why 5xx?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith({
        entryKind: "home_launcher",
        entryVerb: "ask",
        objectKind: "none",
        intent: "send",
        thread: "new",
        container: "full",
        payload: {
          text: "why 5xx?",
          chips: [chip],
          timeOverride: range,
        },
      });
    });

    it("opens no results list or Ask row while typing when the assistant is usable", async () => {
      const { wrapper } = setupOn({ layout: "overview" });
      await flushPromises();
      await input(wrapper).setValue("logs");
      await flushPromises();
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Ask:");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0]).toMatchObject({ payload: { text: "logs" } });
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
