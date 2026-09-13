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
  /// Label and help text are rendered so the assertions can read what the
  /// field says about itself — both are part of this form's contract now that
  /// the rule is asked as labelled fields rather than a sentence.
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label", "helpText"],
    emits: ["update:modelValue"],
    template: `<span><label>{{ label }}</label><select :value="modelValue" /><small>{{ helpText }}</small></span>`,
  },
  OCombobox: {
    name: "OCombobox",
    props: ["modelValue", "items", "label"],
    emits: ["update:modelValue"],
    template: `<span><label>{{ label }}</label><input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></span>`,
  },
  /// The chip's own two-segment rendering is its spec's business; here it only
  /// has to say which condition it carries.
  ODimensionChip: {
    name: "ODimensionChip",
    props: ["dimKey", "keyLabel", "value", "removable"],
    emits: ["remove"],
    template: `<span><span class="chip-label">{{ keyLabel || dimKey }} = {{ value }}</span><button class="chip-remove" @click="$emit('remove')" /></span>`,
  },
  OTimeCell: { name: "OTimeCell", props: ["value", "unit"], template: `<span />` },
  /// Rendered inline so the menu's contents are assertable without driving the
  /// real popup open; that it IS a menu is asserted through its trigger.
  ODropdown: {
    name: "ODropdown",
    props: ["align", "contentClass"],
    template: "<div><slot name='trigger' /><slot /></div>",
  },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["textValue"],
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
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
  await wrapper
    .findComponent('[data-test="oncall-rule-editor-dimension-value"]')
    .vm.$emit("update:modelValue", value);
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

  /// The chip is the control: dismissing a condition is a click on the thing
  /// it names, not on a button parked beside it.
  it("drops a condition from its own chip", async () => {
    const wrapper = render({
      initialDimensions: { "k8s-namespace": "risk", service: "risk-api" },
    });
    await flushPromises();

    await wrapper
      .find('[data-test="oncall-rule-editor-condition-service"] .chip-remove')
      .trigger("click");

    expect(wrapper.find('[data-test="oncall-rule-editor-condition-service"]').exists()).toBe(false);
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

    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-value"]')
      .vm.$emit("update:modelValue", "prod");
    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-problem"]').exists()).toBe(false);
  });

  /// A rule pinning the same dimension twice cannot mean anything, and the
  /// second value would silently win.
  it("refuses a duplicate condition name", async () => {
    const wrapper = render();
    await flushPromises();
    // The row stays open after a commit, ready for the next condition — no
    // second click on "Add condition" needed to write a second one.
    await addCondition(wrapper, "k8s-cluster", "prod");

    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
      .vm.$emit("update:modelValue", "k8s-cluster");
    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-value"]')
      .vm.$emit("update:modelValue", "staging");

    expect(
      wrapper.find('[data-test="oncall-rule-editor-confirm-condition"]').attributes("disabled"),
    ).toBeDefined();
    // And it says which dimension is already spoken for, rather than leaving
    // the reader to compare the row against the list above it.
    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-problem"]').text()).toContain(
      "k8s-cluster",
    );
  });

  /// Closing the row on every commit turned a multi-condition rule into a
  /// click-Add-condition-again per condition. The row stays put so entering
  /// several is Dimension, Value, Add, Dimension, Value, Add.
  it("keeps the adder open after a commit so a second condition needs no reopening", async () => {
    const wrapper = render();
    await flushPromises();
    await addCondition(wrapper, "k8s-cluster", "prod");

    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-name"]').exists()).toBe(true);
    expect(
      wrapper.findComponent('[data-test="oncall-rule-editor-dimension-name"]').props("modelValue"),
    ).toBe("");

    await addCondition(wrapper, "k8s-namespace", "risk");
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-cluster"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-namespace"]').exists()).toBe(
      true,
    );
  });

  /// Two chips side by side read as an either/or just as easily as an and, and
  /// the difference is the whole meaning of the rule.
  it("spells out the conjunction between conditions", async () => {
    const wrapper = render({
      initialDimensions: { "k8s-namespace": "risk", service: "risk-api" },
    });
    await flushPromises();
    // One "and": between the two chips, not before the first.
    expect(wrapper.findAll('[data-test="oncall-rule-editor-and"]')).toHaveLength(1);

    // Still one while a third is being written: the adder is a labelled row of
    // its own, not another clause in the list.
    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    expect(wrapper.findAll('[data-test="oncall-rule-editor-and"]')).toHaveLength(1);
  });

  /// The only way out of the adder used to be to finish it: a half-written
  /// condition left Add disabled and the row parked in the sentence.
  it("discards a half-written condition without adding it", async () => {
    const wrapper = render({ initialDimensions: { service: "risk-api" } });
    await flushPromises();

    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
      .vm.$emit("update:modelValue", "k8s-cluster");
    await wrapper.find('[data-test="oncall-rule-editor-cancel-condition"]').trigger("click");

    expect(wrapper.find('[data-test="oncall-rule-editor-dimension-name"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-cluster"]').exists()).toBe(
      false,
    );
    // The draft went with it — reopening the adder starts clean.
    await wrapper.find('[data-test="oncall-rule-editor-add-condition"]').trigger("click");
    expect(
      wrapper.findComponent('[data-test="oncall-rule-editor-dimension-name"]').props("modelValue"),
    ).toBe("");
  });

  /// With no condition there is nothing to go back to, and a rule cannot be
  /// saved without one — a cancel there would only empty the dialog.
  it("offers no discard on the first condition", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-cancel-condition"]').exists()).toBe(false);
  });

  /// The hands are already on the value field; reaching for Add is the slow
  /// half of writing a two-condition rule.
  it("commits the condition on Enter in the value field", async () => {
    const wrapper = render();
    await flushPromises();

    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-name"]')
      .vm.$emit("update:modelValue", "service");
    await wrapper
      .findComponent('[data-test="oncall-rule-editor-dimension-value"]')
      .vm.$emit("update:modelValue", "risk-api");
    await wrapper.find('[data-test="oncall-rule-editor-dimension-value"]').trigger("keyup.enter");

    expect(wrapper.find('[data-test="oncall-rule-editor-condition-service"]').exists()).toBe(true);
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

    expect(wrapper.find('[data-test="oncall-rule-editor-catch-count"]').text()).toContain(
      "9 pages match",
    );
    expect(wrapper.find('[data-test="oncall-rule-editor-catch-s1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-rule-editor-catch-s3"]').exists()).toBe(false);
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
    await wrapper.find('[data-test="oncall-rule-editor-signal-s1"]').trigger("click");

    expect(wrapper.find('[data-test="oncall-rule-editor-condition-service"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-rule-editor-condition-k8s-pod-name"]').exists()).toBe(
      false,
    );
  });

  /// The queue used to be printed open above an empty form: three paths of raw
  /// dimensions to read before the first field. It is one control now, and it
  /// stands down once the draft is the thing being judged.
  it("offers the queue behind one control, and drops it once a condition exists", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-rule-editor-signals"]').text()).toContain(
      "Start from a signal",
    );

    await addCondition(wrapper, "k8s-namespace", "risk");

    expect(wrapper.find('[data-test="oncall-rule-editor-signals"]').exists()).toBe(false);
  });

  /// Two different emergencies share the queue: a path the catch-all absorbed
  /// paged the wrong team, one without a default paged nobody at all. The row a
  /// rule is started from has to say which it was.
  it("says what each startable signal did before offering it", async () => {
    const wrapper = render({
      signals: [{ ...SIGNALS[0], defaulted_team_id: "team_2" }, SIGNALS[1]],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-editor-signal-s1"]').text()).toContain(
      "sent to Payments",
    );
    expect(wrapper.find('[data-test="oncall-rule-editor-signal-s2"]').text()).toContain(
      "No one notified",
    );
  });

  /// The panel is a check, not a list — past the shown rows the remainder is
  /// counted, and it names the team they would all page from now on.
  it("counts the matches it does not show and names their new owner", async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...SIGNALS[1],
      id: `m${index}`,
      last_title: `risk_api_slow_${index}`,
    })) as any;
    const wrapper = render({ signals: many });
    await flushPromises();
    await addCondition(wrapper, "k8s-namespace", "risk");

    const more = wrapper.find('[data-test="oncall-rule-editor-catch-more"]').text();
    expect(more).toContain("2 more");
    expect(more).toContain("Search");
  });

  /// "Page" has to say what paging means, or it is a team name with no
  /// consequence attached.
  it("names the ladder a page would run", async () => {
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.findComponent('[data-test="oncall-rule-editor-team"]').props("helpText"),
    ).toContain("P1 ladder");
  });

  it("says when the target team has no ladder that wakes anybody", async () => {
    const wrapper = render({
      ladder: [{ priority: "P1", rungs: 0, pages_anyone: false, ends_with_whole_team: false }],
    });
    await flushPromises();
    expect(
      wrapper.findComponent('[data-test="oncall-rule-editor-team"]').props("helpText"),
    ).toContain("no escalation ladder yet");
  });

  /// A host serving more than one team (the org-level dialog) cannot ship a
  /// static `ladder` prop — it has to be told which team is picked so it can
  /// fetch that team's own ladder.
  it("emits team-change with the seeded team when it opens", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.emitted("team-change")?.[0]).toEqual(["team_1"]);
  });

  it("emits an empty team-change when it reopens with no team chosen", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.emitted("team-change")?.[0]).toEqual(["team_1"]);

    // Same long-lived editor instance, closed and reopened for a fresh rule
    // with no team pre-selected — the host must be told to drop the
    // previous team's ladder rather than keep showing it under the new form.
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true, teamId: "", rule: null });
    await flushPromises();
    expect(wrapper.emitted("team-change")?.at(-1)).toEqual([""]);
  });

  it("emits team-change when a different team is picked from the dropdown", async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper
      .findComponent('[data-test="oncall-rule-editor-team"]')
      .vm.$emit("update:modelValue", "team_2");
    expect(wrapper.emitted("team-change")?.at(-1)).toEqual(["team_2"]);
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
