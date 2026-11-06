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
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { orgUsersQuery } from "@/services/users.queries";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { OwnershipRuleStats, RoutingPreview, UnroutedSignal } from "@/ts/interfaces/oncall";

const whoIsOnCall = vi.fn();
vi.mock("@/services/oncall", () => ({
  default: { whoIsOnCall: (...args: unknown[]) => whoIsOnCall(...args) },
}));

/// The dialog portals its body; the form is what this file asserts on.
const stubs = {
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonDisabled", "primaryButtonLoading"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: "<div><slot /><slot name='footer-left' /></div>",
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label", "helpText", "disabled", "creatable", "searchable"],
    emits: ["update:modelValue", "create"],
    template: `<span><label>{{ label }}</label><small class="help">{{ helpText }}</small></span>`,
  },
};

const TEAMS = [
  { id: "team_1", name: "Search" },
  { id: "team_2", name: "Payments" },
];

const SIGNALS = [
  {
    id: "s1",
    path: "k8s-namespace=risk/service=fraud-scorer",
    dimensions: { "k8s-namespace": "risk", service: "fraud-scorer", "k8s-pod-name": "pod-1" },
    occurrences: 3,
  },
  {
    id: "s2",
    path: "k8s-namespace=risk/service=risk-api",
    dimensions: { "k8s-namespace": "risk", service: "risk-api" },
    occurrences: 6,
  },
] as unknown as UnroutedSignal[];

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRuleEditor, {
    props: {
      open: true,
      teamId: "team_1",
      teams: TEAMS,
      aliases: [
        { id: "service", display: "Service" },
        { id: "k8s-namespace", display: "K8s Namespace" },
      ],
      catalogue: {
        present: ["service", "k8s-namespace"],
        values: { service: { "risk-api": 2, checkout: 1 } },
      },
      signals: SIGNALS,
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const select = (w: Wrapper, test: string) =>
  w.findAllComponents({ name: "OSelect" }).find((c) => c.attributes("data-test") === test)!;

const dialog = (w: Wrapper) => w.findComponent({ name: "ODialog" });

describe("OnCallRuleEditor", () => {
  beforeEach(() => {
    queryClient.clear();
    whoIsOnCall.mockReset();
    whoIsOnCall.mockResolvedValue({ data: [] });
  });

  it("tells the page when the license refuses the who-is-on-call read", async () => {
    whoIsOnCall.mockRejectedValue({
      response: { status: 403, data: { code: 40001, error_detail: "oncall" } },
    });
    const wrapper = render({ initialDimensions: { "k8s-namespace": "risk" } });
    await flushPromises();

    expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
  });

  /// A path nothing claims is judged on the draft's conditions alone, so no conflict is named.
  it("names only the drafted team when nothing claims the path", async () => {
    const wrapper = render({
      initialDimensions: { "k8s-namespace": "risk" },
      conflict: { decision: null, team_id: null },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-outcome"]').text()).toBe(
      "Future alerts like this go to Search",
    );
  });

  it("opens a new rule on one live row, field preset to service", () => {
    const wrapper = render();
    expect(wrapper.findAll('[data-test^="oncall-rule-editor-row-"]')).toHaveLength(1);
    expect(select(wrapper, "oncall-rule-editor-field-0").props("modelValue")).toBe("service");
    expect(wrapper.find('[data-test="oncall-rule-editor-value-0"]').exists()).toBe(true);
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
  });

  it("picking a value is adding the condition", async () => {
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "risk-api");
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")?.[0]).toEqual([
      { dimensions: { service: "risk-api" }, team_id: "team_1" },
    ]);
  });

  // Counts exist only for values that needed an owner, so none carries one rather than some.
  it("offers known values busiest first, with no count on any of them", () => {
    const wrapper = render();
    const options = select(wrapper, "oncall-rule-editor-value-0").props("options") as {
      value: string;
      subLabel?: string;
    }[];
    expect(options[0].value).toBe("risk-api");
    expect(options.map((o) => o.value)).toContain("checkout");
    expect(options.every((o) => o.subLabel === undefined)).toBe(true);
  });

  it("writes starts with as the engine's trailing *", async () => {
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-op-0").vm.$emit("update:modelValue", "prefix");
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("create", "checkout-");
    await flushPromises();
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")?.[0]).toEqual([
      { dimensions: { service: "checkout-*" }, team_id: "team_1" },
    ]);
  });

  it("blocks Save on a row with a field but no value, and drops a fully empty row", async () => {
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "risk-api");
    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);

    select(wrapper, "oncall-rule-editor-field-1").vm.$emit("update:modelValue", "k8s-namespace");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-pick-value-1"]').text()).toBe(
      "Pick a value",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    expect(wrapper.find('[data-test="oncall-rule-editor-save-problem"]').text()).toBe(
      "Pick a value",
    );
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")).toBeUndefined();

    await wrapper.find('[data-test="oncall-rule-editor-remove-1"]').trigger("click");
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")?.[0]).toEqual([
      { dimensions: { service: "risk-api" }, team_id: "team_1" },
    ]);
  });

  it("never saves an edited two-condition rule with one value cleared or one field changed", async () => {
    const rule = {
      rule_id: "r1",
      team_id: "team_1",
      path: "k8s-namespace=prod/service=payments",
      dimensions: { "k8s-namespace": "prod", service: "payments" },
    } as unknown as OwnershipRuleStats;
    const wrapper = render({ rule });
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", null);
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-pick-value-0"]').exists()).toBe(true);
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);

    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "prod");
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);

    select(wrapper, "oncall-rule-editor-field-0").vm.$emit("update:modelValue", "environment");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-pick-value-0"]').text()).toBe(
      "Pick a value",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("does not offer a field twice", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    const fields = (
      select(wrapper, "oncall-rule-editor-field-1").props("options") as {
        value: string;
      }[]
    ).map((o) => o.value);
    expect(fields).toEqual(["k8s-namespace"]);
  });

  it("starts from a signal that needs an owner, identity dimensions only", async () => {
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-signals").vm.$emit("update:modelValue", "s1");
    await flushPromises();
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("save")?.[0]).toEqual([
      {
        dimensions: { "k8s-namespace": "risk", service: "fraud-scorer" },
        team_id: "team_1",
      },
    ]);
  });

  it("opens an existing wildcard rule as a starts with row", () => {
    const rule = {
      rule_id: "r1",
      team_id: "team_2",
      path: "service=checkout-*",
      dimensions: { service: "checkout-*" },
    } as unknown as OwnershipRuleStats;
    const wrapper = render({ rule });
    expect(select(wrapper, "oncall-rule-editor-op-0").props("modelValue")).toBe("prefix");
    expect(select(wrapper, "oncall-rule-editor-value-0").props("modelValue")).toBe("checkout-");
    expect(select(wrapper, "oncall-rule-editor-team").props("modelValue")).toBe("team_2");
    expect(wrapper.find('[data-test="oncall-rule-editor-signals"]').exists()).toBe(false);
  });

  it("states one outcome: where future alerts go and how many waiting signals it catches", async () => {
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "risk-api");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-outcome"]').text()).toBe(
      "Future alerts like this go to Search · catches 1 signal that needs an owner",
    );
  });

  it("counts the waiting signals alone while no team is picked", async () => {
    const wrapper = render({ teamId: "" });
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "risk-api");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-outcome"]').text()).toBe(
      "Matches 1 of the signals that need an owner",
    );
  });

  it("offers fields the signals and existing rules use, labelled in sentence case", async () => {
    const wrapper = render({
      catalogue: { present: ["service"], values: {} },
      rules: [{ rule_id: "r1", team_id: "team_2", dimensions: { environment: "prod" } }],
    });
    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    const fields = select(wrapper, "oncall-rule-editor-field-1").props("options") as {
      label: string;
      value: string;
    }[];
    expect(fields.map((o) => o.value)).toEqual(["k8s-namespace", "environment"]);
    expect(fields[0].label).toBe("K8s namespace");
  });

  /// A claim names an owner for one signal: the title says whose, and the outcome says where alerts like it go.
  it("titles a claim for its team and states where future alerts go", async () => {
    const wrapper = render({
      open: false,
      teamId: "team_2",
      initialDimensions: { "k8s-namespace": "risk", service: "fraud-scorer" },
    });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(dialog(wrapper).props("title")).toBe("Claim for Payments");
    const outcome = wrapper.find('[data-test="oncall-rule-editor-outcome"]').text();
    expect(outcome).toBe("Future alerts like this go to Payments");
    expect(outcome).not.toContain("Matches");
  });

  it("asks for an owner, with no queue count, until a claim has a team", async () => {
    const wrapper = render({
      open: false,
      teamId: "",
      initialDimensions: { "k8s-namespace": "risk", service: "fraud-scorer" },
    });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(dialog(wrapper).props("title")).toBe("Give it an owner");
    expect(wrapper.find('[data-test="oncall-rule-editor-outcome"]').exists()).toBe(false);
  });

  // A claim arrives as dimensions; the picker names the signal they came from instead of "Choose…".
  it("names the claimed signal in the start-from picker", async () => {
    const wrapper = render({
      initialDimensions: { "k8s-namespace": "risk", service: "fraud-scorer" },
    });
    await flushPromises();
    expect(select(wrapper, "oncall-rule-editor-signals").props("modelValue")).toBe("s1");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true, initialDimensions: null });
    expect(select(wrapper, "oncall-rule-editor-signals").props("modelValue")).toBeNull();
  });

  // Two operators need no search box.
  it("offers the operator as a plain two-option list", () => {
    const op = select(render(), "oncall-rule-editor-op-0");
    expect(op.props("searchable")).toBe(false);
    expect(op.props("options")).toHaveLength(2);
  });

  it("names the team it takes alerts from when another team holds a broader path", async () => {
    const conflict = {
      team_id: "team_2",
      decision: { path: "k8s-namespace=risk" },
    } as unknown as RoutingPreview;
    const wrapper = render({
      conflict,
      initialDimensions: { "k8s-namespace": "risk", service: "risk-api" },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-outcome"]').text()).toBe(
      "Takes alerts from Payments",
    );
  });

  it("shows who is on call now for the picked team", async () => {
    whoIsOnCall.mockResolvedValue({ data: [{ user_email: "ana@example.com" }] });
    queryClient.setQueryData(orgUsersQuery("default").queryKey, [
      { email: "ana@example.com", first_name: "Ana", last_name: "Silva" },
    ]);
    const wrapper = render();
    await flushPromises();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-on-call"]').text()).toBe(
      "On call now: Ana Silva",
    );
    const person = wrapper.findComponent(OnCallPersonName);
    // The tooltip's two lines are OnCallPersonName's own contract, covered in its spec.
    expect(person.props("email")).toBe("ana@example.com");
    expect(person.findComponent(OTooltip).exists()).toBe(true);
  });

  it("hides the on-call line when the schedule cannot be read", async () => {
    whoIsOnCall.mockRejectedValue(new Error("403"));
    const wrapper = render();
    await flushPromises();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-on-call"]').exists()).toBe(false);
  });

  it("asks the host who holds the drafted path once the conditions settle", async () => {
    vi.useFakeTimers();
    const wrapper = render();
    select(wrapper, "oncall-rule-editor-value-0").vm.$emit("update:modelValue", "risk-api");
    await wrapper.vm.$nextTick();
    vi.advanceTimersByTime(350);
    const previews = wrapper.emitted("preview") ?? [];
    expect(previews[previews.length - 1]).toEqual([{ service: "risk-api" }]);
    vi.useRealTimers();
  });
});
