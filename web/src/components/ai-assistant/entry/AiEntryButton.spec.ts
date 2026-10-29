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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import type {
  AssistantCapability,
  ContextChip,
  GateCode,
  OpenAssistantArgs,
} from "@/composables/assistant";
import { byteSize } from "@/composables/assistant/context/contextChips";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AiEntryButton, {
  AI_ENTRY_DOORS,
  BUILD_ERROR_MS,
  EMPTY_STATE_THREAD_MS,
  type AiEntryButtonProps,
} from "./AiEntryButton.vue";

const { fake, openAssistant, track, toast, locale } = vi.hoisted(() => ({
  fake: { current: null as any },
  openAssistant: vi.fn(),
  track: vi.fn(),
  toast: vi.fn(),
  locale: { value: "en-US" },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  openAssistant,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast,
}));
vi.mock("@/utils/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/formatters")>()),
  uiIntlLocale: () => locale.value,
}));
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DropdownMenuPortal: actual.DropdownMenuContent };
});

// Renders a tooltip's content in place, so a spec reads every line without hovering.
const TooltipStub = defineComponent({
  props: { content: { type: String, default: undefined } },
  setup(props, { slots }) {
    return () => h("span", { "data-test": "tooltip" }, slots.content?.() ?? props.content);
  },
});

const row = (id = "r1"): ContextChip => ({
  id: `door:log_row:${id}`,
  kind: "log_row",
  label: raw(`Log row · default · ${id}`),
  ref: { type: "log_row", org: "default" },
  data: { id },
  sizeBytes: 10,
  provenance: "door",
  sent: "serialized",
});

const payload = (chips: ContextChip[] = [row()]): OpenAssistantArgs["payload"] => ({
  chips,
  text: "Explain this log row",
  title: raw("Log row"),
});

const explain: AiEntryButtonProps = {
  verb: "explain",
  entryKind: "object_verb",
  objectKind: "log_row",
  build: () => payload(),
  tooltip: raw("Sends this row and asks the assistant to explain it"),
  dataTest: "ai-entry-log-row-explain",
};

const add: AiEntryButtonProps = {
  ...explain,
  verb: "add_to_chat",
  build: () => payload(),
  tooltip: raw("Attaches this to the open chat without sending"),
  dataTest: "ai-entry-log-row-add",
};

function setup(
  props: Partial<AiEntryButtonProps> = {},
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
) {
  fake.current = fakeAssistant(gate, over);
  const router = fakeRouter();
  const wrapper = mount(AiEntryButton, {
    props: { ...explain, ...props },
    global: { plugins: [router, fakeVuex()], stubs: { OTooltip: TooltipStub } },
    attachTo: document.body,
  });
  return { wrapper, store: fake.current.store, capability: fake.current.capability, router };
}

function openSession(store: any): string {
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "none" });
  return sid;
}

const door = (wrapper: any, id = "ai-entry-log-row-explain") => wrapper.find(`[data-test="${id}"]`);
const tooltipText = (wrapper: any) =>
  wrapper
    .findAll('[data-test="tooltip"]')
    .map((t: any) => t.text())
    .join(" | ");
const lastCall = () => openAssistant.mock.calls.at(-1)?.[0];

beforeEach(() => {
  locale.value = "en-US";
  openAssistant.mockImplementation(async () => ({
    ok: true,
    sid: "s1",
    container: "sidebar",
    staged: 1,
    sent: true,
    queued: false,
  }));
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  openAssistant.mockReset();
  track.mockClear();
  toast.mockClear();
  vi.useRealTimers();
});

describe("AiEntryButton gate table (`60` §3.7)", () => {
  it.each(["loading", "not_entitled", "not_configured"] as GateCode[])(
    "renders nothing, no wrapper and no reserved width, on %s",
    (gate) => {
      const { wrapper } = setup({}, gate);
      expect(wrapper.find("[data-test]").exists()).toBe(false);
      expect(wrapper.element.textContent ?? "").toBe("");
    },
  );

  it.each(["available", "unhealthy"] as GateCode[])("is a normal door on %s", async (gate) => {
    const { wrapper } = setup({}, gate);
    expect(door(wrapper).attributes("aria-disabled")).toBeUndefined();
    expect(door(wrapper).attributes("data-door-state")).toBe("ready");
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(1);
  });

  it.each(["no_permission", "off_for_org"] as GateCode[])(
    "is locked and focusable on %s, opens the gate popover and counts the click, nothing else",
    async (gate) => {
      const { wrapper } = setup({}, gate);
      const el = door(wrapper);
      expect(el.attributes("aria-disabled")).toBe("true");
      expect(el.attributes("disabled")).toBeUndefined();
      expect(el.attributes("aria-label")).toBe("Explain, locked: ask an admin for AI access");
      expect(el.attributes("data-door-state")).toBe("locked");
      await el.trigger("click");
      await flushPromises();
      expect(openAssistant).not.toHaveBeenCalled();
      expect(
        document.body.querySelector('[data-test="assistant-gate-state"][data-size="popover"]'),
      ).not.toBeNull();
      expect(track).toHaveBeenCalledWith("ai_entry_clicked", {
        entry_kind: "object_verb",
        entry_verb: "explain",
        object_kind: "log_row",
        sends: false,
        gate,
        queued: false,
      });
    },
  );

  it("names the locked reason in the tooltip", () => {
    expect(tooltipText(setup({}, "no_permission").wrapper)).toBe("Ask an admin for AI access");
    expect(tooltipText(setup({}, "off_for_org").wrapper)).toBe(
      "O2 Assistant is turned off for this organization",
    );
  });
});

describe("AiEntryButton appearances", () => {
  it("button: ghost OButton with the verb label and the accent glyph", () => {
    const { wrapper } = setup();
    expect(door(wrapper).text()).toContain("Explain");
    expect(door(wrapper).find("svg, [class*='text-ai-accent']").exists()).toBe(true);
    expect(door(wrapper).find("img").exists()).toBe(false);
  });

  it("chip: shows the tooltip as the secondary line for touch (DG-09 AC 10)", () => {
    const { wrapper } = setup({ appearance: "chip" });
    expect(wrapper.find('[data-test="ai-entry-secondary"]').text()).toBe(
      "Sends this row and asks the assistant to explain it",
    );
  });

  it("toolbar-icon: icon-only with the label as its accessible name", () => {
    const { wrapper } = setup({ appearance: "toolbar-icon", label: raw("Explain this log row") });
    expect(door(wrapper).attributes("aria-label")).toBe("Explain this log row");
    expect(door(wrapper).text()).toBe("Sends this row and asks the assistant to explain it");
  });

  it("toggle: outline with aria-pressed, never fainter when pressed", () => {
    const { wrapper } = setup({ appearance: "toggle", verb: "ask", pressed: true });
    expect(door(wrapper).attributes("aria-pressed")).toBe("true");
    expect(door(wrapper).classes()).toContain("border-border-strong");
  });

  it("menu-item: an ODropdownItem that opens the assistant on select", async () => {
    fake.current = fakeAssistant("available");
    const wrapper = mount(ODropdown, {
      props: { open: true },
      slots: {
        trigger: () => h("button", "menu"),
        default: () => h(AiEntryButton, { ...explain, appearance: "menu-item" }),
      },
      global: { plugins: [fakeRouter(), fakeVuex()], stubs: { OTooltip: TooltipStub } },
      attachTo: document.body,
    });
    const item = document.body.querySelector<HTMLElement>('[data-test="ai-entry-log-row-explain"]');
    expect(item?.getAttribute("role")).toBe("menuitem");
    item?.click();
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("labels a multi-select door with the count plural", () => {
    const { wrapper } = setup({ count: 3, dataTest: "ai-entry-log-rows-explain" });
    expect(door(wrapper, "ai-entry-log-rows-explain").text()).toContain("Explain these 3 rows");
  });

  it("takes no class or style from its host: size is the only sizing prop (U17)", () => {
    fake.current = fakeAssistant("available");
    const wrapper = mount(AiEntryButton, {
      props: explain,
      attrs: { class: "w-96", style: "color: red" },
      global: { plugins: [fakeRouter(), fakeVuex()], stubs: { OTooltip: TooltipStub } },
    });
    expect(door(wrapper).classes()).not.toContain("w-96");
    expect(door(wrapper).attributes("style") ?? "").not.toContain("red");
  });

  it("accepts objectKind incident for the sibling-agents door (DG-08 AC 7)", () => {
    const { wrapper } = setup({ objectKind: "incident", verb: "ask" });
    expect(door(wrapper).exists()).toBe(true);
  });
});

describe("AiEntryButton tooltip", () => {
  it("adds the cost line only when metered", () => {
    expect(tooltipText(setup({}, "available", { creditMode: "pay_as_you_go" }).wrapper)).toContain(
      "Uses 1 credit",
    );
    expect(
      tooltipText(setup({}, "available", { creditMode: "consent_required" }).wrapper),
    ).toContain("Uses 1 credit");
    expect(tooltipText(setup({}, "available", { creditMode: "free" }).wrapper)).not.toContain(
      "credit",
    );
    expect(tooltipText(setup().wrapper)).not.toContain("credit");
    expect(
      tooltipText(setup({ ...add }, "available", { creditMode: "pay_as_you_go" }).wrapper),
    ).not.toContain("credit");
  });

  it("says the request is sent in English when the UI is not", () => {
    locale.value = "de-DE";
    expect(tooltipText(setup().wrapper)).toContain("The request is sent in English.");
  });

  it("says a send will queue while the open chat runs, and goes to that chat", async () => {
    const { wrapper, store } = setup();
    const sid = openSession(store);
    store.state.sessions[sid].turn = { state: "responding.writing" };
    await flushPromises();
    expect(tooltipText(wrapper)).toContain(
      "Added to the chat. Send it when the current answer finishes.",
    );
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(lastCall()).toMatchObject({ intent: "send", thread: "current" });
  });

  it("says a send joins the draft in the open chat, and goes to that chat (round 1 X-06)", async () => {
    const { wrapper, store } = setup();
    const sid = openSession(store);
    store.setDraft(sid, { text: "half a thought" });
    await flushPromises();
    expect(tooltipText(wrapper)).toContain("Added to your message. Press Send when ready.");
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(lastCall()).toMatchObject({ intent: "send", thread: "current" });
  });
});

describe("AiEntryButton activation", () => {
  it("sends Explain into a new thread with the payload, the invoker and the user+org key", async () => {
    const { wrapper } = setup();
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(lastCall()).toMatchObject({
      entryKind: "object_verb",
      entryVerb: "explain",
      objectKind: "log_row",
      intent: "send",
      thread: "new",
      userOrgKey: "k1",
      payload: payload(),
    });
    expect(lastCall().invoker).toBe(door(wrapper).element);
    expect(wrapper.emitted("opened")?.[0]?.[0]).toMatchObject({ ok: true });
  });

  it("stages Add to chat into the current thread, and toasts Open only when no container shows", async () => {
    openAssistant.mockImplementation(async () => ({
      ok: true,
      sid: "s1",
      container: "sidebar",
      staged: 1,
      sent: false,
      queued: false,
    }));
    const { wrapper } = setup({ ...add });
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(lastCall()).toMatchObject({
      intent: "stage",
      entryVerb: "add_to_chat",
      thread: "current",
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Added to chat",
        action: expect.objectContaining({ label: "Open" }),
      }),
    );
  });

  it("stages only the chips on Add: the Explain prompt and title never reach the open chat (`40` §4)", async () => {
    const { wrapper } = setup({ ...add });
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(lastCall().payload).toEqual({ chips: [row()] });
  });

  it("stages the user's own text on Add when the door has no chip (function test query)", async () => {
    const { wrapper } = setup({ ...add, build: () => ({ chips: [], text: "SELECT 1" }) });
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(lastCall()).toMatchObject({ intent: "stage", payload: { chips: [], text: "SELECT 1" } });
  });

  it("is focusable but inert with its reason over the multi-select cap", async () => {
    const { wrapper } = setup({
      count: 21,
      disabledReason: raw("Select up to 20 rows to explain at once"),
    });
    expect(door(wrapper).attributes("aria-disabled")).toBe("true");
    expect(tooltipText(wrapper)).toBe("Select up to 20 rows to explain at once");
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).not.toHaveBeenCalled();
  });

  it("shows Couldn't prepare this request for 4 s when build throws, and reports error", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup({
      build: () => {
        throw new Error("boom");
      },
    });
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).not.toHaveBeenCalled();
    const bubbles = () => [...document.body.querySelectorAll('[data-test="tooltip"]')];
    expect(bubbles().at(-1)?.textContent).toBe("Couldn't prepare this request");
    expect(track).toHaveBeenCalledWith(
      "ai_entry_clicked",
      expect.objectContaining({ sends: false, gate: "available", error: true }),
    );
    vi.advanceTimersByTime(BUILD_ERROR_MS);
    await flushPromises();
    expect(bubbles().map((b) => b.textContent)).not.toContain("Couldn't prepare this request");
  });

  it("refuses a payload over the chip cap the same way", async () => {
    const big = { ...row(), sizeBytes: 64 * 1024 };
    const { wrapper } = setup({ build: () => payload([big]) });
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "ai_entry_clicked",
      expect.objectContaining({ error: true }),
    );
  });

  it("fits a near-cap row and its query chip under the cap instead of refusing", async () => {
    const sized = (chip: ContextChip, data: unknown): ContextChip => ({
      ...chip,
      data,
      sizeBytes: byteSize(data),
    });
    const big = sized(row("big"), { message: "x".repeat(32 * 1024 - 40) });
    const query = sized(
      { ...row("q"), id: "door:query:q", kind: "query" },
      { query: "y".repeat(2000) },
    );
    const { wrapper } = setup({ build: () => payload([big, query]) });
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(1);
    const sent = openAssistant.mock.calls[0][0].payload.chips as ContextChip[];
    expect(sent.reduce((sum, chip) => sum + chip.sizeBytes, 0)).toBeLessThanOrEqual(32 * 1024);
    expect(sent[0].truncated?.length).toBeGreaterThan(0);
    expect(sent[1]).toEqual(query);
  });

  it("keeps an empty-state door in the chat it opened from this route for 10 minutes (DG-09 AC 9)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { wrapper, store } = setup({
      entryKind: "empty_state",
      dataTest: "ai-entry-empty-result-troubleshoot",
    });
    const sid = openSession(store);
    openAssistant.mockImplementation(async () => ({
      ok: true,
      sid,
      container: "sidebar",
      staged: 0,
      sent: true,
      queued: false,
    }));
    const el = door(wrapper, "ai-entry-empty-result-troubleshoot");
    await el.trigger("click");
    await flushPromises();
    expect(lastCall().thread).toBe("new");
    await el.trigger("click");
    await flushPromises();
    expect(lastCall().thread).toBe("current");
    vi.setSystemTime(Date.now() + EMPTY_STATE_THREAD_MS + 1);
    await el.trigger("click");
    await flushPromises();
    expect(lastCall().thread).toBe("new");
  });
});

describe("AiEntryButton In chat tick (DG-07 AC 6, 12, 13)", () => {
  function stagingOpen(store: any, sid: string) {
    openAssistant.mockImplementation(async (args: any) => {
      store.stage(sid, { chips: args.payload.chips });
      return { ok: true, sid, container: "sidebar", staged: 1, sent: false, queued: false };
    });
  }

  it("ticks from the session's chips, reverts when the chip is removed, and never removes on a second press", async () => {
    const { wrapper, store } = setup({ ...add });
    const sid = openSession(store);
    stagingOpen(store, sid);
    const el = () => door(wrapper, "ai-entry-log-row-add");
    await el().trigger("click");
    await flushPromises();
    expect(el().text()).toContain("In chat");
    expect(el().attributes("data-door-state")).toBe("added");
    expect(el().attributes("aria-label")).toBe("In chat");
    await el().trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(1);
    expect(store.state.sessions[sid].composer.chips).toHaveLength(1);
    store.removeChip(sid, row().id);
    await flushPromises();
    expect(el().text()).toContain("Add to chat");
  });

  it("shows the tick after a remount for the same object, without building again (S7)", async () => {
    const build = vi.fn(() => payload());
    const first = setup({ ...add, build, objectKey: "r1" });
    const sid = openSession(first.store);
    stagingOpen(first.store, sid);
    await door(first.wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    first.wrapper.unmount();
    const wrapper = mount(AiEntryButton, {
      props: { ...add, build, objectKey: "r1" },
      global: { plugins: [fakeRouter(), fakeVuex()], stubs: { OTooltip: TooltipStub } },
    });
    await flushPromises();
    expect(door(wrapper, "ai-entry-log-row-add").text()).toContain("In chat");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("drops the tick when the door moves to another object, so the next record can be added (F5)", async () => {
    const { wrapper, store } = setup({ ...add, objectKey: "rec-1" });
    const sid = openSession(store);
    stagingOpen(store, sid);
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(door(wrapper, "ai-entry-log-row-add").text()).toContain("In chat");
    await wrapper.setProps({ objectKey: "rec-2", build: () => payload([row("r2")]) });
    expect(door(wrapper, "ai-entry-log-row-add").text()).toContain("Add to chat");
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(2);
    expect(store.state.sessions[sid].composer.chips).toHaveLength(2);
  });

  it("lets the host decide with `added`", () => {
    const { wrapper } = setup({ ...add, added: true });
    expect(door(wrapper, "ai-entry-log-row-add").text()).toContain("In chat");
  });
});

describe("AiEntryButton round 2", () => {
  it("activates a send door once while the first activation is still in flight (U5)", async () => {
    let release: (v: unknown) => void = () => undefined;
    openAssistant.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { wrapper } = setup();
    await door(wrapper).trigger("click");
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledTimes(1);
    release({ ok: true, sid: "s1", container: "sidebar", staged: 1, sent: true, queued: false });
    await flushPromises();
  });

  it("sends the user+org key the door was loaded under, so a stale page is refused (S3)", async () => {
    const { wrapper, store } = setup();
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(lastCall().userOrgKey).toBe("k1");
  });

  it("sends the new org's key once its host rebinds after an org switch (W4)", async () => {
    const { wrapper, store } = setup({ boundOrg: "default" });
    const vuex = (wrapper.vm as unknown as { $store: { state: Record<string, unknown> } }).$store;
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    vuex.state.selectedOrganization = { identifier: "other", label: "other" };
    await flushPromises();
    await wrapper.setProps({ boundOrg: "other" });
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(lastCall().userOrgKey).toBe("k2");
  });

  it("stamps the host's load-time org on the chips, so rows from an earlier org are refused", async () => {
    const { wrapper } = setup({ boundOrg: "org-a" });
    await door(wrapper).trigger("click");
    await flushPromises();
    const call = lastCall();
    expect(
      call.payload.chips.every((c: { ref?: { org?: string } }) => c.ref?.org === "org-a"),
    ).toBe(true);
  });

  it("refuses an Add over the message cap and says so under the tray (S6)", async () => {
    const { wrapper, store } = setup({ ...add });
    const sid = openSession(store);
    store.addChip(sid, { ...row("big"), sizeBytes: 32 * 1024 - 5 });
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(openAssistant).not.toHaveBeenCalled();
    const ui = await import("@/components/ai-assistant/composer/composerUi");
    expect(String(ui.composerUi(sid).cap?.text)).toContain("Not added");
  });

  it("refuses a send door over the cap when it would fall back to staging into a drafted chat", async () => {
    const { wrapper, store } = setup();
    const sid = openSession(store);
    store.setDraft(sid, { text: "half a thought" });
    store.addChip(sid, { ...row("big"), sizeBytes: 32 * 1024 - 5 });
    await flushPromises();
    await door(wrapper).trigger("click");
    await flushPromises();
    expect(openAssistant).not.toHaveBeenCalled();
  });

  it("keeps the verb glyph and adds a lock badge when locked (U7)", () => {
    const explainLocked = setup(
      { appearance: "toolbar-icon", label: raw("Explain this log row") },
      "no_permission",
    ).wrapper;
    const addLocked = setup(
      { ...add, appearance: "toolbar-icon", label: raw("Add log row to chat") },
      "no_permission",
    ).wrapper;
    const svg = (w: any, id: string) =>
      door(w, id)
        .findAll("svg")
        .map((el: any) => el.html())
        .join("");
    expect(svg(explainLocked, "ai-entry-log-row-explain")).not.toBe(
      svg(addLocked, "ai-entry-log-row-add"),
    );
    expect(door(explainLocked, "ai-entry-log-row-explain").findAll("svg").length).toBe(2);
  });

  it("shows every tooltip line as the touch description, cost included (U9)", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q === "(pointer: coarse)",
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { wrapper } = setup({ appearance: "chip" }, "available", { creditMode: "pay_as_you_go" });
    expect(wrapper.find('[data-test="ai-entry-secondary"]').text()).toContain("Uses 1 credit");
    window.matchMedia = matchMedia;
  });

  it("announces the chip count when the container is visible (U6)", async () => {
    const { wrapper, store } = setup({ ...add });
    const sid = openSession(store);
    openAssistant.mockImplementation(async (args: any) => {
      store.stage(sid, { chips: args.payload.chips });
      return { ok: true, sid, container: "sidebar", staged: 1, sent: false, queued: false };
    });
    const ui = await import("@/components/ai-assistant/composer/composerUi");
    await door(wrapper, "ai-entry-log-row-add").trigger("click");
    await flushPromises();
    expect(String(ui.composerUi(sid).status?.text)).toBe("Added to chat, 1 item");
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("door registry (DG-12 AC 1)", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
      return /\.(vue|ts)$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
    });

  it("gives every door a unique id of the form ai-entry-<object>-<verb>", () => {
    const ids = AI_ENTRY_DOORS.map((d) => d.dataTest);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^ai-entry-[a-z-]+-(explain|troubleshoot|add|ask|fix|generate)$/);
  });

  it("registers every ai-entry id used in src, and the id's verb matches its registration", () => {
    const registered = new Map(AI_ENTRY_DOORS.map((d) => [d.dataTest, d]));
    const slug: Record<string, string> = { add_to_chat: "add", generate_query: "generate" };
    for (const d of AI_ENTRY_DOORS)
      expect(d.dataTest.endsWith(`-${slug[d.entryVerb] ?? d.entryVerb}`)).toBe(true);
    const used = new Set<string>();
    for (const file of files(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(
        /data-test="(ai-entry-[a-z-]+)"|dataTest: "(ai-entry-[a-z-]+)"|data-test="(ai-entry-[a-z-]+)-menu"|"(ai-entry-[a-z-]+)" as const/g,
      ))
        used.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
      for (const m of readFileSync(file, "utf8").matchAll(/data-test="ai-entry-([a-z-]+)"/g))
        used.add(`ai-entry-${m[1]}`);
    }
    used.delete("ai-entry-secondary");
    for (const id of used) expect(registered.has(id as never), `${id} in src`).toBe(true);
  });

  it("keeps menu-link-ai-item on the header button and the editor toggles WP-09 replaces (constraint 52)", () => {
    // The four editor toggles become `ai-entry-<host>-ask` in WP-09; this list only shrinks.
    const toggles = [
      "components/alerts/QueryEditorDialog.vue",
      "components/functions/FunctionsToolbar.vue",
      "components/pipeline/PipelineEditor.vue",
      "components/pipeline/NodeForm/Query.vue",
    ];
    const owners = files(SRC)
      .filter((file) => readFileSync(file, "utf8").includes('data-test="menu-link-ai-item"'))
      .map((file) => relative(SRC, file))
      .filter((file) => !toggles.includes(file));
    expect(owners.sort()).toEqual([
      "components/Header.vue",
      "components/ai-assistant/shell/AssistantHeaderButton.vue",
    ]);
  });
});

describe("AiEntryButton editor toggle and hand-off", () => {
  const toggle: Partial<AiEntryButtonProps> = {
    verb: "ask",
    entryKind: "editor_toggle",
    objectKind: "alert",
    appearance: "toggle",
    dockHost: "alert_query",
    thread: "current",
    build: () => ({ chips: [], title: raw("Alert · checkout") }),
    tooltip: raw("Opens the assistant beside this editor"),
    dataTest: "ai-entry-alert-query-ask",
  };

  it("docks through openAssistant while released and closes through its host while pressed", async () => {
    openAssistant.mockResolvedValue({ ok: false, reason: "loading" });
    const released = setup(toggle);
    const button = released.wrapper.get('[data-test="ai-entry-alert-query-ask"]');
    expect(button.attributes("aria-pressed")).toBe("false");
    await button.trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entryKind: "editor_toggle",
        dockHost: "alert_query",
        intent: "open",
      }),
    );
    released.wrapper.unmount();
    openAssistant.mockClear();
    const pressed = setup({ ...toggle, pressed: true });
    await pressed.wrapper.get('[data-test="ai-entry-alert-query-ask"]').trigger("click");
    expect(pressed.wrapper.emitted("closed")).toHaveLength(1);
    expect(openAssistant).not.toHaveBeenCalled();
    pressed.wrapper.unmount();
  });

  it("runs a hand-off door's navigation instead of opening the assistant here", async () => {
    openAssistant.mockClear();
    const handoff = vi.fn();
    const { wrapper } = setup({
      verb: "ask",
      objectKind: "log_field",
      appearance: "button",
      handoff,
      dataTest: "ai-entry-regex-field-ask",
    });
    await wrapper.get('[data-test="ai-entry-regex-field-ask"]').trigger("click");
    await flushPromises();
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(openAssistant).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("refuses a hand-off door that outlived an org switch before it navigates", async () => {
    openAssistant.mockClear();
    const handoff = vi.fn();
    const { wrapper, store } = setup({
      verb: "ask",
      objectKind: "log_field",
      appearance: "button",
      handoff,
      dataTest: "ai-entry-regex-field-ask",
    });
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await wrapper.get('[data-test="ai-entry-regex-field-ask"]').trigger("click");
    await flushPromises();
    expect(handoff).not.toHaveBeenCalled();
    expect(lastCall().userOrgKey).toBe("k1");
    wrapper.unmount();
  });

  it("keeps a locked hand-off door's reason instead of navigating", async () => {
    const handoff = vi.fn();
    const { wrapper } = setup(
      { verb: "ask", appearance: "button", handoff, dataTest: "ai-entry-regex-field-ask" },
      "no_permission",
    );
    await wrapper.get('[data-test="ai-entry-regex-field-ask"]').trigger("click");
    await flushPromises();
    expect(handoff).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
