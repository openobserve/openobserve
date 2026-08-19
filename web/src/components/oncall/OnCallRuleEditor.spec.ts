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
import { describe, expect, it } from "vitest";

import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

/// The dialog portals its body and renders its Save/Cancel in a footer this
/// file never sees, so it is replaced by a plain wrapper — the assertions are
/// about the form, and the footer's own wiring is ODialog's contract.
const stubs = {
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonDisabled", "primaryButtonLoading", "neutralButtonLabel"],
    emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
    template: "<div><slot /></div>",
  },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" />`,
  },
};

const TEAMS = [
  { id: "team_1", name: "Search" },
  { id: "team_2", name: "Payments" },
];

const ALIASES = [
  { id: "k8s-cluster", display: "K8s Cluster" },
  { id: "k8s-namespace", display: "K8s Namespace" },
  { id: "service", display: "Service" },
];

const SIGNALS = [
  {
    id: "s1",
    dimensions: { "k8s-namespace": "risk", service: "fraud-scorer", "k8s-pod-name": "pod-1" },
    occurrences: 3,
    last_title: "fraud_scoring_stalled",
    description: "fraud_scoring_stalled",
  },
  {
    id: "s2",
    dimensions: { "k8s-namespace": "risk", service: "risk-api" },
    occurrences: 6,
    last_title: "risk_api_slow",
    description: "risk_api_slow",
  },
  {
    id: "s3",
    dimensions: { "k8s-namespace": "billing", service: "billing-sync" },
    occurrences: 3,
    last_title: "billing_sync_backlog",
    description: "billing_sync_backlog",
  },
] as any;

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRuleEditor, {
    props: {
      open: true,
      teamId: "team_1",
      teams: TEAMS,
      aliases: ALIASES,
      signals: SIGNALS,
      ladder: [{ priority: "P1", rungs: 3, pages_anyone: true, ends_with_whole_team: false }],
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const dialog = (w: Wrapper) => w.findComponent({ name: "ODialog" });

async function addCondition(wrapper: Wrapper, name: string, value: string) {
  await wrapper
    .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
    .vm.$emit("update:modelValue", name);
  await wrapper.find('[data-test="oncall-rule-editor-dimension-value"]').setValue(value);
  await wrapper.find('[data-test="oncall-rule-editor-confirm-condition"]').trigger("click");
}

describe("OnCallRuleEditor", () => {
  it("opens empty for a new rule and seeds from the rule being edited", async () => {
    const wrapper = render({
      rule: { rule_id: "r1", team_id: "team_2", dimensions: { "k8s-cluster": "introspection" } },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-cluster"]').text()).toContain(
      "K8s Cluster = introspection",
    );
  });

  /// A claim arrives with the signal's identity path already filled — the click
  /// worth removing is the one where the user retypes what is on screen.
  it("seeds from a claim's pre-filled dimensions", async () => {
    const wrapper = render({ initialDimensions: { "k8s-namespace": "risk" } });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-namespace"]').exists()).toBe(
      true,
    );
  });

  /// The server lowercases values before matching. Writing one string and
  /// reading back another is how a rule that looks right catches nothing.
  it("normalises a value the way the server will store it", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-cluster", "  PROD ");
    expect(wrapper.text()).toContain("K8s Cluster = prod");
    expect(wrapper.text()).not.toContain("PROD");
  });

  /// The placeholder was `k8s-namespace` — a real, valid dimension key — on a
  /// select, so the field read as already filled while `draftName` was "". Add
  /// and Save stayed disabled, no request was made, and nothing on screen said
  /// why: the dialog simply never became usable.
  it("says why Add is refused instead of going quiet", async () => {
    // A new rule opens with the adder already showing — which is exactly the
    // state that used to look filled and refuse to save.
    const wrapper = render();
    await flushPromises();

    const problem = () => wrapper.find('[data-test="oncall-rule-editor-dimension-problem"]').text();
    expect(problem()).toContain("Pick the dimension");

    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
      .vm.$emit("update:modelValue", "k8s-cluster");
    expect(problem()).toContain("value it has to equal");

    await wrapper.find('[data-test="oncall-rule-editor-dimension-value"]').setValue("prod");
    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-problem"]').exists()).toBe(false);
  });

  /// A rule pinning the same dimension twice cannot mean anything, and the
  /// second value would silently win.
  it("refuses a duplicate condition name", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-cluster", "prod");

    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
      .vm.$emit("update:modelValue", "k8s-cluster");
    await wrapper.find('[data-test="oncall-rule-editor-dimension-value"]').setValue("staging");

    expect(
      wrapper.find('[data-test="oncall-rule-editor-confirm-condition"]').attributes("disabled"),
    ).toBeDefined();
    // And it says which dimension is already spoken for, rather than leaving
    // the reader to compare the row against the list above it.
    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-problem"]').text()).toContain(
      "k8s-cluster",
    );
  });

  it("cannot be saved with no condition", async () => {
    const wrapper = render();
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);

    await addCondition(wrapper, "service", "api");
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
  });

  it("emits the dimensions and the team on save", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-namespace", "risk");
    dialog(wrapper).vm.$emit("click:primary");

    expect(wrapper.emitted("save")?.[0]?.[0]).toEqual({
      dimensions: { "k8s-namespace": "risk" },
      team_id: "team_1",
    });
  });

  /// The replay is the verification, and it counts both halves: how many
  /// distinct signals the rule takes and how often they actually fired.
  it("replays the draft against the unrouted queue", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-namespace", "risk");

    const summary = wrapper.find('[data-test="oncall-rule-editor-catch-summary"]').text();
    expect(summary).toContain("2 signals");
    expect(summary).toContain("9 fires");
  });

  it("says so when a draft would catch nothing in the queue", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-namespace", "nowhere");
    expect(wrapper.find('[data-test="oncall-rule-editor-catch-summary"]').text()).toContain(
      "Nothing in the unrouted queue",
    );
  });

  /// Starting from a signal keeps only the identity dimensions: a rule pinned
  /// to a pod name matches one incarnation of one process, then nothing.
  it("starts from a signal without pinning its evidence", async () => {
    const wrapper = render();
    await flushPromises();
    wrapper
      .findComponent('[data-test="oncall-rule-editor-from-signal"]')
      .vm.$emit("update:modelValue", "s1");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="oncall-rule-editor-condition-service"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-pod-name"]').exists()).toBe(
      false,
    );
  });

  /// "Page" has to say what paging means, or it is a team name with no
  /// consequence attached.
  it("names the ladder a page would run", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-ladder"]').text()).toContain("P1 ladder");
  });

  it("says when the target team has no ladder that wakes anybody", async () => {
    const wrapper = render({
      ladder: [{ priority: "P1", rungs: 0, pages_anyone: false, ends_with_whole_team: false }],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-ladder"]').text()).toContain(
      "no escalation ladder yet",
    );
  });

  /// The row is Edit and nothing else, so removing a rule is a decision made
  /// about the one already open — and only ever about an existing one.
  describe("removing the rule", () => {
    const dialog = (w: ReturnType<typeof render>) => w.findComponent({ name: "ODialog" });

    it("offers no removal while writing a new rule", async () => {
      const wrapper = render();
      await flushPromises();
      expect(dialog(wrapper).props("neutralButtonLabel")).toBeUndefined();
    });

    it("passes the removal up so the host can confirm it", async () => {
      const wrapper = render({
        rule: { rule_id: "r1", team_id: "team_1", dimensions: { "k8s-cluster": "introspection" } },
      });
      await flushPromises();
      expect(dialog(wrapper).props("neutralButtonLabel")).toBe("Remove rule");

      dialog(wrapper).vm.$emit("click:neutral");
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("remove")).toHaveLength(1);
    });
  });
});
