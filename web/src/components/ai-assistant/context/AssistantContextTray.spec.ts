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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextChip } from "@/composables/assistant";
import {
  refreshPageContext,
  resetAssistantContextForTests,
} from "@/composables/assistant/context/useAssistantContext";
import { contextRegistry } from "@/composables/contextProviders/registry";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { composerUi, noteCap, resetComposerUiForTests } from "../composer/composerUi";
import AssistantContextTray from "./AssistantContextTray.vue";

const { fake, breakpoint } = vi.hoisted(() => ({
  fake: { current: null as any },
  breakpoint: { md: true },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({ mdUp: computed(() => breakpoint.md), lgUp: computed(() => breakpoint.md) }),
  };
});

const LOGS = {
  currentPage: "logs",
  selectedStreams: ["default"],
  streamType: "logs",
  currentSQLQuery: 'SELECT * FROM "default"',
  timeRange: { type: "relative", relativeTimePeriod: "15m", startTime: 1, endTime: 900_000_001 },
  organization_identifier: "default",
};

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  data: { level: "error" },
  sizeBytes: 17,
  provenance: "door",
  sent: "serialized",
};

async function setup(props: Record<string, unknown> = {}) {
  fake.current = fakeAssistant();
  const store = fake.current.store;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  const wrapper = mount(AssistantContextTray, {
    props: { sid, ...props },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  await flushPromises();
  const labels = () =>
    wrapper.findAll('[data-test="assistant-context-chip-button"]').map((b) =>
      b
        .text()
        .replace(/\s*·\s*/g, " · ")
        .trim(),
    );
  return { wrapper, store, sid, labels };
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetComposerUiForTests();
  breakpoint.md = true;
  contextRegistry.register("logs", { getContext: () => LOGS });
  contextRegistry.setActive("logs");
  vi.mocked(trackAssistant).mockClear();
});

afterEach(() => {
  contextRegistry.cleanup();
});

describe("AssistantContextTray", () => {
  it("is a named group: time first, then page chips, then staged chips, then ghosts (`40` §2.1)", async () => {
    const { wrapper, store, sid, labels } = await setup();
    const group = wrapper.get('[data-test="assistant-context-tray"]');
    expect(group.attributes()).toMatchObject({
      role: "group",
      "aria-label": "Context for your next message",
    });
    store.addChip(sid, ROW);
    store.setDraft(sid, { removedPageKeys: ["currentSQLQuery"] });
    await flushPromises();
    expect(labels()).toEqual([
      "Time · last 15 min · page",
      "Stream · default · logs",
      "Log row · cart · 13:57",
      "SQL · default · Add back",
    ]);
  });

  it("removes a page chip into a ghost, announces it and fires the event (CT-01 AC 7)", async () => {
    const { wrapper, store, sid } = await setup();
    const removes = wrapper.findAll('[data-test="assistant-context-chip-remove"]');
    await removes[0].trigger("click");
    await flushPromises();
    expect(store.state.sessions[sid].composer.removedPageKeys).toEqual(["selectedStreams"]);
    expect(composerUi(sid).status?.text).toBe("Stream · default removed from context");
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_changed", {
      action: "remove",
      kind: "stream",
      count: 1,
      bytes: expect.any(Number),
    });
    const ghost = wrapper.findAll('[data-test="assistant-context-chip-button"]').at(-1)!;
    await ghost.trigger("click");
    expect(store.state.sessions[sid].composer.removedPageKeys).toEqual([]);
  });

  it("removes a staged chip with Delete and moves focus to the next chip (CT-08 AC 4)", async () => {
    const { wrapper, store, sid } = await setup();
    store.addChip(sid, ROW);
    store.addChip(sid, { ...ROW, id: "row-2", label: raw("Log row · cart · 13:58") });
    await flushPromises();
    const buttons = () => wrapper.findAll('[data-test="assistant-context-chip-button"]');
    await buttons()[3].trigger("keydown", { key: "Delete" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.chips.map((c: ContextChip) => c.id)).toEqual([
      "row-2",
    ]);
    expect(document.activeElement?.textContent).toContain("13:58");
  });

  it("collapses to Time + 1 + more below md and expands in place (CT-01 AC 9)", async () => {
    breakpoint.md = false;
    const { wrapper, store, sid, labels } = await setup();
    store.addChip(sid, ROW);
    await flushPromises();
    expect(labels()).toHaveLength(2);
    const more = wrapper.get('[data-test="assistant-context-more"]');
    expect(more.text()).toBe("+2");
    expect(more.attributes("aria-expanded")).toBe("false");
    await more.trigger("click");
    expect(labels()).toHaveLength(4);
    expect(wrapper.get('[data-test="assistant-context-more"]').attributes("aria-expanded")).toBe(
      "true",
    );
  });

  it("states a cap under the tray, never as a toast (CT-02 AC 7)", async () => {
    const { wrapper, sid } = await setup();
    noteCap(sid, raw("Up to 20 rows or 32 KB of attached data per message"));
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-context-cap"]').text()).toBe(
      "Up to 20 rows or 32 KB of attached data per message",
    );
  });

  it("offers a fresh chat when a door staged into a recent thread, moving the whole staged payload (`40` §2.4, S8)", async () => {
    const { wrapper, store, sid } = await setup();
    store.setTitle(sid, raw("Checkout 5xx"), "renamed");
    store.state.sessions[sid].messages.push({ role: "user", content: raw("hi") });
    store.state.sessions[sid].turnMeta.startedAt = Date.now();
    store.addChip(sid, ROW);
    store.addImage(sid, { data: "aGk=", mimeType: "image/png", filename: "shot.png", size: 2 });
    store.setDraft(sid, {
      timeOverride: { from: 0, to: 1, period: "7d" },
      removedPageKeys: ["sqlQuery"],
    });
    await wrapper.setProps({ sid: null });
    await wrapper.setProps({ sid });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-context-thread"]').text()).toContain(
      "In: Checkout 5xx",
    );
    await wrapper.get('[data-test="assistant-context-start-new"]').trigger("click");
    const fresh = store.state.shell.activeSid;
    expect(fresh).not.toBe(sid);
    expect(store.state.sessions[fresh].composer.chips.map((c: ContextChip) => c.id)).toEqual([
      "row-1",
    ]);
    expect(store.state.sessions[fresh].composer).toMatchObject({
      timeOverride: { period: "7d" },
      removedPageKeys: ["sqlQuery"],
    });
    expect(store.state.sessions[fresh].composer.images.map((i) => i.filename)).toEqual([
      "shot.png",
    ]);
    expect(store.state.sessions[sid].composer).toMatchObject({
      chips: [],
      images: [],
      timeOverride: null,
      removedPageKeys: [],
    });
  });

  it("has the What the assistant sees trigger at its trailing edge (`40` §3)", async () => {
    const { wrapper } = await setup();
    expect(wrapper.find('[data-test="assistant-context-sees"]').exists()).toBe(true);
  });

  it("never shows images in the tray; the composer strip is their one surface (U1)", async () => {
    const { store, sid, labels } = await setup();
    store.addImage(sid, { data: "aGk=", mimeType: "image/png", filename: "shot.png", size: 2 });
    await flushPromises();
    expect(labels().some((label) => label.includes("shot.png"))).toBe(false);
  });

  it("recounts a log rows chip's label when a row is removed", async () => {
    const { wrapper, store, sid } = await setup();
    store.addChip(sid, {
      ...ROW,
      id: "rows-3",
      label: raw("Log rows · 3 · cart"),
      short: raw("cart"),
      data: [{ a: 1 }, { a: 2 }, { a: 3 }],
      count: 3,
    });
    await flushPromises();
    await wrapper
      .get(
        '[data-test="assistant-context-chip-log_row"] [data-test="assistant-context-chip-button"]',
      )
      .trigger("click");
    await flushPromises();
    (document.body.querySelector('[data-test="assistant-chip-remove-row"]') as HTMLElement).click();
    await flushPromises();
    const chip = store.state.sessions[sid].composer.chips.find((c) => c.id === "rows-3");
    expect(String(chip?.label)).toBe("Log rows · 2 · cart");
  });

  it("returns focus to the chip when its popover closes by Escape, and after Add back (U2)", async () => {
    const { wrapper, store, sid } = await setup();
    store.addChip(sid, ROW);
    await flushPromises();
    const rowChip = () =>
      wrapper.get(
        '[data-test="assistant-context-chip-log_row"] [data-test="assistant-context-chip-button"]',
      );
    expect(rowChip().attributes()).toMatchObject({
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    });
    await rowChip().trigger("click");
    await flushPromises();
    expect(rowChip().attributes("aria-expanded")).toBe("true");
    const popover = document.body.querySelector('[data-test="assistant-chip-popover"]')!;
    expect(popover.contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(document.activeElement).toBe(rowChip().element);
    await wrapper.findAll('[data-test="assistant-context-chip-remove"]')[0].trigger("click");
    await flushPromises();
    const ghost = wrapper.findAll('[data-test="assistant-context-chip-button"]').at(-1)!;
    expect(ghost.attributes("aria-haspopup")).toBeUndefined();
    await ghost.trigger("click");
    await flushPromises();
    expect(document.activeElement?.textContent).toContain("Stream · default");
  });

  it("keeps the phone tray to one row: the icon names the kind, the full name stays accessible, names wrap, Fewer chips only when it hides something (U4, U13, V5)", async () => {
    breakpoint.md = false;
    const { wrapper, store, sid, labels } = await setup();
    expect(labels()).toEqual(["15 min", "default"]);
    const buttons = wrapper.findAll('[data-test="assistant-context-chip-button"]');
    expect(buttons[0].attributes("aria-label")).toContain("Time · 15 min");
    expect(buttons[1].attributes("aria-label")).toContain("default");
    expect(
      wrapper.find('[data-test="assistant-context-chip-stream"] .whitespace-normal').exists(),
    ).toBe(true);
    store.setDraft(sid, { removedPageKeys: ["currentSQLQuery", "selectedStreams"] });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-context-more"]').text()).toBe("+2");
    store.setDraft(sid, { removedPageKeys: [] });
    store.addChip(sid, ROW);
    await flushPromises();
    const more = wrapper.get('[data-test="assistant-context-more"]');
    expect(more.classes()).toContain("pointer-coarse:min-w-11");
    await more.trigger("click");
    const fewer = wrapper.get('[data-test="assistant-context-more"]');
    expect(fewer.text()).toBe("Fewer chips");
    expect(fewer.attributes("aria-label")).toBe("Show fewer context chips");
  });

  it("shows below md a name that sits inside the chip's name, never an id or the query (F12)", async () => {
    breakpoint.md = false;
    const { wrapper, store, sid } = await setup();
    const mention = (kind: ContextChip["kind"], id: string, label: string, short: string) =>
      store.addChip(sid, {
        id: `mention:${kind}:${id}`,
        kind,
        label: raw(label),
        short: raw(short),
        ref: { type: kind, id, org: "default" },
        sizeBytes: 1,
        provenance: "mention",
        sent: "whitelist",
      });
    mention("alert", "a1", "Alert · checkout-latency", "checkout-latency");
    mention("panel", "d1", "Dashboard · Checkout", "Checkout");
    store.addChip(sid, ROW);
    await flushPromises();
    await wrapper.get('[data-test="assistant-context-more"]').trigger("click");
    const shown = wrapper.findAll('[data-test="assistant-context-chip-button"]').map((button) => ({
      text: button.text().trim(),
      name: button.attributes("aria-label") ?? "",
    }));
    expect(shown.map((chip) => chip.text)).toEqual([
      "15 min",
      "default",
      "default",
      "checkout-latency",
      "Checkout",
      "Log row · cart · 13:57",
    ]);
    for (const chip of shown) expect(chip.name).toContain(chip.text);
    expect(shown.some((chip) => /SELECT|\ba1\b|\bd1\b/.test(chip.text))).toBe(false);
  });

  it("never announces the page filling in its own fields as it loads, only later changes (CT-01 AC 12)", async () => {
    resetAssistantContextForTests();
    let page: Record<string, unknown> = { ...LOGS, selectedStreams: [] };
    contextRegistry.register("logs", { getContext: () => page });
    const now = vi.spyOn(Date, "now");
    try {
      const start = 1_800_000_000_000;
      now.mockReturnValue(start);
      const { sid } = await setup();
      page = { ...LOGS };
      refreshPageContext();
      await flushPromises();
      expect(composerUi(sid).status).toBeNull();
      now.mockReturnValue(start + 3_500);
      page = { ...LOGS, selectedStreams: ["default"], currentVRLQuery: ".x = 1" };
      refreshPageContext();
      await flushPromises();
      expect(String(composerUi(sid).status?.text)).toBe("VRL · 1 line added to context");
    } finally {
      now.mockRestore();
    }
  });

  describe("Run analysis on an incident chip", () => {
    const incidentChip = (org: string): ContextChip => ({
      id: "door:incident:1",
      kind: "incident",
      label: raw("Incident · Checkout errors"),
      ref: { type: "incident", id: "inc-1", org },
      sizeBytes: 40,
      provenance: "door",
      sent: "serialized",
    });
    const openPopover = async (wrapper: Awaited<ReturnType<typeof setup>>["wrapper"]) => {
      await wrapper
        .get(
          '[data-test="assistant-context-chip-incident"] [data-test="assistant-context-chip-button"]',
        )
        .trigger("click");
      await flushPromises();
      return document.body.querySelector<HTMLElement>('[data-test="assistant-chip-open-source"]');
    };

    it("opens the incident on its Incident Analysis tab through the navigation applier", async () => {
      const { wrapper, store, sid } = await setup();
      const dispatch = vi.spyOn(store, "dispatch").mockResolvedValue({ ok: true });
      store.addChip(sid, incidentChip("default"));
      await flushPromises();
      const action = await openPopover(wrapper);
      expect(action?.textContent).toContain("Run analysis");
      action!.click();
      await flushPromises();
      expect(dispatch).toHaveBeenCalledWith(sid, {
        kind: "navigate",
        target: {
          name: "incidentDetail",
          params: { id: "inc-1" },
          query: { tab: "incidentAnalysis" },
        },
        label: "Run analysis",
      });
    });

    it("offers no Run analysis on that incident's own page", async () => {
      fake.current = fakeAssistant();
      const store = fake.current.store;
      const sid = store.createSession({
        origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      });
      const router = fakeRouter([
        { path: "/incidents/:id", name: "incidentDetail", component: { render: () => null } },
      ]);
      await router.push("/incidents/inc-1");
      const wrapper = mount(AssistantContextTray, {
        props: { sid },
        global: { plugins: [router, fakeVuex()] },
        attachTo: document.body,
      });
      store.addChip(sid, incidentChip("default"));
      await flushPromises();
      expect(await openPopover(wrapper)).toBeNull();
    });

    it("refuses a chip from another org instead of opening it under this one", async () => {
      const { wrapper, store, sid } = await setup();
      const dispatch = vi.spyOn(store, "dispatch").mockResolvedValue({ ok: true });
      store.addChip(sid, incidentChip("other-org"));
      await flushPromises();
      (await openPopover(wrapper))!.click();
      await flushPromises();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
