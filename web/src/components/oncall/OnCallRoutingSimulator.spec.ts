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

import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { orgUsersQuery } from "@/services/users.queries";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import type {
  OwnershipRuleStats,
  RoutingPreview,
  TestPageResult,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const escalationPreview = vi.fn();
vi.mock("@/services/oncall", () => ({
  default: { escalationPreview: (...args: unknown[]) => escalationPreview(...args) },
}));

/// OSelect is stubbed so a test can pick a value; the condition rows themselves are real.
const stubs = {
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label", "creatable"],
    emits: ["update:modelValue", "create"],
    template: "<span />",
  },
  OCollapsible: { name: "OCollapsible", props: ["label"], template: "<div><slot /></div>" },
};

function preview(over: Partial<RoutingPreview> = {}): RoutingPreview {
  return {
    decision: { kind: "ownership", path: "service=payments-api" },
    team_id: "team_1",
    reason: "routed by ownership rule",
    ladder: [
      {
        priority: "P1",
        rungs: 2,
        pages_anyone: true,
        nobody_after_micros: 300_000_000,
        ends_with_whole_team: false,
        channels: ["email", "sms"],
      },
      {
        priority: "P4",
        rungs: 0,
        pages_anyone: false,
        ends_with_whole_team: false,
        channels: [],
      },
    ],
    current_responder: {
      user_email: "ana@o2.ai",
      reason: "on call",
      would_a_page_land: true,
      deliverable_channels: ["email", "sms"],
    },
    also_matched: [],
    notes: [],
    ...over,
  } as RoutingPreview;
}

const SIGNALS = [
  {
    id: "s1",
    path: "service=checkout",
    dimensions: { service: "checkout", "k8s-pod-name": "pod-1" },
    occurrences: 5,
  },
] as unknown as UnroutedSignal[];

const RULES = [
  { rule_id: "r1", team_id: "team_1", dimensions: { "k8s-namespace": "payments" } },
] as unknown as OwnershipRuleStats[];

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRoutingSimulator, {
    props: {
      teams: [
        { id: "team_1", name: "Payments SRE" },
        { id: "team_2", name: "Checkout" },
      ],
      catalogue: { present: ["service", "k8s-namespace"], values: {} },
      signals: SIGNALS,
      rules: RULES,
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const select = (w: Wrapper, test: string) =>
  w.findAllComponents({ name: "OSelect" }).find((c) => c.attributes("data-test") === test)!;

describe("OnCallRoutingSimulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    escalationPreview.mockReset();
    escalationPreview.mockResolvedValue({ data: { rungs: [] } });
  });
  afterEach(() => vi.useRealTimers());

  it("tells the page when the license refuses the ladder read", async () => {
    escalationPreview.mockRejectedValue({
      response: { status: 403, data: { code: 40001, error_detail: "oncall" } },
    });
    const wrapper = render({ preview: preview() });
    await flushPromises();

    expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
  });

  it("opens pre-filled from the seed and asks once the input settles, at P1 by default", async () => {
    const wrapper = render({ seed: { service: "checkout" } });
    vi.advanceTimersByTime(350);
    expect(wrapper.emitted("run")?.at(-1)).toEqual([
      { dimensions: { service: "checkout" }, priority: "P1" },
    ]);
  });

  it("re-asks live when the priority changes", async () => {
    const wrapper = render({ seed: { service: "checkout" } });
    select(wrapper, "oncall-simulator-priority").vm.$emit("update:modelValue", "P3");
    await wrapper.vm.$nextTick();
    vi.advanceTimersByTime(350);
    expect(wrapper.emitted("run")?.at(-1)).toEqual([
      { dimensions: { service: "checkout" }, priority: "P3" },
    ]);
  });

  it("starts from a signal, a rule or a discovered service", async () => {
    const wrapper = render({ services: [{ name: "cart", setId: "default", identity: {} }] });
    const start = select(wrapper, "oncall-simulator-start");
    const values = (start.props("options") as { value?: string }[]).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(["signal:s1", "rule:r1", "service:cart"]));

    start.vm.$emit("update:modelValue", "signal:s1");
    await wrapper.vm.$nextTick();
    vi.advanceTimersByTime(350);
    expect(wrapper.emitted("run")?.at(-1)).toEqual([
      { dimensions: { service: "checkout" }, priority: "P1" },
    ]);

    start.vm.$emit("update:modelValue", "rule:r1");
    await wrapper.vm.$nextTick();
    vi.advanceTimersByTime(350);
    expect(wrapper.emitted("run")?.at(-1)).toEqual([
      { dimensions: { "k8s-namespace": "payments" }, priority: "P1" },
    ]);
  });

  /// A start names the conditions it filled in; once the rows say something else it would describe an alert nobody is testing.
  it("clears the start once the conditions no longer match it", async () => {
    const wrapper = render();
    const start = () => select(wrapper, "oncall-simulator-start");
    start().vm.$emit("update:modelValue", "rule:r1");
    await wrapper.vm.$nextTick();
    expect(start().props("modelValue")).toBe("rule:r1");

    wrapper
      .findComponent({ name: "OnCallConditionRows" })
      .vm.$emit("update:modelValue", { "k8s-namespace": "payments", service: "cart" });
    await wrapper.vm.$nextTick();
    expect(start().props("modelValue")).toBe(null);
  });

  it("keeps the start while the rows still say what it filled in", async () => {
    const wrapper = render();
    select(wrapper, "oncall-simulator-start").vm.$emit("update:modelValue", "rule:r1");
    await wrapper.vm.$nextTick();
    wrapper
      .findComponent({ name: "OnCallConditionRows" })
      .vm.$emit("update:modelValue", { "k8s-namespace": "payments" });
    await wrapper.vm.$nextTick();
    expect(select(wrapper, "oncall-simulator-start").props("modelValue")).toBe("rule:r1");
  });

  // A test describes one real alert, and no alert carries a literal trailing star.
  it("uses the rule editor's rows with only is, reading a prefix seed as its literal value", async () => {
    const wrapper = render({ seed: { service: "checkout-*" } });
    expect(wrapper.findComponent({ name: "OnCallConditionRows" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-simulator-op-0"]').text()).toBe("is");
    expect(select(wrapper, "oncall-simulator-op-0")).toBeUndefined();
    await flushPromises();
    vi.advanceTimersByTime(400);
    expect(wrapper.emitted("run")?.at(-1)?.[0]).toMatchObject({
      dimensions: { service: "checkout-" },
    });
  });

  it("answers in one line by name: team, who is woken now, and the next new person", async () => {
    vi.useRealTimers();
    queryClient.setQueryData(orgUsersQuery("default").queryKey, [
      { email: "ana@o2.ai", first_name: "Ana" },
      { email: "raj@o2.ai", first_name: "Raj" },
    ]);
    const lands = (email: string) => ({
      user_email: email,
      reason: "",
      would_a_page_land: true,
      deliverable_channels: ["email"],
    });
    escalationPreview.mockResolvedValue({
      data: {
        channels: ["email"],
        rungs: [
          {
            after_micros: 0,
            targets: [],
            recipients: [lands("ana@o2.ai")],
            resolves_to_nobody: false,
          },
          {
            after_micros: 300_000_000,
            targets: [],
            recipients: [lands("ana@o2.ai"), lands("raj@o2.ai")],
            resolves_to_nobody: false,
          },
        ],
      },
    });
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await flushPromises();
    await flushPromises();
    const answer = wrapper.find('[data-test="oncall-simulator-answer"]').text();
    expect(answer).toContain("→ Payments SRE");
    expect(answer).toContain("wakes Ana now");
    expect(answer).not.toContain("@");
    const next = wrapper.find('[data-test="oncall-simulator-next"]').text();
    expect(next).toContain("then Raj after 5m");
    expect(next).not.toContain("Ana");
    const ana = wrapper
      .findAllComponents(OnCallPersonName)
      .find((c) => c.props("email") === "ana@o2.ai");
    // The tooltip's two lines are OnCallPersonName's own contract, covered in its spec.
    expect(ana!.findComponent(OTooltip).exists()).toBe(true);
  });

  // The engine's current responder is one person; a first step paging Primary and Secondary wakes both.
  it("names everybody the first step pages as woken now, not only the current responder", async () => {
    vi.useRealTimers();
    queryClient.setQueryData(orgUsersQuery("default").queryKey, [
      { email: "ana@o2.ai", first_name: "Ana" },
      { email: "raj@o2.ai", first_name: "Raj" },
      { email: "kim@o2.ai", first_name: "Kim" },
    ]);
    const lands = (email: string) => ({
      user_email: email,
      reason: "",
      would_a_page_land: true,
      deliverable_channels: ["email", "sms"],
    });
    escalationPreview.mockResolvedValue({
      data: {
        channels: ["email", "sms"],
        rungs: [
          {
            after_micros: 0,
            targets: [],
            recipients: [lands("ana@o2.ai"), lands("raj@o2.ai")],
            resolves_to_nobody: false,
          },
          {
            after_micros: 300_000_000,
            targets: [],
            recipients: [lands("ana@o2.ai"), lands("raj@o2.ai"), lands("kim@o2.ai")],
            resolves_to_nobody: false,
          },
        ],
      },
    });
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await flushPromises();
    await flushPromises();
    const responder = wrapper.find('[data-test="oncall-simulator-responder"]').text();
    expect(responder).toBe("wakes Ana, Raj now (Email, SMS)");
    const next = wrapper.find('[data-test="oncall-simulator-next"]').text();
    expect(next).toBe("then Kim after 5m");
  });

  /// The server's reason can run to a sentence; it sits in the tooltip so the answer stays on one line.
  it("says why when nobody on the first step can receive a page", async () => {
    vi.useRealTimers();
    escalationPreview.mockResolvedValue({
      data: {
        channels: ["email"],
        rungs: [
          {
            after_micros: 0,
            targets: [],
            recipients: [
              {
                user_email: "ana@o2.ai",
                reason: "",
                would_a_page_land: false,
                why_not: "no verified channel",
                deliverable_channels: [],
              },
            ],
            resolves_to_nobody: false,
          },
        ],
      },
    });
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await flushPromises();
    await flushPromises();
    const responder = wrapper.find('[data-test="oncall-simulator-responder"]');
    expect(responder.text()).toBe("No channel can carry a page");
    expect(responder.findComponent(OTooltip).props("content")).toBe("no verified channel");
    expect(responder.classes()).toContain("text-status-error-text");
  });

  it("says a silent priority pages nobody rather than naming the responder", async () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    select(wrapper, "oncall-simulator-priority").vm.$emit("update:modelValue", "P4");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="oncall-simulator-responder"]').text()).toBe("Pages nobody");
  });

  it("disables Send a test page, with the reason, when the priority pages nobody", async () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    const button = () => wrapper.find('[data-test="oncall-simulator-send-test"]');
    expect(button().attributes("aria-disabled")).toBeUndefined();
    select(wrapper, "oncall-simulator-priority").vm.$emit("update:modelValue", "P4");
    await wrapper.vm.$nextTick();
    // Unavailable but still focusable, so a keyboard or screen-reader user reaches the reason.
    expect(button().attributes("aria-disabled")).toBe("true");
    expect(button().attributes("disabled")).toBeUndefined();
    const reasonId = button().attributes("aria-describedby");
    expect(wrapper.find(`[id="${reasonId}"]`).text()).toBe(
      "P4 pages nobody, so there is nothing to test",
    );
    await button().trigger("click");
    expect(wrapper.emitted("send-test")).toBeUndefined();
    const tip = wrapper
      .find('[data-test="oncall-simulator-send-test-wrap"]')
      .findComponent({ name: "OTooltip" });
    expect(tip.props("content")).toBe("P4 pages nobody, so there is nothing to test");
  });

  it("disables Send a test page, with the reason, when the first step reaches nobody", async () => {
    vi.useRealTimers();
    escalationPreview.mockResolvedValue({
      data: {
        channels: ["email"],
        rungs: [{ after_micros: 0, targets: [], recipients: [], resolves_to_nobody: true }],
      },
    });
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await flushPromises();
    await flushPromises();
    const button = wrapper.find('[data-test="oncall-simulator-send-test"]');
    expect(button.attributes("aria-disabled")).toBe("true");
    const reasonId = button.attributes("aria-describedby");
    expect(wrapper.find(`[id="${reasonId}"]`).text()).toBe(
      "Nobody is on call now, so there is nothing to test",
    );
    await button.trigger("click");
    expect(wrapper.emitted("send-test")).toBeUndefined();
    const tip = wrapper
      .find('[data-test="oncall-simulator-send-test-wrap"]')
      .findComponent({ name: "OTooltip" });
    expect(tip.props("content")).toBe("Nobody is on call now, so there is nothing to test");
  });

  it("keeps Send a test page enabled when the first step's people cannot receive a page", async () => {
    vi.useRealTimers();
    escalationPreview.mockResolvedValue({
      data: {
        channels: ["email"],
        rungs: [
          {
            after_micros: 0,
            targets: [],
            recipients: [
              {
                user_email: "ana@o2.ai",
                reason: "",
                would_a_page_land: false,
                why_not: "no verified channel",
                deliverable_channels: [],
              },
            ],
            resolves_to_nobody: false,
          },
        ],
      },
    });
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await flushPromises();
    await flushPromises();
    const button = wrapper.find('[data-test="oncall-simulator-send-test"]');
    expect(button.attributes("aria-disabled")).toBeUndefined();
    await button.trigger("click");
    expect(wrapper.emitted("send-test")?.at(-1)).toEqual([{ team_id: "team_1", priority: "P1" }]);
  });

  it("keeps Send a test page enabled while the escalation preview has not loaded", async () => {
    escalationPreview.mockReturnValue(new Promise(() => {}));
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await wrapper.vm.$nextTick();
    const button = wrapper.find('[data-test="oncall-simulator-send-test"]');
    expect(button.attributes("aria-disabled")).toBeUndefined();
    expect(
      wrapper
        .find('[data-test="oncall-simulator-send-test-wrap"]')
        .findComponent(OTooltip)
        .exists(),
    ).toBe(false);
  });

  it("says the winning rule inline and counts the less specific ones, with no expander", () => {
    const wrapper = render({
      seed: { service: "payments-api" },
      preview: preview({
        also_matched: [
          {
            rule_id: "r9",
            team_id: "team_2",
            team_name: "Checkout",
            path: "k8s-namespace=payments",
            same_team: false,
            lost_because: "fewer conditions",
          },
        ],
      }),
    });
    expect(wrapper.find('[data-test="oncall-simulator-won"]').text()).toBe(
      "Matched rule: Service = payments-api",
    );
    const also = wrapper.find('[data-test="oncall-simulator-also"]');
    expect(also.text()).toBe("Also matched, less specific: 1 rule");
    expect(also.attributes("tabindex")).toBe("0");
  });

  it("leaves out the less-specific line when no other rule matched", () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    expect(wrapper.find('[data-test="oncall-simulator-won"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-simulator-also"]').exists()).toBe(false);
  });

  it("says a miss in plain words, never the engine's k=v note", () => {
    const wrapper = render({
      seed: { service: "orphan" },
      preview: preview({
        decision: { kind: "unrouted" },
        team_id: null,
        current_responder: null,
        notes: ["no ownership rule covers service=orphan"],
      }),
    });
    expect(wrapper.find('[data-test="oncall-simulator-won"]').text()).toBe(
      "No rule matches, so nobody is paged",
    );
    expect(wrapper.text()).not.toContain("no ownership rule covers");
  });

  it("names the start the seed came from instead of a blank picker", () => {
    const wrapper = render({ seed: { "k8s-namespace": "payments" } });
    expect(select(wrapper, "oncall-simulator-start").props("modelValue")).toBe("rule:r1");
  });

  it("names nobody when no team owns the alert", () => {
    const wrapper = render({
      seed: { service: "orphan" },
      preview: preview({ team_id: null, current_responder: null }),
    });
    expect(wrapper.find('[data-test="oncall-simulator-team"]').text()).toBe("→ Nobody");
    expect(wrapper.find('[data-test="oncall-simulator-send-test"]').exists()).toBe(false);
  });

  it("sends a test page for the answered team at the chosen priority", async () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await wrapper.find('[data-test="oncall-simulator-send-test"]').trigger("click");
    expect(wrapper.emitted("send-test")?.[0]).toEqual([{ team_id: "team_1", priority: "P1" }]);
  });

  it("shows the test result only beside the inputs it was sent for", async () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    await wrapper.find('[data-test="oncall-simulator-send-test"]').trigger("click");
    const result: TestPageResult = {
      reached_anyone: true,
      not_sent_because: null,
      channels: ["email"],
      attempts: [
        { channel: "email", recipient: "ana@o2.ai", reason: "", delivered: true, detail: null },
      ],
    } as unknown as TestPageResult;
    await wrapper.setProps({ testResult: result });
    expect(wrapper.find('[data-test="oncall-simulator-test-result"]').exists()).toBe(true);

    select(wrapper, "oncall-simulator-priority").vm.$emit("update:modelValue", "P2");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="oncall-simulator-test-result"]').exists()).toBe(false);
  });

  it("asks for a condition instead of an empty answer", () => {
    const wrapper = render({ signals: [], rules: [] });
    expect(wrapper.find('[data-test="oncall-simulator-empty"]').exists()).toBe(true);
    expect(wrapper.emitted("run")).toBeUndefined();
  });
});
