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

import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
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

  it("opens pre-filled from the seed and asks once the input settles, at P1 by default", async () => {
    const wrapper = render({ seed: { service: "checkout" } });
    vi.advanceTimersByTime(350);
    expect(wrapper.emitted("run")?.at(-1)).toEqual([
      { dimensions: { service: "checkout" }, priority: "P1" },
    ]);
  });

  it("re-asks live when the priority changes, with no Test button", async () => {
    const wrapper = render({ seed: { service: "checkout" } });
    expect(wrapper.find('[data-test="oncall-simulator-run"]').exists()).toBe(false);
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

  it("uses the same condition rows as the rule editor", () => {
    const wrapper = render({ seed: { service: "checkout-*" } });
    expect(wrapper.findComponent({ name: "OnCallConditionRows" }).exists()).toBe(true);
    expect(select(wrapper, "oncall-simulator-op-0").props("modelValue")).toBe("prefix");
  });

  it("answers in one line: team, who is woken now, and the next step", async () => {
    vi.useRealTimers();
    escalationPreview.mockResolvedValue({
      data: {
        rungs: [
          { after_micros: 0, targets: [], recipients: [], resolves_to_nobody: false },
          {
            after_micros: 300_000_000,
            targets: [],
            recipients: [{ user_email: "raj@o2.ai" }],
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
    expect(answer).toContain("wakes ana@o2.ai now");
    expect(wrapper.find('[data-test="oncall-simulator-next"]').text()).toContain("raj@o2.ai");
  });

  it("says a silent priority pages nobody rather than naming the responder", async () => {
    const wrapper = render({ seed: { service: "payments-api" }, preview: preview() });
    select(wrapper, "oncall-simulator-priority").vm.$emit("update:modelValue", "P4");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="oncall-simulator-responder"]').text()).toBe("Pages nobody");
  });

  it("keeps the winning rule and the rules that lost under Why", () => {
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
    expect(wrapper.find('[data-test="oncall-simulator-won"]').text()).toContain(
      "service = payments-api",
    );
    const lost = wrapper.find('[data-test="oncall-simulator-also-r9"]').text();
    expect(lost).toContain("Checkout");
    expect(lost).toContain("fewer conditions");
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
