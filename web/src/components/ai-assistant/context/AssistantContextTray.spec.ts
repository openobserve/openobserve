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
import { contextRegistry } from "@/composables/contextProviders/registry";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { composerUi, resetComposerUiForTests } from "../composer/composerUi";
import AssistantContextTray, { trayChipLimit } from "./AssistantContextTray.vue";

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
  it("puts a pasted text chip back into the draft from its popover (D4 §3.9)", async () => {
    const { wrapper, store, sid } = await setup();
    store.setDraft(sid, { text: "why" });
    store.addChip(sid, {
      id: "paste:1",
      kind: "pasted_text",
      label: raw("Pasted text · 2 lines"),
      data: "a\nb",
      sizeBytes: 5,
      provenance: "attach",
      sent: "serialized",
    });
    await flushPromises();
    wrapper
      .findAllComponents({ name: "AssistantChipPopover" })
      .find((popover) => popover.props("chip").kind === "pasted_text")!
      .vm.$emit("paste-inline");
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("why\na\nb");
    expect(store.state.sessions[sid].composer.chips).toEqual([]);
  });

  it("is a named group: time first, then only the chips the user added (§1)", async () => {
    const { wrapper, store, sid, labels } = await setup();
    const group = wrapper.get('[data-test="assistant-context-tray"]');
    expect(group.attributes()).toMatchObject({
      role: "group",
      "aria-label": "Context for your next message",
    });
    expect(labels()).toEqual([]);
    expect(wrapper.get('[data-test="assistant-context-chip-time"]').text()).toBe("Last 15 min");
    expect(wrapper.get('[data-test="assistant-context-chip-time"]').attributes("aria-label")).toBe(
      "Time range, Last 15 min, from this page",
    );
    store.addChip(sid, ROW);
    await flushPromises();
    expect(labels()).toEqual(["Log row · cart · 13:57"]);
  });

  it("removes a staged chip with Delete and moves focus to the next chip (CT-08 AC 4)", async () => {
    const { wrapper, store, sid } = await setup();
    store.addChip(sid, ROW);
    store.addChip(sid, { ...ROW, id: "row-2", label: raw("Log row · cart · 13:58") });
    await flushPromises();
    const buttons = () => wrapper.findAll('[data-test="assistant-context-chip-button"]');
    await wrapper.get('[data-test="assistant-context-more"]').trigger("click");
    await buttons()[0].trigger("keydown", { key: "Delete" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.chips.map((c: ContextChip) => c.id)).toEqual([
      "row-2",
    ]);
    expect(document.activeElement?.textContent).toContain("13:58");
  });

  it("shows one chip then +N at 27 rem, all behind +N when narrow, and expands in place", async () => {
    const { wrapper, store, sid, labels } = await setup();
    store.addChip(sid, ROW);
    store.addChip(sid, { ...ROW, id: "row-2", label: raw("Log row · cart · 13:58") });
    await flushPromises();
    expect(labels()).toEqual(["Log row · cart · 13:57"]);
    const more = wrapper.get('[data-test="assistant-context-more"]');
    expect(more.text()).toBe("+1");
    expect(more.attributes("aria-expanded")).toBe("false");
    await more.trigger("click");
    expect(labels()).toHaveLength(2);
    const fewer = wrapper.get('[data-test="assistant-context-more"]');
    expect(fewer.attributes("aria-expanded")).toBe("true");
    expect(fewer.attributes("aria-label")).toBe("Show fewer context chips");
    expect(trayChipLimit({ narrow: true, wide: false })).toBe(0);
    expect(trayChipLimit({ narrow: false, wide: true })).toBe(3);
  });

  it("carries images as chips, removed like any other (U1)", async () => {
    const { store, sid, labels, wrapper } = await setup();
    store.addImage(sid, { data: "aGk=", mimeType: "image/png", filename: "shot.png", size: 2 });
    await flushPromises();
    expect(labels()).toEqual(["shot.png"]);
    await wrapper.get('[data-test="assistant-context-chip-remove"]').trigger("click");
    await flushPromises();
    expect(store.state.sessions[sid].composer.images).toEqual([]);
    expect(composerUi(sid).status?.text).toBe("shot.png removed from context");
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

  it("returns focus to the chip when its popover closes by Escape (U2)", async () => {
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
