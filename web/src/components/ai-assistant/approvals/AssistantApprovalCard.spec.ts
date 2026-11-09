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
import { createStore } from "vuex";

import { runEscapeLadder } from "@/composables/assistant";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { approvalOf } from "@/composables/assistant/reducer";
import { resetAssistantShortcutsForTests } from "@/composables/assistant/shortcuts";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import {
  noteAssistantKeydown,
  resetIdleFocusForTests,
} from "@/composables/assistant/useAssistantIdleFocus";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantApprovalCard from "./AssistantApprovalCard.vue";
import { assistantApprovalsHostKey, type ApprovalCardView } from "./approvals.types";

const routes = [
  { path: "/alerts/:alert_id", name: "alertDetail", component: {} },
  { path: "/alerts", name: "alertList", component: {} },
];

// How o2-ai asks to pause an alert: the raw arguments, no targets, no before.
const PAUSE = {
  type: "confirmation_required",
  tool: "EnableAlert",
  message: "Pause the alert?",
  args: { org_id: "default", alert_id: "2Yx9alertcart", value: false },
};

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

// ODropdown renders its menu only when open; the stub renders every item in place so the ⋯ menu can be asserted.
const dropdownStubs = {
  ODropdown: {
    props: ["side", "align"],
    template:
      "<div data-test='assistant-approval-menu' :data-side='side' :data-align='align'><slot name='trigger' /><slot /></div>",
  },
  ODropdownItem: {
    props: { disabled: { type: Boolean, default: false } },
    emits: ["select"],
    template:
      "<div role='menuitem' :data-disabled='disabled' @click=\"!disabled && $emit('select')\"><slot /></div>",
  },
};

function mountCard(card: ApprovalCardView, props: Record<string, unknown> = {}) {
  return mount(AssistantApprovalCard, {
    props: { card, org: "default", ...props },
    attachTo: document.body,
    global: { plugins: [fakeRouter(routes)], stubs: dropdownStubs },
  });
}

const menuItems = (wrapper: ReturnType<typeof mountCard>) =>
  wrapper.findAll('[role="menuitem"]').map((el) => el.attributes("data-test"));

// A pointer click carries a click count; a keyboard-made click has none.
async function press(target: { element: Element }): Promise<void> {
  target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await flushPromises();
}

async function keyClick(target: { element: Element }): Promise<void> {
  target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  await flushPromises();
}

async function openDetails(wrapper: ReturnType<typeof mountCard>): Promise<void> {
  await wrapper.get('[data-test="assistant-approval-details"] button').trigger("click");
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

  it("is a named group: the strip and timer, the effect, ⋯ · Deny · the verb primary, then Details", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE, { expiresAt: Date.now() + 222_000 }));
    await flushPromises();
    const group = wrapper.get('[data-test="assistant-approval-card"]');
    expect(group.attributes("role")).toBe("group");
    expect(group.attributes("aria-label")).toBe("Needs your OK: delete 1 alert");
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe("Delete 1 alert");
    const timer = wrapper.get('[data-test="assistant-approval-countdown"]');
    expect(timer.text()).toBe("3:42");
    expect(timer.attributes("aria-label")).toBe("Expires in 3:42");
    expect(buttons(wrapper)).toEqual([
      "assistant-approval-more",
      "assistant-approval-deny",
      "assistant-approval-approve",
      undefined,
    ]);
    expect(menuItems(wrapper)).toEqual(["assistant-approval-reply"]);
    expect(wrapper.text()).not.toContain("Reply declines");
    const strip = wrapper.get('[data-test="assistant-approval-strip"]');
    expect(strip.get('[data-test="assistant-approval-strip-label"]').text()).toBe("Needs your OK");
    expect(
      strip.get('[data-test="assistant-approval-strip-label"]').attributes("aria-hidden"),
    ).toBe("true");
    expect(strip.element.contains(timer.element)).toBe(true);
  });

  it("draws the amber edge and no box, and keeps the normal primary for an irreversible kind", () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    const group = wrapper.get('[data-test="assistant-approval-card"]');
    expect(group.classes()).toEqual(
      expect.arrayContaining(["border-s-2", "border-status-warning-text"]),
    );
    expect(group.classes()).not.toContain("rounded-surface");
    const approve = wrapper.get('[data-test="assistant-approval-approve"]');
    expect(approve.attributes("data-o2-variant")).toBe("primary");
    expect(approve.classes().join(" ")).not.toContain("destructive");
    expect(approve.text()).toBe("Delete 1 alert");
  });

  it("takes focus to the heading within one frame from the page, and says it is waiting", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-approval-heading"]').element,
    );
    expect(wrapper.emitted("announce")?.[0][0]).toContain("Delete 1 alert");
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

  it("never decides on Escape, and keeps it from closing the panel", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const deny = wrapper.get('[data-test="assistant-approval-deny"]');
    (deny.element as HTMLElement).focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    deny.element.dispatchEvent(event);
    expect(runEscapeLadder(event)).toBe(true);
    expect(wrapper.emitted("decide")).toBeUndefined();
  });

  it("offers no decision by Escape anywhere, with or without the scope select", async () => {
    const wrapper = mountCard(cardOf(PAUSE, { grantable: true, targets: [] }));
    await flushPromises();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    wrapper.get('[data-test="assistant-approval-card"]').element.dispatchEvent(event);
    runEscapeLadder(event);
    expect(wrapper.emitted("decide")).toBeUndefined();
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
      "Create alert x",
    ],
    [
      "create named only by its tool id",
      {
        type: "confirmation_required",
        tool: "o2_CreateDashboard",
        kind: "create",
        targets: [{ type: "dashboard", name: "CreateDashboard" }],
      },
      "Create dashboard",
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

  it("names a create by its title, never by the tool id o2-ai puts in its target", async () => {
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "CreateDashboard",
        kind: "create",
        targets: [{ type: "dashboard", name: "CreateDashboard" }],
        args: { org_id: "default", request_body: { title: "QA approval test" } },
      }),
    );
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(
      "Create dashboard QA approval test",
    );
  });

  it("names a new panel by its title and its dashboard by name, never by the dashboard id", async () => {
    const store = createStore({
      state: {
        organizationData: {
          allDashboardList: {
            default: [{ dashboardId: "7524560427116658688", title: "QA inpage dash" }],
          },
        },
      },
    });
    const wrapper = mount(AssistantApprovalCard, {
      props: {
        card: cardOf({
          type: "confirmation_required",
          tool: "AddPanel",
          kind: "create",
          targets: [{ type: "panel", name: "7524560427116658688", id: "7524560427116658688" }],
          args: {
            org_id: "default",
            dashboard_id: "7524560427116658688",
            request_body: { tabId: "default", panel: { title: "Total Error Logs" } },
          },
        }),
        org: "default",
      },
      attachTo: document.body,
      global: { plugins: [fakeRouter(routes), store] },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(
      "Create panel Total Error Logs",
    );
    const meta = wrapper.get('[data-test="assistant-approval-meta"]').text();
    expect(meta).toContain("QA inpage dash");
    expect(wrapper.text()).not.toContain("7524560427116658688");
    wrapper.unmount();
  });

  it("shows the diff on the card face, old struck through and new in the success colour, and a verb primary", async () => {
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "UpdateDashboard",
        kind: "update",
        targets: [{ type: "dashboard", id: "d1", name: "Checkout" }],
        before: { title: "Old" },
        after: { title: "New" },
      }),
    );
    await flushPromises();
    const diff = wrapper.get('[data-test="assistant-approval-diff"]');
    expect(diff.text()).toContain("Title");
    expect(diff.get("s").text()).toBe("Old");
    expect(diff.get("s").classes()).toContain("text-text-secondary");
    const after = diff.get('[data-test="assistant-approval-diff-after"]');
    expect(after.text()).toBe("New");
    expect(after.classes()).toContain("text-status-success-text");
    expect(wrapper.find('[data-test="assistant-approval-details"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Update dashboard");
  });

  it("reads a toggle as Pause, names the object, and states when it ends and who is notified", async () => {
    const wrapper = mount(AssistantApprovalCard, {
      props: {
        card: cardOf({
          ...PAUSE,
          args: {
            ...PAUSE.args,
            folder: "f-pay",
            ends_at: 1_800_000_000_000_000,
            request_body: { name: "cart-5xx-spike", destinations: ["#cart-oncall"] },
          },
        }),
        org: "default",
      },
      attachTo: document.body,
      global: {
        plugins: [fakeRouter(routes)],
        provide: {
          [assistantApprovalsHostKey as symbol]: {
            folderName: (id: string) => (id === "f-pay" ? "Payments" : null),
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(
      "Pause alert cart-5xx-spike",
    );
    const meta = wrapper.get('[data-test="assistant-approval-meta"]').text();
    expect(meta).toMatch(/^Until .* · Payments$/);
    expect(wrapper.get('[data-test="assistant-approval-diff"]').text()).toContain("#cart-oncall");
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Pause alert");
  });

  it("never puts a raw id in the heading: an unresolved name is said once, shortened, in the meta line", async () => {
    const wrapper = mountCard(cardOf(PAUSE));
    await flushPromises();
    const heading = wrapper.get('[data-test="assistant-approval-heading"]').text();
    expect(heading).toBe("Pause alert");
    expect(wrapper.get('[data-test="assistant-approval-meta"]').text()).toBe(
      "Couldn't load the name of alert 2Yx9aler…; you may not have access to it.",
    );
    expect(wrapper.text()).not.toContain("2Yx9alertcart");
  });

  it("names the org, not its id, only when the user can be in another org", async () => {
    const many = mountCard(cardOf(PAUSE, { targets: [{ type: "alert", name: "a", id: "1" }] }), {
      orgName: "Production",
      multiOrg: true,
    });
    await flushPromises();
    expect(many.get('[data-test="assistant-approval-meta"]').text()).toBe("in Production");
    const one = mountCard(cardOf(PAUSE, { targets: [{ type: "alert", name: "a", id: "1" }] }), {
      orgName: "Production",
    });
    await flushPromises();
    expect(one.find('[data-test="assistant-approval-meta"]').exists()).toBe(false);
  });

  it("offers Finish in Alerts in ⋯, resolving the card first (PO A9)", async () => {
    const router = fakeRouter(routes);
    const push = vi.spyOn(router, "push");
    const wrapper = mount(AssistantApprovalCard, {
      props: { card: cardOf(PAUSE), org: "default" },
      attachTo: document.body,
      global: { plugins: [router], stubs: dropdownStubs },
    });
    await flushPromises();
    const finish = wrapper.get('[data-test="assistant-approval-finish-in"]');
    expect(finish.attributes("role")).toBe("menuitem");
    expect(finish.text()).toBe("Finish in Alerts");
    await press(finish);
    expect(wrapper.emitted("decide")?.[0][0]).toEqual({
      decision: { approved: false, reason: "edited" },
      approvalId: "t1:1",
    });
    expect(push).toHaveBeenCalled();
  });

  it("keeps only More time while the composer writes the reply (A18 overruled)", async () => {
    setRuntimeHandle({
      store: {
        state: { sessions: { s1: { composer: { mode: "reply", replyApprovalId: "t1:1" } } } },
      },
    } as never);
    const wrapper = mountCard(cardOf(PAUSE, { expiresAt: Date.now() + 60_000 }), {
      extendable: true,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-approval-deny"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-approval-approve"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-approval-extend"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-approval-countdown"]').exists()).toBe(true);
    setRuntimeHandle(null);
  });

  it("offers a scope above the buttons only when the server says it may be granted", async () => {
    const run = cardOf({
      type: "confirmation_required",
      tool: "RunThing",
      grantable: true,
      args: { command: "ls" },
    });
    const wrapper = mountCard(run);
    await flushPromises();
    const scope = wrapper.get('[data-test="assistant-approval-scope"]').element;
    const approve = wrapper.get('[data-test="assistant-approval-approve"]').element;
    expect(scope.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const destructive = mountCard(cardOf(DELETE_ONE, { grantable: true }));
    await openDetails(destructive);
    expect(destructive.find('[data-test="assistant-approval-scope"]').exists()).toBe(false);
  });

  it("N2: o2-ai's gathered MuteAlert card names both alerts, pluralises Approve and offers the scope", async () => {
    // The frame o2-ai's build_multi_write_confirmation_event emits for two parallel MuteAlert calls.
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        id: "apr_1",
        tool: "MuteAlert",
        kind: "update",
        operation: "MuteAlert",
        grantable: true,
        message: 'The assistant wants to mute these 2 alerts: "latency_high", "checkout_5xx".',
        targets: [
          { type: "alert", id: "3LrpA", name: "latency_high", after: { minutes: 30 } },
          { type: "alert", id: "3LrpB", name: "checkout_5xx", after: { minutes: 30 } },
        ],
        after: { minutes: 30 },
        args: { minutes: 30, calls: [{ alert_id: "3LrpA" }, { alert_id: "3LrpB" }] },
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Pause alerts latency_high, checkout_5xx");
    expect(wrapper.get('[data-test="assistant-approval-approve"]').text()).toBe("Pause alerts");
    expect(wrapper.find('[data-test="assistant-approval-scope"]').exists()).toBe(true);
  });

  it("offers an always scope only for a change to several targets, worded by the action", async () => {
    const pause = (targets: { type: string; id: string; name: string }[]) =>
      cardOf({
        type: "confirmation_required",
        tool: "EnableAlert",
        kind: "update",
        grantable: true,
        targets,
        args: { value: false },
      });
    const one = mountCard(pause([{ type: "alert", id: "a1", name: "inventory pod restarts" }]));
    expect(one.find('[data-test="assistant-approval-scope"]').exists()).toBe(false);
    const three = mountCard(
      pause([
        { type: "alert", id: "a1", name: "inventory pod restarts" },
        { type: "alert", id: "a2", name: "inventory p95 > 600 ms" },
        { type: "alert", id: "a3", name: "inventory error budget burn" },
      ]),
    );
    const options = three.findComponent(OSelect).props("options") as { label: string }[];
    expect(options.map((option) => option.label)).toEqual([
      "Just this once",
      "For this chat",
      "Always for pausing alerts",
    ]);
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
    expect(approve().attributes("aria-disabled") ?? approve().attributes("disabled")).toBeDefined();
  });

  it("keeps its buttons, unavailable but focusable, under aria-busy while sending", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE), { sending: true });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-card"]').attributes("aria-busy")).toBe(
      "true",
    );
    const deny = wrapper.get('[data-test="assistant-approval-deny"]');
    expect(deny.attributes("aria-disabled")).toBe("true");
    await press(deny);
    expect(wrapper.emitted("decide")).toBeUndefined();
  });

  it("spins the primary while its own decision is on its way, and only that one", async () => {
    const wrapper = mountCard(cardOf(PAUSE));
    await flushPromises();
    const approve = () => wrapper.get('[data-test="assistant-approval-approve"]');
    expect(approve().attributes("aria-busy")).toBeUndefined();
    await press(approve());
    await wrapper.setProps({ sending: true });
    expect(approve().attributes("aria-busy")).toBe("true");
    expect(
      wrapper.get('[data-test="assistant-approval-deny"]').attributes("aria-busy"),
    ).toBeUndefined();
    await wrapper.setProps({ sending: false });
    expect(approve().attributes("aria-busy")).toBeUndefined();
    await press(wrapper.get('[data-test="assistant-approval-deny"]'));
    await wrapper.setProps({ sending: true });
    expect(approve().attributes("aria-busy")).toBeUndefined();
  });

  it("puts Details after the buttons in the DOM", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const details = wrapper.get('[data-test="assistant-approval-details"]').element;
    const approve = wrapper.get('[data-test="assistant-approval-approve"]').element;
    expect(
      approve.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("keeps the command on the face of a CLI card, and a permission's own question", async () => {
    const wrapper = mountCard(
      cardOf({
        type: "confirmation_required",
        tool: "Shell",
        message: "Run this?",
        args: { command: "kubectl get pods" },
      }),
    );
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-approval-command"]').text()).toBe("kubectl get pods");
    expect(wrapper.get('[data-test="assistant-approval-question"]').text()).toBe("Run this?");
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

  it("offers More time from mount when the server allows it, in ⋯ after Reply (PO A11, A23)", async () => {
    const later = cardOf(DELETE_ONE, { expiresAt: Date.now() + 240_000 });
    expect(mountCard(later).find('[data-test="assistant-approval-extend"]').exists()).toBe(false);
    const extendable = mountCard(later, { extendable: true });
    expect(menuItems(extendable)).toEqual([
      "assistant-approval-reply",
      "assistant-approval-extend",
    ]);
    await press(extendable.get('[data-test="assistant-approval-extend"]'));
    expect(extendable.emitted("extend")).toHaveLength(1);
  });

  it("opens ⋯ upward from the start, so the menu never covers Deny or Approve", () => {
    const menu = mountCard(cardOf(DELETE_ONE)).get('[data-test="assistant-approval-menu"]');
    expect(menu.attributes("data-side")).toBe("top");
    expect(menu.attributes("data-align")).toBe("start");
  });

  it("the footer holds only Deny and the verb primary as buttons", () => {
    const wrapper = mountCard(cardOf(PAUSE));
    const footer = wrapper.get('[data-test="assistant-approval-footer"]');
    const labels = footer
      .findAll("button")
      .filter(
        (b) =>
          b.attributes("role") !== "menuitem" &&
          b.attributes("data-test") !== "assistant-approval-more",
      )
      .map((b) => b.text());
    expect(labels).toEqual(["Deny", "Pause alert"]);
    expect(footer.get('[data-test="assistant-approval-deny"]').attributes("data-o2-variant")).toBe(
      "outline",
    );
    expect(
      footer.get('[data-test="assistant-approval-approve"]').attributes("data-o2-variant"),
    ).toBe("primary");
  });

  it("keeps the raw arguments behind Details", async () => {
    const wrapper = mountCard(cardOf(DELETE_ONE));
    await flushPromises();
    const details = wrapper.get('[data-test="assistant-approval-details"]');
    expect(details.text()).toContain("Details");
  });

  describe("timing (`30` §7.3)", () => {
    const PERMISSION_FRAME = { kind: "permission", tool: "o2_search", args: {} };
    const inMs = (ms: number) => cardOf(PERMISSION_FRAME, { expiresAt: Date.now() + ms });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("drops More time when the user's budget is spent", () => {
      const wrapper = mountCard(
        cardOf(PAUSE, { expiresAt: Date.now() + 60_000, userExtendsLeft: 0 }),
        {
          extendable: true,
        },
      );
      expect(wrapper.find('[data-test="assistant-approval-extend"]').exists()).toBe(false);
    });

    it("warns at 60 s and 20 s, once each, and an extension starts over", async () => {
      const wrapper = mountCard(inMs(90_000));
      await flushPromises();
      const warnings = () =>
        (wrapper.emitted("announce") ?? [])
          .map(([text]) => String(text))
          .filter((text) => text.includes("Approval expires in"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain("More time is on the card.");
      await vi.advanceTimersByTimeAsync(40_000);
      expect(warnings()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(warnings()).toHaveLength(2);
      await wrapper.setProps({ card: inMs(70_000) });
      await flushPromises();
      expect((wrapper.emitted("announce") ?? []).map(([text]) => String(text)).join()).toContain(
        "More time added.",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(warnings()).toHaveLength(3);
    });

    it("gives no warning for a window it mounted inside: the mount line said the time", async () => {
      const wrapper = mountCard(inMs(50_000));
      await flushPromises();
      await vi.advanceTimersByTimeAsync(5_000);
      const spoken = (wrapper.emitted("announce") ?? []).map(([text]) => String(text));
      expect(spoken.filter((text) => text.includes("Approval expires in"))).toEqual([]);
    });

    it("inverts the timer into a warning badge in the last 60 s", async () => {
      const wrapper = mountCard(cardOf(PAUSE, { expiresAt: Date.now() + 48_000 }));
      await flushPromises();
      const timer = wrapper.get('[data-test="assistant-approval-countdown"]');
      expect(timer.text()).toBe("0:48");
      expect(timer.classes()).toContain("font-medium");
      expect(timer.attributes("data-expiring")).toBe("");
      expect(timer.findComponent(OBadge).props("variant")).toBe("warning");
    });

    it("keeps the timer plain before the last minute", async () => {
      const wrapper = mountCard(cardOf(PAUSE, { expiresAt: Date.now() + 120_000 }));
      await flushPromises();
      const timer = wrapper.get('[data-test="assistant-approval-countdown"]');
      expect(timer.attributes("data-expiring")).toBeUndefined();
      expect(timer.findComponent(OBadge).exists()).toBe(false);
      expect(timer.classes()).toContain("text-status-warning-text");
    });
  });

  describe("gated, on a server without split budgets (PO A14, B96)", () => {
    const frame = { kind: "permission", tool: "o2_search", args: {} };

    it("keeps Deny and Reply and the timer, and makes Finish in the primary", async () => {
      const wrapper = mountCard(cardOf(PAUSE, { expiresAt: Date.now() + 60_000 }), {
        gated: true,
        extendable: true,
      });
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-approval-approve"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="assistant-approval-extend"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="assistant-approval-countdown"]').exists()).toBe(true);
      expect(wrapper.get('[data-test="assistant-approval-gated"]').text()).toBe(
        "Approvals aren't available on this server. Finish this in Alerts.",
      );
      const finish = wrapper.get('[data-test="assistant-approval-finish-in"]');
      expect(finish.attributes("data-o2-variant")).toBe("primary");
      expect(wrapper.findAll('[data-test="assistant-approval-finish-in"]')).toHaveLength(1);
      expect(menuItems(wrapper)).toEqual(["assistant-approval-reply"]);
    });

    it("decides the gate when the card mounts, so an upgrade never changes a card being read", async () => {
      const wrapper = mountCard(cardOf(frame), { gated: true });
      await wrapper.setProps({ gated: false });
      expect(wrapper.find('[data-test="assistant-approval-approve"]').exists()).toBe(false);
    });
  });

  describe("question", () => {
    const question = (over: Partial<ApprovalCardView> = {}) =>
      cardOf(
        {
          type: "confirmation_required",
          id: "q1",
          tool: "ask_user",
          kind: "question",
          message: "Which folder should the alert go in?",
          options: [
            { id: "payments", label: "Payments" },
            { id: "platform", label: "Platform" },
          ],
          allow_other: true,
        },
        { id: "q1", expiresAt: Date.now() + 580_000, ...over },
      );

    it("asks its question with the choices, More time and Other answer last, and no Deny", async () => {
      const wrapper = mountCard(question(), { extendable: true });
      await flushPromises();
      expect(wrapper.get('[data-test="assistant-approval-card"]').attributes("aria-label")).toBe(
        "Needs your answer: Which folder should the alert go in?",
      );
      expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(
        "Which folder should the alert go in?",
      );
      expect(buttons(wrapper)).toEqual([
        "assistant-question-option-payments",
        "assistant-question-option-platform",
        "assistant-approval-extend",
        "assistant-question-other",
      ]);
    });

    it("drops footnote markers from its heading and draws the choices as full-width rows", async () => {
      const wrapper = mountCard(question({ question: "Which folder[^2] should it go in?" }));
      await flushPromises();
      expect(wrapper.get('[data-test="assistant-approval-heading"]').text()).toBe(
        "Which folder should it go in?",
      );
      expect(
        wrapper
          .get('[data-test="assistant-question-option-payments"]')
          .attributes("data-o2-variant"),
      ).toBe("row");
      expect(wrapper.get('[data-test="assistant-question-option-payments"]').classes()).toContain(
        "w-full",
      );
      expect(
        wrapper.get('[data-test="assistant-question-other"]').attributes("data-o2-variant"),
      ).toBe("dashed");
      expect(wrapper.get('[data-test="assistant-approval-strip-label"]').text()).toBe(
        "Needs your answer",
      );
    });

    it("sends a choice at once, and Other answer goes to the composer", async () => {
      const wrapper = mountCard(question());
      await flushPromises();
      await press(wrapper.get('[data-test="assistant-question-option-payments"]'));
      expect(wrapper.emitted("decide")?.[0][0]).toEqual({
        decision: {
          approved: false,
          reason: "answer",
          answer: "payments",
          answerLabel: "Payments",
        },
        approvalId: "q1",
      });
      await press(wrapper.get('[data-test="assistant-question-other"]'));
      expect(wrapper.emitted("reply")).toHaveLength(1);
    });
  });
});
