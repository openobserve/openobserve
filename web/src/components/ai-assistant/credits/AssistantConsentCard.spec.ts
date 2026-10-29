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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runEscapeLadder } from "@/composables/assistant";
import { resetAssistantShortcutsForTests } from "@/composables/assistant/shortcuts";
import {
  noteAssistantKeydown,
  resetIdleFocusForTests,
} from "@/composables/assistant/useAssistantIdleFocus";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantConsentCard from "./AssistantConsentCard.vue";

const routes = [{ path: "/billings/plans", name: "plans", component: {} }];

function mountCard(props: Record<string, unknown> = {}) {
  return mount(AssistantConsentCard, {
    props: {
      sid: "s1",
      orgName: "acme-prod",
      planType: "direct",
      canEnable: true,
      variant: "card",
      state: "shown",
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [fakeRouter(routes)] },
  });
}

async function press(target: { element: Element }): Promise<void> {
  target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await flushPromises();
}

describe("AssistantConsentCard", () => {
  beforeEach(() => {
    resetAssistantShortcutsForTests();
    resetIdleFocusForTests();
  });
  afterEach(() => (document.body.innerHTML = ""));

  it("names the org and the consequence, links Billing in a new tab, and gates Enable on the box", async () => {
    const wrapper = mountCard();
    await flushPromises();
    const card = wrapper.get('[data-test="assistant-consent-card"]');
    const heading = wrapper.get('[data-test="assistant-consent-card-org"]');
    expect(card.element.tagName).toBe("SECTION");
    expect(card.attributes("aria-labelledby")).toBe(heading.attributes("id"));
    expect(heading.text()).toBe("Enable paid AI usage for acme-prod?");
    expect(wrapper.get('[data-test="assistant-consent-card-consequence"]').text()).toBe(
      "Included credits are used up. If you enable it, every AI request from anyone in acme-prod is billed to its current billing cycle until an admin turns it off.",
    );
    const billing = wrapper.get('[data-test="assistant-consent-card-view-billing"]');
    expect(billing.attributes("target")).toBe("_blank");
    expect(billing.attributes("href")).toContain("/billings/plans?org_identifier=acme-prod");
    const enable = wrapper.get('[data-test="assistant-consent-card-enable"]');
    expect(enable.attributes("disabled")).toBeDefined();
    await press(wrapper.get('[data-test="assistant-consent-card-checkbox"] button'));
    expect(enable.attributes("disabled")).toBeUndefined();
    await press(enable);
    expect(wrapper.emitted("enable")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/\$|€|price/i);
  });

  it("names the payer when only the payer must enable, and bills to it", async () => {
    const wrapper = mountCard({ planType: "payer", payerName: "acme-billing", payerOnly: true });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-consent-card-org"]').text()).toBe(
      "Enable paid AI usage for payer organization acme-billing?",
    );
    expect(wrapper.get('[data-test="assistant-consent-card-consequence"]').text()).toContain(
      "billed to acme-billing's current billing cycle",
    );
  });

  it("gives a member Ask an admin instead of the box and Enable", async () => {
    const wrapper = mountCard({ canEnable: false });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-consent-card-checkbox"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-consent-card-enable"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-consent-card-member"]').text()).toContain(
      "An admin of acme-prod can enable paid usage.",
    );
    expect(wrapper.find('[data-test="assistant-consent-card-ask-admin"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-consent-card-cancel"]').exists()).toBe(true);
  });

  it("focuses its heading, never Enable, and announces the org once", async () => {
    const wrapper = mountCard();
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-consent-card-org"]').element,
    );
    expect(wrapper.emitted("announce")).toEqual([
      ["Waiting for your decision on paid usage for acme-prod."],
    ]);
    const order = wrapper
      .findAll("a, button")
      .map(
        (el) =>
          el.attributes("data-test") ??
          el.element.closest("[data-test]")?.getAttribute("data-test"),
      );
    expect(order).toEqual([
      "assistant-consent-card-view-billing",
      "assistant-consent-card-checkbox",
      "assistant-consent-card-cancel",
      "assistant-consent-card-enable",
    ]);
  });

  it("leaves focus in the composer and says how to reach the card", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-assistant-root", "");
    const textbox = document.createElement("textarea");
    root.append(textbox);
    document.body.append(root);
    textbox.focus();
    noteAssistantKeydown();
    const wrapper = mountCard();
    await flushPromises();
    expect(document.activeElement).toBe(textbox);
    expect(wrapper.emitted("announce")?.[0]?.[0]).toBe(
      "Waiting for your decision on paid usage for acme-prod. Press Control I to review it.",
    );
  });

  it("cancels on Escape inside the card only", async () => {
    const wrapper = mountCard();
    await flushPromises();
    const inside = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(inside, "target", {
      value: wrapper.get('[data-test="assistant-consent-card-cancel"]').element,
    });
    expect(runEscapeLadder(inside)).toBe(true);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    const outside = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(outside, "target", { value: document.body });
    expect(runEscapeLadder(outside)).toBe(false);
  });

  it("shows its inline error and keeps Enable", async () => {
    const wrapper = mountCard({ state: "error", error: "failed" });
    await flushPromises();
    const error = wrapper.get('[data-test="assistant-consent-card-error"]');
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toBe("Paid usage couldn't be updated. Try again.");
    expect(wrapper.find('[data-test="assistant-consent-card-enable"]').exists()).toBe(true);
  });

  it("is busy while submitting, with Cancel disabled", async () => {
    const wrapper = mountCard({ state: "submitting" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-consent-card"]').attributes("aria-busy")).toBe(
      "true",
    );
    const cancel = wrapper.get('[data-test="assistant-consent-card-cancel"]');
    expect(cancel.attributes("aria-disabled")).toBe("true");
    expect(cancel.attributes("disabled")).toBeUndefined();
  });

  it("swallows Escape while Enable is on its way, so neither the card nor the panel goes", async () => {
    const wrapper = mountCard({ state: "submitting" });
    await flushPromises();
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "target", {
      value: wrapper.get('[data-test="assistant-consent-card-cancel"]').element,
    });
    expect(runEscapeLadder(escape)).toBe(true);
    expect(wrapper.emitted("cancel")).toBeUndefined();
  });

  it("states what happened once resolved, instead of asking again", async () => {
    const wrapper = mountCard({ state: "resolved_here" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-consent-card-org"]').text()).toBe(
      "Paid AI usage is on for acme-prod",
    );
  });

  it("says a grant made in another tab, then the card goes", async () => {
    const tab = mountCard({ state: "resolved_elsewhere", via: "tab" });
    expect(tab.get('[data-test="assistant-consent-card-resolved"]').text()).toBe(
      "Paid usage was turned on in another tab. Sending your message.",
    );
    const focus = mountCard({ state: "resolved_elsewhere", via: "focus" });
    expect(focus.get('[data-test="assistant-consent-card-resolved"]').text()).toBe(
      "Paid usage was turned on elsewhere. Sending your message.",
    );
  });
});
