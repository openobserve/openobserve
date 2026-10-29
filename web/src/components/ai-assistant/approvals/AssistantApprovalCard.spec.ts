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
import { computed, defineComponent, h } from "vue";

import { runEscapeLadder } from "@/composables/assistant";
import { approvalOf } from "@/composables/assistant/reducer";
import {
  resetAssistantShortcutsForTests,
  useAssistantShortcuts,
} from "@/composables/assistant/shortcuts";
import { resetManager } from "@/lib/vue-shortcut-manager/manager";
import {
  noteAssistantKeydown,
  resetIdleFocusForTests,
} from "@/composables/assistant/useAssistantIdleFocus";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantApprovalCard from "./AssistantApprovalCard.vue";
import type { ApprovalCardView } from "./approvals.types";

const routes = [{ path: "/alerts/:alert_id", name: "alertDetail", component: {} }];

const DELETE_ONE = {
  type: "confirmation_required",
  tool: "o2_delete",
  message: 'Do you really want to delete the "checkout-latency-old" alert?',
  args: { items: [{ resource_type: "alert", name: "checkout-latency-old", id: "2Yx9alert" }] },
};

function cardOf(
  frame: Record<string, unknown>,
  over: Partial<ApprovalCardView> = {},
): ApprovalCardView {
  return {
    ...approvalOf(frame),
    id: "t1:1",
    sessionId: "s1",
    turnId: "t1",
    askedIn: "here",
    ...over,
  };
}

function mountCard(card: ApprovalCardView, props: Record<string, unknown> = {}) {
  return mount(AssistantApprovalCard, {
    props: { card, org: "default", ...props },
    attachTo: document.body,
    global: { plugins: [fakeRouter(routes)] },
  });
}

// A pointer click carries a click count; a keyboard-made click has none.
async function press(target: { element: Element }): Promise<void> {
  target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await flushPromises();
}

async function keyClick(target: { element: Element }): Promise<void> {
  target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  await flushPromises();
}

const buttons = (wrapper: ReturnType<typeof mountCard>) =>
  wrapper.findAll("button, a").map((el) => el.attributes("data-test"));

describe("AssistantApprovalCard", () => {
  beforeEach(() => {
    resetAssistantShortcutsForTests();
    resetIdleFocusForTests();
  });
  afterEach(() => (document.body.innerHTML = ""));

  it("is a named group with the tag, the heading, a linked target and Deny · Reply · Approve", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const group = wrapper.get('[data-test="assistant-approval-card"]');
    expect(group.attributes("role")).toBe("group");
    const heading = wrapper.get('[data-test="assistant-approval-heading"]');
    expect(group.attributes("aria-labelledby")).toBe(heading.attributes("id"));
    expect(heading.text()).toBe("Delete 1 alert");
    expect(wrapper.get('[data-test="assistant-approval-needs-ok"]').text()).toBe("Needs your OK");
    expect(wrapper.get('[data-test="assistant-approval-targets"]').text()).toContain(
      "checkout-latency-old",
    );
    const target = wrapper.get('[data-test="assistant-approval-target-2Yx9alert"]');
    expect(target.text()).toBe("Open");
    expect(target.attributes("aria-label")).toBe("Open checkout-latency-old (opens in a new tab)");
    expect(target.attributes("href")).toContain("/alerts/2Yx9alert");
    expect(target.attributes("target")).toBe("_blank");
    expect(target.attributes("rel")).toContain("noopener");
    const actions = buttons(wrapper).filter((id) =>
      [
        "assistant-approval-deny",
        "assistant-approval-reply",
        "assistant-approval-edit",
        "assistant-approval-approve",
      ].includes(id ?? ""),
    );
    expect(actions).toEqual([
      "assistant-approval-deny",
      "assistant-approval-reply",
      "assistant-approval-approve",
    ]);
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Delete 1 alert");
    expect(wrapper.find('[data-test="assistant-approval-scope"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-approval-impact"]').text()).toBe("Cannot be undone");
  });

  it("takes focus to Deny within one frame from the page, and says it is waiting", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE, { expiresAt: Date.now() + 25_000 }));
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-approval-deny"]').element,
    );
    expect(wrapper.emitted("announce")?.[0]?.[0]).toBe(
      "Waiting for your approval: Delete 1 alert. Expires in 25 seconds.",
    );
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe("Delete 1 alert");
    const countdown = wrapper.get('[data-test="assistant-approval-countdown"]');
    expect(countdown.text()).toBe("Expires in 0:25");
    expect(countdown.attributes("aria-hidden")).toBe("true");
    expect(wrapper.get('[data-test="assistant-approval-expiry"]').attributes("aria-live")).toBe(
      "off",
    );
  });

  it("never takes focus from the composer textbox; the line says how to reach the card", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-assistant-root", "");
    const textbox = document.createElement("textarea");
    root.append(textbox);
    document.body.append(root);
    textbox.focus();
    noteAssistantKeydown();
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    expect(document.activeElement).toBe(textbox);
    expect(wrapper.emitted("announce")?.[0]?.[0]).toBe(
      "Waiting for your approval: Delete 1 alert. Press Control I to review it.",
    );
  });

  it("ignores an activation whose key went down before the card mounted, and acts on the focused button only", async () => {
    noteAssistantKeydown();
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const deny = wrapper.get('[data-test="assistant-approval-deny"]');
    await keyClick(deny);
    expect(wrapper.emitted("decide")).toBeUndefined();
    await deny.trigger("keydown", { key: "Enter" });
    await keyClick(deny);
    expect(wrapper.emitted("decide")?.[0]?.[0]).toMatchObject({
      decision: { approved: false, reason: "deny" },
    });
  });

  it("takes a screen reader's activation, which comes with no key of its own", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    await keyClick(wrapper.get('[data-test="assistant-approval-deny"]'));
    expect(wrapper.emitted("decide")).toHaveLength(1);
  });

  it("denies on Escape inside the card, and leaves an IME candidate alone", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const deny = wrapper.get('[data-test="assistant-approval-deny"]').element;
    const composing = new KeyboardEvent("keydown", { key: "Escape", isComposing: true });
    Object.defineProperty(composing, "target", { value: deny });
    expect(runEscapeLadder(composing)).toBe(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "target", { value: deny });
    expect(runEscapeLadder(escape)).toBe(true);
    expect(wrapper.emitted("decide")?.[0]?.[0]).toMatchObject({
      decision: { approved: false, reason: "escape" },
    });
    const outside = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(outside, "target", { value: document.body });
    expect(runEscapeLadder(outside)).toBe(false);
  });

  it("lets Escape close an open scope select first, keeps the card, and declines only on the next Escape", async () => {
    resetManager();
    const ladder = mount(
      defineComponent({
        setup() {
          useAssistantShortcuts({
            gate: computed(() => "available" as const),
            assistantCanChat: computed(() => true),
          });
          return () => h("div");
        },
      }),
      { attachTo: document.body },
    );
    const wrapper = mountCard(
      cardOf({ type: "confirmation_required", tool: "bash", kind: "permission", grantable: true }),
    );
    await flushPromises();
    const trigger = wrapper.get('[data-test="assistant-approval-scope-trigger"]');
    await trigger.trigger("click");
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const escapeOn = () => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      Object.defineProperty(event, "target", { value: trigger.element });
      return event;
    };
    expect(runEscapeLadder(escapeOn())).toBe(true);
    expect(wrapper.emitted("decide")).toBeUndefined();
    // The select closes itself on the same key, as Reka does in the browser.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-test="assistant-approval-card"]').exists()).toBe(true);
    expect(wrapper.emitted("decide")).toBeUndefined();
    expect(runEscapeLadder(escapeOn())).toBe(true);
    expect(wrapper.emitted("decide")?.[0]?.[0]).toMatchObject({
      decision: { approved: false, reason: "escape" },
    });
    ladder.unmount();
    resetManager();
  });

  it.each([
    ["delete", DELETE_ONE, "Delete 1 alert"],
    [
      "update",
      {
        type: "confirmation_required",
        tool: "o2_UpdateAlert",
        kind: "update",
        targets: [{ type: "alert", name: "checkout-latency" }],
        before: { threshold: "1s" },
        after: { threshold: "2s" },
      },
      "Update alert checkout-latency",
    ],
    [
      "create",
      {
        type: "confirmation_required",
        tool: "o2_CreateAlert",
        kind: "create",
        targets: [{ type: "alert", name: "x" }],
        after: { name: "x" },
      },
      "Create alert",
    ],
    [
      "run_command",
      { type: "confirmation_required", tool: "acme-cli", args: { command: "deploy" } },
      "Run command on acme-cli",
    ],
    [
      "unknown kind as permission",
      { type: "confirmation_required", tool: "DeleteStream", message: "Really?" },
      "Allow DeleteStream",
    ],
  ])("titles a %s card from its kind", async (_kind, frame, heading) => {
    const wrapper = mountCard(cardOf(frame));
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(heading);
  });

  it("shows the changed fields of an update and reads Approve, primary", async () => {
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "o2_UpdateAlert",
        kind: "update",
        targets: [{ type: "alert", name: "checkout-latency" }],
        before: { threshold: "1s", name: "same" },
        after: { threshold: "2s", name: "same" },
      }),
    );
    await flushPromises();
    const diff = wrapper.get('[data-test="assistant-approval-diff"]');
    expect(diff.text()).toContain("Changes");
    expect(diff.text()).toContain("threshold");
    expect(diff.text()).toContain("1s → 2s");
    expect(diff.text()).not.toContain("same");
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Approve");
    const noBefore = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "o2_UpdateAlert",
        kind: "update",
        targets: [{ type: "alert", name: "a" }],
        after: { threshold: "2s" },
      }),
    );
    await flushPromises();
    expect(noBefore.get('[data-test="assistant-approval-diff"]').text()).toContain("New values");
  });

  it("offers a scope only when the server says it may be granted, never on a destructive card", async () => {
    const grantable = mountCard(
      cardOf({ type: "confirmation_required", tool: "bash", kind: "permission", grantable: true }),
    );
    await flushPromises();
    expect(grantable.find('[data-test="assistant-approval-scope"]').exists()).toBe(true);
    const destructive = mountCard(
      cardOf({
        ...DELETE_ONE,
        kind: "delete",
        grantable: true,
        targets: [{ type: "alert", name: "a" }],
      }),
    );
    await flushPromises();
    expect(destructive.find('[data-test="assistant-approval-scope"]').exists()).toBe(false);
  });

  it("plans a batch with tick boxes, and Approve follows the ticked items", async () => {
    const batch = {
      ...DELETE_ONE,
      args: {
        items: [
          { resource_type: "alert", name: "a", id: "1" },
          { resource_type: "alert", name: "b", id: "2" },
          { resource_type: "alert", name: "c", id: "3" },
        ],
      },
    };
    const wrapper = mountCard(cardOf(batch));
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-plan-block"]').text()).toContain(
      "I'll delete 3 alerts:",
    );
    const approve = () => wrapper.get('[data-test="assistant-approval-approve"]');
    expect(approve().text()).toBe("Delete 3 alerts");
    await press(wrapper.get('[data-test="assistant-plan-item-2"] button'));
    await flushPromises();
    expect(approve().text()).toBe("Delete 2 alerts");
    expect(wrapper.get('[data-test="assistant-approval-narrowed"]').text()).toBe(
      "The assistant will propose these 2 again for your approval",
    );
    await press(approve());
    expect(wrapper.emitted("decide")?.at(-1)?.[0]).toMatchObject({
      decision: { approved: true, scope: "once", items: ["1", "3"] },
    });
    await press(wrapper.get('[data-test="assistant-plan-item-1"] button'));
    await press(wrapper.get('[data-test="assistant-plan-item-3"] button'));
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-nothing"]').text()).toBe("Nothing selected");
    expect(approve().attributes("aria-disabled") ?? approve().attributes("disabled")).toBeDefined();
  });

  it("keeps its buttons, unavailable but focusable, beside 'Sending your decision…'", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE), { sending: true });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-sending"]').text()).toBe(
      "Sending your decision…",
    );
    for (const id of ["deny", "reply", "approve"]) {
      const button = wrapper.get(`[data-test="assistant-approval-${id}"]`);
      expect(button.attributes("aria-disabled")).toBe("true");
      expect(button.attributes("disabled")).toBeUndefined();
    }
    const approve = wrapper.get('[data-test="assistant-approval-approve"]');
    (approve.element as HTMLElement).focus();
    await press(approve);
    expect(wrapper.emitted("decide")).toBeUndefined();
    expect(document.activeElement).toBe(approve.element);
  });

  it("swallows Escape while its decision is on its way, so the panel stays open", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE), { sending: true });
    await flushPromises();
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "target", {
      value: wrapper.get('[data-test="assistant-approval-deny"]').element,
    });
    expect(runEscapeLadder(escape)).toBe(true);
    expect(wrapper.emitted("decide")).toBeUndefined();
  });

  it("shows what will run on its face: the question and the command, read with the card", async () => {
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "acme-cli",
        message: "Run this on prod?",
        args: { command: "kubectl delete pod checkout-7f9 --namespace prod" },
      }),
    );
    await flushPromises();
    const question = wrapper.get('[data-test="assistant-approval-question"]');
    const command = wrapper.get('[data-test="assistant-approval-command"]');
    expect(question.text()).toBe("Run this on prod?");
    expect(command.text()).toBe("kubectl delete pod checkout-7f9 --namespace prod");
    const described = wrapper
      .get('[data-test="assistant-approval-card"]')
      .attributes("aria-describedby");
    expect(described).toContain(question.attributes("id"));
    expect(described).toContain(command.attributes("id"));
  });

  it("names the card it was made on in every decision", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    await press(wrapper.get('[data-test="assistant-approval-deny"]'));
    expect(wrapper.emitted("decide")?.[0]?.[0]).toEqual({
      decision: { approved: false, reason: "deny" },
      approvalId: "t1:1",
    });
  });

  it("offers Edit then approve on a batch only, never on a single update", async () => {
    const update = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "o2_UpdateAlert",
        kind: "update",
        editable: true,
        targets: [{ type: "alert", name: "checkout-latency" }],
        after: { threshold: "2s" },
      }),
    );
    await flushPromises();
    expect(update.find('[data-test="assistant-approval-edit"]').exists()).toBe(false);
  });

  it("counts every item of a batch it cannot list in full, and offers no subset of it", async () => {
    const items = [
      { resource_type: "alert", name: "a", id: "1" },
      { resource_type: "alert", name: "b", id: "2" },
      { resource_type: "alert", id: "3" },
    ];
    const wrapper = mountCard(cardOf({ ...DELETE_ONE, args: { items } }));
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Delete 3 alerts");
    expect(wrapper.get('[data-test="assistant-plan-block"]').text()).toContain(
      "I'll delete 3 alerts:",
    );
    expect(wrapper.get('[data-test="assistant-plan-unlisted"]').text()).toBe(
      "1 more item has no name and is included",
    );
    expect(wrapper.find('[data-test="assistant-plan-item-1"] button').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-approval-edit"]').exists()).toBe(false);
  });

  it("offers More time only when the server allows it, and only in the last 20 s", async () => {
    const soon = cardOf(DELETE_ONE, { expiresAt: Date.now() + 15_000 });
    expect(mountCard(soon).find('[data-test="assistant-approval-extend"]').exists()).toBe(false);
    const extendable = mountCard(soon, { extendable: true });
    expect(extendable.find('[data-test="assistant-approval-extend"]').exists()).toBe(true);
    const later = mountCard(cardOf(DELETE_ONE, { expiresAt: Date.now() + 60_000 }), {
      extendable: true,
    });
    expect(later.find('[data-test="assistant-approval-extend"]').exists()).toBe(false);
  });

  it("keeps the raw arguments behind Details", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const details = wrapper.get('[data-test="assistant-approval-details"]');
    expect(details.text()).toContain("Details");
  });
});
