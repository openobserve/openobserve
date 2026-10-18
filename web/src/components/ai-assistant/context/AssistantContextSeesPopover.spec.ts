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

import { contextRegistry } from "@/composables/contextProviders/registry";
import { trackAssistant } from "@/services/assistantAnalytics";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantContextSeesPopover from "./AssistantContextSeesPopover.vue";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

beforeEach(() => {
  sessionStorage.clear();
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

async function openPopover(shared = false) {
  fake.current = fakeAssistant();
  const store = fake.current.store;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  if (shared)
    store.state.sessions[sid].share = {
      id: "s",
      visibility: "org",
      mode: "snapshot",
      expiresAt: null,
      outOfDate: false,
      count: 1,
    };
  const wrapper = mount(AssistantContextSeesPopover, {
    props: { sid },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  await flushPromises();
  const trigger = wrapper.get('[data-test="assistant-context-sees"]');
  await trigger.trigger("click");
  await flushPromises();
  return {
    wrapper,
    trigger,
    panel: () =>
      document.body.querySelector<HTMLElement>('[data-test="assistant-context-sees-popover"]'),
  };
}

describe("AssistantContextSeesPopover", () => {
  it("lists Sent with your message and Not read by the assistant yet from the table (CT-04 AC 1–2)", async () => {
    const { panel } = await openPopover();
    const sent = panel()!.querySelector('[data-test="assistant-context-sees-sent"]')!;
    expect(sent.textContent).toContain("Sent with your message");
    expect(sent.textContent).toContain("Streams");
    expect(sent.textContent).toContain("default (traces)");
    const notRead = panel()!.querySelector('[data-test="assistant-context-sees-not_read"]')!;
    expect(notRead.textContent).toContain("Trace query");
    expect(
      notRead
        .querySelector('[data-test="assistant-context-sees-not-read-hint"]')
        ?.getAttribute("aria-label"),
    ).toBe("The assistant does not read this yet");
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_inspected", { target: "sees" });
  });

  it("opens with focus on its heading and is named What the assistant sees (CT-04 AC 6–7)", async () => {
    const { panel } = await openPopover();
    const heading = panel()!.querySelector("h2")!;
    expect(document.activeElement).toBe(heading);
    expect(panel()!.closest("[role='dialog']")?.getAttribute("aria-label")).toBe(
      "What the assistant sees",
    );
  });

  it("states the disclosure, and the shared one in a shared chat (CT-04 AC 4)", async () => {
    const plain = await openPopover();
    expect(
      plain.panel()!.querySelector('[data-test="assistant-context-sees-disclosure"]')?.textContent,
    ).toBe("Attached data is sent to the assistant and saved with this chat.");
    document.body.innerHTML = "";
    const shared = await openPopover(true);
    expect(
      shared.panel()!.querySelector('[data-test="assistant-context-sees-disclosure"]')?.textContent,
    ).toContain("included in any share");
  });

  it("keeps the trigger label for screen readers below md (CT-04 AC 8)", async () => {
    const { trigger } = await openPopover();
    expect(trigger.find(".max-md\\:sr-only").exists()).toBe(true);
    expect(trigger.classes()).toContain("max-md:min-h-11");
  });
});
