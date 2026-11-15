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

import brandLocale from "@/locales/languages/en-US.json";

const brandNames = brandLocale.brand;

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
  it("says what goes with the next message under the title, then shows four compact rows in one card", async () => {
    const { panel, group, fieldsOf } = await openPopover();
    expect(panel()!.querySelector('[data-test="assistant-context-sees-intro"]')?.textContent).toBe(
      "These go with your next message.",
    );
    expect(panel()!.querySelector('[data-test="assistant-context-sees-heading"]')).toBeNull();
    expect(fieldsOf("page")).toEqual(["currentPage", "selectedStreams", "timeRange", "not_read"]);
    expect(group("page")!.classList.contains("divide-y")).toBe(true);
    expect(group("page")!.textContent).toContain("default (traces)");
    expect(group("page")!.querySelector('[data-test="assistant-context-sees-org"]')).not.toBeNull();
    expect(
      group("page")!.querySelector('[data-test="assistant-context-sees-timezone"]'),
    ).not.toBeNull();
    expect(group("page")!.querySelector('[data-field="request_timestamp"]')).toBeNull();
    expect(group("added")).toBeNull();
    expect(group("page")!.querySelector('[data-field="not_read"]')?.textContent).toContain(
      "Trace query",
    );
    expect(
      group("page")!
        .querySelector('[data-test="assistant-context-sees-not-read-hint"]')
        ?.getAttribute("aria-label"),
    ).toBe(`${brandNames.autobot} does not read this yet`);
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_inspected", { target: "sees" });
  });

  it("wraps the Not Sent list over up to three lines so no withheld name is cut off", async () => {
    const { group } = await openPopover();
    const notSent = group("page")!.querySelector('[data-field="not_read"]')!;
    const value = notSent.querySelector('[data-test="o-truncated-text"]')!;
    expect(value.classList.contains("line-clamp-3")).toBe(true);
    expect(notSent.classList.contains("items-start")).toBe(true);
    const page = group("page")!.querySelector(
      '[data-field="currentPage"] [data-test="o-truncated-text"]',
    )!;
    expect(page.classList.contains("line-clamp-3")).toBe(false);
  });

  it("shows each row as one line with an icon, a label and a value", async () => {
    const { group } = await openPopover();
    const rows = group("page")!.querySelectorAll('[data-test="assistant-context-sees-row"]');
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.querySelector('[data-test="assistant-context-sees-row-icon"]')).not.toBeNull();
      expect(row.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows the dictation line only when a speech engine is named", async () => {
    const { panel } = await openPopover();
    const voice = panel()!.querySelector('[data-test="assistant-context-sees-voice"]');
    if (voice)
      expect(voice.textContent?.trim()).toBe(
        "Dictation uses your browser's speech service. Audio is not stored.",
      );
  });

  it("lists what the user added under You Added, @ mentions included, and says how to remove it", async () => {
    const { panel, group, fieldsOf } = await openPopover(false, { chips: [ROW, MENTION] });
    expect(fieldsOf("added")).toEqual(["selectedStreams", "attachments"]);
    expect(fieldsOf("page")).not.toContain("selectedStreams");
    expect(group("added")!.querySelector(".divide-y")).not.toBeNull();
    expect(group("added")!.textContent).toContain("1 attachment");
    expect(panel()!.querySelector('[data-test="assistant-context-sees-intro"]')?.textContent).toBe(
      "These go with your next message. To leave out something you added, remove its chip.",
    );
  });

  it("reads a box with no chat from its draft: its range, its @ picks and its images", async () => {
    const draft: ContextDraft = {
      chips: [MENTION],
      images: [{ id: "i1", data: "AA==", mimeType: "image/png", filename: "a.png", size: 2048 }],
      timeOverride: { from: 1_000, to: 3_601_000, period: "1h" },
    };
    const { group, fieldsOf } = await openPopover(false, { noSession: true, props: { draft } });
    expect(fieldsOf("added")).toEqual(["selectedStreams", "attachments"]);
    expect(group("added")!.textContent).toContain("checkout");
    expect(group("added")!.textContent).toContain("1 attachment · 2 KB");
    expect(group("page")!.textContent).toContain("1 h");
  });

  it("says only the message goes when there is nothing else", async () => {
    fake.emptyContext = true;
    const { panel } = await openPopover();
    expect(
      panel()!.querySelector('[data-test="assistant-context-sees-empty"]')?.textContent?.trim(),
    ).toBe("Only your message is sent.");
    expect(panel()!.querySelector('[data-test="assistant-context-sees-heading"]')).toBeNull();
  });

  it("opens with focus on its heading and is named after the product (CT-04 AC 6–7)", async () => {
    const { panel } = await openPopover();
    const heading = panel()!.querySelector("h2")!;
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent?.trim()).toBe(`What ${brandNames.autobot} Will See`);
    expect(panel()!.closest("[role='dialog']")?.getAttribute("aria-label")).toBe(
      `What ${brandNames.autobot} Will See`,
    );
  });

  it("states the disclosure, and the shared one in a shared chat (CT-04 AC 4)", async () => {
    const plain = await openPopover();
    expect(
      plain.panel()!.querySelector('[data-test="assistant-context-sees-disclosure"]')?.textContent,
    ).toBe("Saved with this chat.");
    document.body.innerHTML = "";
    const shared = await openPopover(true);
    expect(
      shared.panel()!.querySelector('[data-test="assistant-context-sees-disclosure"]')?.textContent,
    ).toContain("included in any share");
  });

  it("opens from a small named icon that fits the box's corner, taking no text width (PO A34)", async () => {
    const { trigger, wrapper } = await openPopover();
    expect(trigger.text()).toBe("");
    expect(trigger.attributes("aria-label")).toBe(`What ${brandNames.autobot} Will See`);
    expect(trigger.attributes("data-size")).toBe("sm");
    expect(trigger.classes()).toContain("max-md:min-h-11");
    expect(wrapper.findComponent({ name: "OTooltip" }).exists()).toBe(true);
  });

  it("never runs past the side panel or the viewport: its width caps at the room it has (T-03-02)", async () => {
    const { panel } = await openPopover();
    const content = panel()!.closest<HTMLElement>("[data-o-popover-content]")!;
    expect(content.className).toContain(
      "max-w-[min(26rem,calc(100vw-1.5rem),var(--reka-popper-available-width,100vw))]",
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
