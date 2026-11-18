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

import type { ContextChip, ContextDraft } from "@/composables/assistant";
import { contextRegistry } from "@/composables/contextProviders/registry";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantContextSeesPopover from "./AssistantContextSeesPopover.vue";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any, emptyContext: false } }));

vi.mock("@/composables/assistant", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...real,
    useAssistantStore: () => fake.current.store,
    useAssistantContext: (...args: Parameters<typeof real.useAssistantContext>) => {
      const view = real.useAssistantContext(...args);
      return fake.emptyContext ? { ...view, sees: computed(() => []) } : view;
    },
  };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  data: { level: "error" },
  sizeBytes: 17,
  provenance: "door",
  sent: "serialized",
};

const MENTION: ContextChip = {
  id: "mention:stream:logs|checkout",
  kind: "stream",
  label: raw("checkout"),
  ref: { type: "stream", id: "checkout", org: "default", streamType: "logs" },
  sizeBytes: 8,
  provenance: "mention",
  sent: "whitelist",
};

beforeEach(() => {
  sessionStorage.clear();
  fake.emptyContext = false;
  contextRegistry.register("traces", {
    getContext: () => ({
      currentPage: "traces",
      selectedStreams: ["default"],
      streamType: "traces",
      currentQuery: "service_name='cart'",
      organization_identifier: "acme-prod",
      timeRange: {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 1_000_000,
        endTime: 901_000_000,
      },
    }),
  });
  contextRegistry.setActive("traces");
});

afterEach(() => {
  contextRegistry.cleanup();
  document.body.innerHTML = "";
});

async function openPopover(
  shared = false,
  extra: {
    props?: object;
    slots?: object;
    chips?: ContextChip[];
    noSession?: boolean;
    provide?: Record<string, number>;
  } = {},
) {
  fake.current = fakeAssistant();
  const store = fake.current.store;
  const sid = extra.noSession
    ? null
    : store.createSession({
        origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      });
  if (sid) for (const chip of extra.chips ?? []) store.addChip(sid, chip);
  if (sid && shared)
    store.state.sessions[sid].share = {
      id: "s",
      visibility: "org",
      mode: "snapshot",
      expiresAt: null,
      outOfDate: false,
      count: 1,
    };
  const wrapper = mount(AssistantContextSeesPopover, {
    props: { sid, ...extra.props },
    slots: extra.slots,
    global: { plugins: [fakeRouter(), fakeVuex()], provide: extra.provide },
    attachTo: document.body,
  });
  await flushPromises();
  const trigger = wrapper.get('[data-test="assistant-context-sees"]');
  await trigger.trigger("click");
  await flushPromises();
  const panel = () =>
    document.body.querySelector<HTMLElement>('[data-test="assistant-context-sees-popover"]');
  const group = (id: string) =>
    panel()!.querySelector<HTMLElement>(`[data-test="assistant-context-sees-${id}"]`);
  const fieldsOf = (id: string) =>
    [...(group(id)?.querySelectorAll('[data-test="assistant-context-sees-row"]') ?? [])].map(
      (row) => row.getAttribute("data-field"),
    );
  return { wrapper, trigger, panel, group, fieldsOf };
}

describe("AssistantContextSeesPopover", () => {
  it("lists the default context as one plain list, with no explanation text", async () => {
    const { panel, group, fieldsOf } = await openPopover();
    expect(fieldsOf("page")).toEqual(["currentPage", "selectedStreams", "timeRange"]);
    const list = group("page")!;
    expect(list.tagName).toBe("DL");
    expect(list.className).not.toMatch(/divide-y|border|bg-/);
    expect(list.textContent).toContain("default (traces)");
    expect(list.querySelector('[data-test="assistant-context-sees-org"]')).not.toBeNull();
    expect(list.querySelector('[data-test="assistant-context-sees-timezone"]')).not.toBeNull();
    expect(list.querySelector('[data-field="request_timestamp"]')).toBeNull();
    expect(list.textContent).not.toContain("Trace query");
    expect(panel()!.querySelectorAll("p")).toHaveLength(0);
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_inspected", { target: "sees" });
  });

  it("lists what the user added at the end of the same list", async () => {
    const { group, fieldsOf } = await openPopover(false, { chips: [ROW, MENTION] });
    expect(fieldsOf("page").slice(-2)).toEqual(["selectedStreams", "attachments"]);
    expect(fieldsOf("page").filter((id) => id === "selectedStreams")).toHaveLength(1);
    expect(group("page")!.textContent).toContain("1 attachment");
  });

  it("reads a box with no chat from its draft: its @ picks and its images", async () => {
    const draft: ContextDraft = {
      chips: [MENTION],
      images: [{ id: "i1", data: "AA==", mimeType: "image/png", filename: "a.png", size: 2048 }],
    };
    const { group, fieldsOf } = await openPopover(false, { noSession: true, props: { draft } });
    expect(fieldsOf("page").slice(-2)).toEqual(["selectedStreams", "attachments"]);
    expect(group("page")!.textContent).toContain("checkout");
    expect(group("page")!.textContent).toContain("1 attachment · 2 KB");
  });

  it("lists no time range on a page without one, as none is sent", async () => {
    contextRegistry.register("traces", {
      getContext: () => ({ currentPage: "alerts", organization_identifier: "acme-prod" }),
    });
    contextRegistry.setActive("traces");
    const { fieldsOf } = await openPopover();
    expect(fieldsOf("page")).toEqual(["currentPage"]);
  });

  it("says only the message goes when there is nothing else", async () => {
    fake.emptyContext = true;
    const { panel } = await openPopover();
    expect(
      panel()!.querySelector('[data-test="assistant-context-sees-empty"]')?.textContent?.trim(),
    ).toBe("Only your message is sent.");
  });

  it("opens from an (i) button titled Default context, with focus on its heading", async () => {
    const { panel, trigger } = await openPopover();
    expect(trigger.text()).toBe("");
    expect(trigger.attributes("aria-label")).toBe("Default context");
    const heading = panel()!.querySelector("h2")!;
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent?.trim()).toBe("Default context");
    expect(panel()!.closest("[role='dialog']")?.getAttribute("aria-label")).toBe("Default context");
  });

  it("never runs past the side panel or the viewport: its width caps at the room it has (T-03-02)", async () => {
    const { panel } = await openPopover();
    const content = panel()!.closest<HTMLElement>("[data-o-popover-content]")!;
    expect(content.className).toContain(
      "max-w-[min(22rem,calc(100vw-1.5rem),var(--reka-popper-available-width,100vw))]",
    );
  });

  it("is masked, in assistant colours, and stacks above the dock sheet it opens in", async () => {
    const { panel } = await openPopover(false, { provide: { o2DialogDepth: 1 } });
    expect(panel()!.getAttribute("data-dd-privacy")).toBe("mask");
    expect(panel()!.hasAttribute("data-assistant-surface")).toBe(true);
    expect(panel()!.closest<HTMLElement>("[data-o-popover-content]")?.style.zIndex).toBe("7000");
  });

  it("opens above its trigger and carries a detail slot", async () => {
    const { wrapper, panel } = await openPopover(false, {
      slots: { detail: '<p data-test="sees-detail">Drafts are not kept</p>' },
    });
    expect(wrapper.findComponent({ name: "OPopover" }).props("side")).toBe("top");
    expect(panel()!.querySelector('[data-test="sees-detail"]')?.textContent).toBe(
      "Drafts are not kept",
    );
  });
});
