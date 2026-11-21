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
import { fakeVoiceEngine } from "../__tests__/fakeVoice";
import { resetVoiceForTests, setVoiceOptIn } from "../composer/useAssistantVoice";
import AssistantLauncher, { launcherState } from "./AssistantLauncher.vue";
import AssistantLauncherAgent from "./AssistantLauncherAgent.vue";

import brandLocale from "@/locales/languages/en-US.json";

const brandNames = brandLocale.brand;

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

  it("maps gates: skeleton while loading, nothing on G0/G1, the field marked locked on G2", () => {
    expect(launcherState("loading")).toBe("loading");
    expect(launcherState("not_entitled")).toBeNull();
    expect(launcherState("not_configured")).toBeNull();
    expect(launcherState("unhealthy")).toBe("ready");
    expect(setup("not_entitled").wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(
      false,
    );
    const locked = setup("no_permission").wrapper;
    expect(locked.get('[data-test="assistant-launcher"]').attributes("data-state")).toBe("gate");
    expect(locked.find('[data-test="assistant-gate-state"]').exists()).toBe(false);
  });

  it("is one masked field named for the assistant, with no heading, starters or recent chats", () => {
    const { wrapper } = setup();
    const launcher = wrapper.get('[data-test="assistant-launcher"]');
    expect(launcher.attributes("data-dd-privacy")).toBe("mask");
    expect(launcher.attributes("aria-label")).toBe(`Ask ${brandNames.autobot}`);
    expect(launcher.find("h2").exists()).toBe(false);
    expect(input(wrapper).attributes("aria-label")).toBe(`Ask ${brandNames.autobot}`);
    expect(input(wrapper).attributes("maxlength")).toBe("4000");
    expect(wrapper.find('[data-test^="assistant-launcher-starter-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(false);
  });

  it("fills the field with an example prompt and focuses it, sending nothing", async () => {
    const { wrapper } = setupOn({});
    await flushPromises();
    (wrapper.vm as unknown as { fill(prompt: string): void }).fill("Help me write a query");
    await flushPromises();
    expect((input(wrapper).element as HTMLTextAreaElement).value).toBe("Help me write a query");
    expect(document.activeElement).toBe(input(wrapper).element);
    expect(open).not.toHaveBeenCalled();
  });

  it("picks the agent an example is for along with its prompt, when that agent can answer", async () => {
    const { wrapper } = setupOn({});
    fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
    await flushPromises();
    const vm = wrapper.vm as unknown as { fill(prompt: string, agent?: string): void };
    vm.fill("Help me investigate an incident", "sre");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-launcher-agent"]').attributes("data-agent")).toBe(
      "sre",
    );
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0]).toMatchObject({ agent: "sre" });
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
    const { wrapper } = setupOn({});
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

  it("keeps an unmatched @query as text and lists context only in the @ menu", async () => {
    mentionPick.current = null;
    const { wrapper } = setupOn({});
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
    const { wrapper } = setupOn({});
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

  it("sends every line to a fixed agent, whose menu offers no other agent, under the given hint", async () => {
    const { wrapper } = setupOn({
      fixedAgent: "sre",
      askPlaceholder: "Describe what went wrong",
    });
    fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
    await flushPromises();
    const agentChip = wrapper.get('[data-test="assistant-launcher-agent"]');
    expect(agentChip.attributes("data-agent")).toBe("sre");
    expect(agentChip.attributes("data-fixed")).toBeDefined();
    expect(input(wrapper).attributes("placeholder")).toBe("Describe what went wrong");
    for (const line of ["why did checkout fail?", "and now?"]) {
      await input(wrapper).setValue(line);
      await input(wrapper).trigger("keydown", { key: "Enter" });
      await flushPromises();
    }
    expect(open.mock.calls.map((call) => call[0].agent)).toEqual(["sre", "sre"]);
  });

  it("never sends a fixed agent's line to another agent when the org cannot reach it", async () => {
    const { wrapper } = setupOn({ fixedAgent: "sre" });
    fake.current.capability.value = {
      ...fake.current.capability.value,
      agents: [ROSTER[0], { id: "sre", pickable: true, available: false, reason: "disabled" }],
    };
    await flushPromises();
    expect(wrapper.find('[data-agent="sre"]').exists()).toBe(false);
    await input(wrapper).setValue("why?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open).not.toHaveBeenCalled();
    expect(input(wrapper).element.value).toBe("why?");
    expect(wrapper.get('[data-test="assistant-launcher-ask"]').attributes("aria-disabled")).toBe(
      "true",
    );
  });

  it("holds a fixed agent's line when the roster does not list that agent", async () => {
    const { wrapper } = setupOn({ fixedAgent: "sre" });
    fake.current.capability.value = { ...fake.current.capability.value, agents: [ROSTER[0]] };
    await flushPromises();
    await input(wrapper).setValue("why?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open).not.toHaveBeenCalled();
    expect(input(wrapper).element.value).toBe("why?");
  });

  it("keeps a fixed agent's chats on the page with the sidebar open", async () => {
    const { wrapper, store } = setupOn({ fixedAgent: "sre" });
    fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
    store.state.shell.placement = { kind: "sidebar" };
    await flushPromises();
    await input(wrapper).setValue("why?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0]).toMatchObject({ agent: "sre", container: "full" });
  });

  it("keeps a typed line over a starter chip, sending nothing", async () => {
    const { wrapper } = setup();
    await input(wrapper).setValue("half a thought");
    (wrapper.vm as unknown as { send(p: string): void }).send("What can you do?");
    await flushPromises();
    expect(open).not.toHaveBeenCalled();
    expect((input(wrapper).element as HTMLTextAreaElement).value).toBe("half a thought");
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

  it("keeps the text on Escape and draws no clear button in the bar (HOME-03, round 1 X-20)", async () => {
    const { wrapper } = setup();
    await input(wrapper).setValue("keep me");
    (input(wrapper).element as HTMLInputElement).focus();
    await input(wrapper).trigger("keydown", { key: "Escape" });
    expect((input(wrapper).element as HTMLInputElement).value).toBe("keep me");
    expect(document.activeElement).not.toBe(input(wrapper).element);
    expect(wrapper.find('[data-test="assistant-launcher-clear"]').exists()).toBe(false);
  });

  it("draws no time chip and sends no range of its own, so the agent picks the window", async () => {
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-context-chip-time"]').exists()).toBe(false);
    await input(wrapper).setValue("why?");
    await input(wrapper).trigger("keydown", { key: "Enter" });
    expect(open.mock.calls[0][0].payload).not.toHaveProperty("timeOverride");
  });

  it("is the composer everywhere else is: + left, agent mic Send right, 28 px square controls, no (i)", async () => {
    const { wrapper } = setup();
    fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
    await flushPromises();
    const field = wrapper.get('[data-test="assistant-composer-frame"]');
    expect(field.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
    const left = field.get('[data-test="assistant-composer-bar-left"]');
    const ids = (node: typeof left) =>
      node
        .findAll(
          '[data-test="assistant-composer-plus"], [data-test="assistant-context-chip-time"], [data-test="assistant-launcher-agent"], [data-test="assistant-dictate"], [data-test="assistant-launcher-ask"]',
        )
        .map((n) => n.attributes("data-test"));
    expect(ids(left)).toEqual(["assistant-composer-plus"]);
    const right = field.get('[data-test="assistant-composer-bar-right"]');
    expect(ids(right)[0]).toBe("assistant-launcher-agent");
    expect(ids(right).at(-1)).toBe("assistant-launcher-ask");
    expect(wrapper.findComponent(AssistantComposerPlusMenu).props("actions")).toEqual([
      "attach",
      "connectors",
    ]);
    const ask = right.get('[data-test="assistant-launcher-ask"]');
    expect(ask.classes()).not.toContain("rounded-full");
    expect(ask.classes()).toEqual(
      expect.arrayContaining([
        "aria-disabled:bg-surface-subtle!",
        "aria-disabled:text-text-secondary!",
      ]),
    );
    expect(left.get('[data-test="assistant-composer-plus"]').attributes("data-size")).toBe("sm");
    expect(ask.attributes("data-size")).toBe("sm");
    expect(wrapper.find('[data-test="assistant-composer-corner"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-context-sees"]').exists()).toBe(false);
  });

  it("gives Home's field the same plain frame as every other composer", async () => {
    const { wrapper } = setupOn({});
    const home = wrapper.get('[data-test="assistant-composer-frame"] > div').classes();
    expect(home).toContain("[&>div]:focus-within:ring-1");
    expect(home.some((c) => /glow|gradient|shadow/.test(c))).toBe(false);
    expect(
      wrapper
        .get('[data-test="assistant-composer-bar"]')
        .classes()
        .some((c) => c.startsWith("border")),
    ).toBe(false);
    expect(input(wrapper).classes()).toContain("placeholder:text-text-secondary");
  });

  it("shows one plain hint that never types itself", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper } = setupOn({});
      const shown = () => input(wrapper).attributes("placeholder") ?? "";
      expect(shown()).toBe("Ask anything · @ to add context");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(shown()).toBe("Ask anything · @ to add context");
      expect(input(wrapper).attributes("aria-label")).toBe(`Ask ${brandNames.autobot}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns Ask on only with text or an image, and says why it is off while it stays reachable", async () => {
    const { wrapper } = setup();
    const ask = () => wrapper.get('[data-test="assistant-launcher-ask"]');
    expect(ask().attributes("disabled")).toBeUndefined();
    expect(ask().attributes("aria-disabled")).toBe("true");
    const reason = wrapper.get(`[id="${ask().attributes("aria-describedby")}"]`);
    expect(reason.text()).toBe("Type a question or attach an image to ask");
    await input(wrapper).setValue("why?");
    expect(ask().attributes("aria-disabled")).toBeUndefined();
  });

  it("does nothing on an empty Enter on Home but say why, and keeps Home's URL", async () => {
    const { wrapper, router } = setupOn({});
    await router.replace({ name: "home", query: { period: "7d" } });
    await flushPromises();
    await input(wrapper).trigger("keydown", { key: "Enter" });
    await input(wrapper).trigger("keydown", { key: "Enter", shiftKey: true });
    await flushPromises();
    expect(open).not.toHaveBeenCalled();
    expect(router.currentRoute.value).toMatchObject({ name: "home", query: { period: "7d" } });
    expect(wrapper.get('[data-test="assistant-launcher-status"]').text()).toBe(
      "Type a question or attach an image to ask",
    );
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
      const { wrapper } = setupOn({});
      await flushPromises();
      plus(wrapper, "attach");
      expect(click).toHaveBeenCalled();
      click.mockRestore();
      pick(wrapper, [png("shot.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(1));
      const left = wrapper.get('[data-test="assistant-composer-bar-left"]');
      const row = wrapper.get('[data-test="assistant-launcher-chip-row"]');
      const frame = wrapper.get('[data-test="assistant-composer-frame"]');
      expect(left.find('[data-test="assistant-launcher-chips"]').exists()).toBe(false);
      // The photo sits inside the box it rides with, above the text.
      expect(frame.element.contains(row.element)).toBe(true);
      expect(row.classes()).not.toContain("absolute");
      expect(row.element.compareDocumentPosition(wrapper.get("textarea").element)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const chip = row.get('[data-test="assistant-launcher-image-chip"]');
      expect(chip.text()).toBe("shot.png");
      const thumb = chip.get('[data-test="assistant-context-chip-thumb"]');
      expect(thumb.attributes("src")).toBe("data:image/png;base64,AAAAAAAAAAAAAA==");
      expect(thumb.classes()).toContain("rounded-default");
      expect(wrapper.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
      await chip.get('[data-test="assistant-context-chip-remove"]').trigger("click");
      expect(thumbs(wrapper)).toHaveLength(0);
    });

    it("moves focus to the next chip, then to the box, as chips are removed, and says each removal", async () => {
      const { wrapper } = setupOn({});
      await flushPromises();
      pick(wrapper, [png("a.png"), png("b.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(2));
      const status = () => wrapper.get('[data-test="assistant-launcher-status"]');
      expect(status().attributes("role")).toBe("status");
      await thumbs(wrapper)[0].get('[data-test="assistant-context-chip-remove"]').trigger("click");
      await flushPromises();
      expect(thumbs(wrapper)).toHaveLength(1);
      expect(document.activeElement).toBe(
        thumbs(wrapper)[0].get('[data-test="assistant-context-chip-button"]').element,
      );
      expect(status().text()).toBe("a.png removed from context");
      await thumbs(wrapper)[0].get('[data-test="assistant-context-chip-remove"]').trigger("click");
      await flushPromises();
      expect(document.activeElement).toBe(input(wrapper).element);
      expect(status().text()).toBe("b.png removed from context");
    });

    it("hands the images to the new chat with the line on Enter, and sends images alone", async () => {
      const { wrapper } = setupOn({});
      await flushPromises();
      pick(wrapper, [png("a.png"), png("b.png", 20)]);
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="assistant-launcher-chips"]').text()).toContain("b.png"),
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
      pick(wrapper, [png("d.png")]);
      await vi.waitFor(() => expect(thumbs(wrapper)).toHaveLength(1));
      expect(
        wrapper.get('[data-test="assistant-launcher-ask"]').attributes("aria-disabled"),
      ).toBeUndefined();
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[1][0].payload).toMatchObject({
        text: "",
        images: [expect.objectContaining({ filename: "d.png" })],
      });
    });

    it("refuses with the composer's lines: a fifth image, a wrong type and an image over the size cap", async () => {
      const { wrapper } = setupOn({});
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
      const { wrapper, store } = setupOn({});
      store.state.shell.placement = { kind: "sidebar" };
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-launcher"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="assistant-launcher-your-chats"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="assistant-launcher-suggestions"]').exists()).toBe(false);
    });

    it("draws the agent first on the right, as quiet text with no box", async () => {
      const { wrapper } = setupOn({});
      fake.current.capability.value = { ...fake.current.capability.value, agents: ROSTER };
      await flushPromises();
      const right = wrapper.get('[data-test="assistant-composer-bar-right"]');
      expect(right.findAll("[data-test]")[0].attributes("data-test")).toBe(
        "assistant-launcher-agent",
      );
      const classes = wrapper.get('[data-test="assistant-launcher-agent"]').classes();
      expect(classes).toContain("text-text-secondary!");
      expect(classes.some((name) => /^(border-(?!0)|bg-surface)/.test(name))).toBe(false);
      expect(wrapper.find('[data-test="assistant-agent-pill"]').exists()).toBe(false);
    });

    it("reads no starters, so their load never holds the field", () => {
      loading.value = true;
      const { wrapper } = setupOn({});
      expect(startersRead).not.toHaveBeenCalled();
      expect(wrapper.get('[data-test="assistant-launcher"]').attributes("data-state")).toBe(
        "ready",
      );
      expect(wrapper.find('[data-test="assistant-launcher-loading"]').exists()).toBe(false);
    });

    it("always starts a new chat, in the dock while it is open", async () => {
      const { wrapper, store } = setupOn({});
      store.state.shell.placement = { kind: "sidebar" };
      await flushPromises();
      await input(wrapper).setValue("why 5xx?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ thread: "new", container: "sidebar", intent: "send" }),
      );
    });

    it("shows no page chip in the Ask box even with alert and incident rows", async () => {
      contextRegistry.register("home", {
        getContext: () =>
          ({
            ...HOME_PAGE,
            overviewAlerts: [{ id: "a-1", name: "High 5xx", state: "firing" }],
          }) as never,
      });
      contextRegistry.setActive("home");
      const { wrapper } = setupOn({});
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-launcher-page-chip"]').exists()).toBe(false);
      expect(wrapper.find('[data-state="ghost"]').exists()).toBe(false);
      await input(wrapper).setValue("why?");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0].payload).toEqual({ text: "why?", chips: [] });
    });

    it("sends Enter's line and its @ chips as a new chat in the full view", async () => {
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
      const { wrapper } = setupOn({});
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
        payload: { text: "why 5xx?", chips: [chip] },
      });
    });

    it("opens no results list or Ask row while typing when the assistant is usable", async () => {
      const { wrapper } = setupOn({});
      await flushPromises();
      await input(wrapper).setValue("logs");
      await flushPromises();
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Ask:");
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0]).toMatchObject({ payload: { text: "logs" } });
    });

    it("asks on Enter when nothing is arrowed onto", async () => {
      const { wrapper } = setupOn({});
      await flushPromises();
      await input(wrapper).setValue("why is checkout failing");
      await flushPromises();
      await input(wrapper).trigger("keydown", { key: "Enter" });
      expect(open.mock.calls[0][0]).toMatchObject({ payload: { text: "why is checkout failing" } });
    });

    it("answers the ⌘K focus request while it can take a question", async () => {
      expect(requestOverviewFocus()).toBe(false);
      const { wrapper } = setupOn({});
      await flushPromises();
      expect(requestOverviewFocus()).toBe(true);
      expect(document.activeElement).toBe(input(wrapper).element);
      mounted.splice(0).forEach((w) => w.unmount());
      expect(requestOverviewFocus()).toBe(false);
    });

    it("clears and focuses the field once on focus=ask, then drops the key", async () => {
      const { wrapper, router } = setupOn({});
      await router.replace({ name: "home", query: { focus: "ask", row: "incident:7" } });
      await flushPromises();
      expect(document.activeElement).toBe(input(wrapper).element);
      expect(router.currentRoute.value.query).toEqual({ row: "incident:7" });
    });
  });
});

describe("AssistantLauncher: dictation", () => {
  beforeEach(() => {
    open.mockReset().mockResolvedValue({ ok: true, sid: "new-chat" });
    document.body.innerHTML = "";
  });
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    resetVoiceForTests();
  });

  it("has no auto-open switch, keeps the agent while dictating and shows the live block", async () => {
    const engine = fakeVoiceEngine();
    resetVoiceForTests(engine);
    localStorage.setItem("o2.assistant.hints:k1", JSON.stringify({ dictate: true }));
    const { wrapper } = setup();
    setVoiceOptIn("k1", true);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-auto-navigation"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-dictate"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dictate-wave"]').exists()).toBe(false);
    engine.handlers!.onStart();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-launcher-agent"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-dictate-wave"]').text()).toContain("Listening");
    expect(wrapper.get('[data-test="assistant-composer-frame"]').attributes("data-listening")).toBe(
      "",
    );
  });

  it("lets Send take a line that is still only interim dictation, as Enter does", async () => {
    const engine = fakeVoiceEngine();
    resetVoiceForTests(engine);
    localStorage.setItem("o2.assistant.hints:k1", JSON.stringify({ dictate: true }));
    const { wrapper } = setup();
    setVoiceOptIn("k1", true);
    await flushPromises();
    const send = () => wrapper.get('[data-test="assistant-launcher-ask"]');
    expect(send().attributes("aria-disabled")).toBe("true");
    await wrapper.get('[data-test="assistant-dictate"]').trigger("click");
    await flushPromises();
    engine.handlers!.onStart();
    engine.handlers!.onResults([{ index: 0, text: "cart fail", final: false }]);
    await flushPromises();
    expect(send().attributes("aria-disabled")).toBeUndefined();
  });
});
