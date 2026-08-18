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

import OnCallRoutingList from "@/components/oncall/OnCallRoutingList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

/// The rule dialog and the catch-all picker are overlays: they portal their
/// content and only render it while open. Stubbed to nothing visible, because
/// this file is about the list — the dialog has its own spec.
const stubs = {
  OnCallRuleEditor: {
    name: "OnCallRuleEditor",
    props: [
      "open",
      "rule",
      "initialDimensions",
      "teamId",
      "teams",
      "aliases",
      "signals",
      "ladder",
      "saving",
    ],
    template: "<span />",
  },
  OPopover: {
    name: "OPopover",
    props: ["open"],
    template: "<span><slot name='trigger' /><slot /></span>",
  },
  ODropdown: { name: "ODropdown", template: "<span><slot name='trigger' /><slot /></span>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: `<button @click="$emit('select')"><slot /></button>`,
  },
  OTimeCell: { name: "OTimeCell", props: ["value", "unit"], template: "<span>5 days ago</span>" },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" />`,
  },
};

const ALIASES = [
  { id: "k8s-cluster", display: "K8s Cluster" },
  { id: "service", display: "Service" },
  { id: "k8s-namespace", display: "K8s Namespace" },
];

const TEAMS = [
  { id: "team_1", name: "Search" },
  { id: "team_2", name: "Payments" },
];

const BROAD = {
  rule_id: "r_broad",
  team_id: "team_1",
  path: "k8s-cluster=introspection",
  dimensions: { "k8s-cluster": "introspection" },
  created_at: 0,
  pages_caught: 2,
  last_matched_at: 1_700_000_000_000_000,
  health: "active",
  health_summary: "catching pages",
  shadowed_by: [],
} as any;

const NARROW = {
  rule_id: "r_narrow",
  team_id: "team_1",
  path: "k8s-cluster=introspection/service=query-planner",
  dimensions: { "k8s-cluster": "introspection", service: "query-planner" },
  created_at: 0,
  pages_caught: 0,
  last_matched_at: null,
  health: "active",
  health_summary: "never matched",
  shadowed_by: [],
} as any;

const SIGNALS = [
  {
    id: "s1",
    path: "service=fraud-scorer",
    dimensions: { service: "fraud-scorer", "k8s-namespace": "risk" },
    occurrences: 3,
    first_seen_at: 0,
    last_seen_at: 0,
    last_title: "fraud_scoring_stalled",
    description: "fraud_scoring_stalled",
  },
  {
    id: "s2",
    path: "service=billing-sync",
    dimensions: { service: "billing-sync" },
    occurrences: 6,
    first_seen_at: 0,
    last_seen_at: 0,
    last_title: "billing_sync_backlog",
    description: "billing_sync_backlog",
  },
] as any;

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRoutingList, {
    props: {
      rules: [BROAD, NARROW],
      signals: SIGNALS,
      aliases: ALIASES,
      teamId: "team_1",
      teamName: "Search",
      teams: TEAMS,
      onCallNow: [{ user_email: "mei@o2.ai" }],
      ladder: [{ priority: "P1", rungs: 3, pages_anyone: true, ends_with_whole_team: false }],
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallRoutingList", () => {
  /// The list claims the first matching row wins, so the rows have to be in
  /// the engine's own precedence order — the endpoint returns storage order.
  it("orders the rows most specific first", async () => {
    const wrapper = render();
    await flushPromises();
    const ids = wrapper
      .findAll('[data-test^="oncall-routing-row-"]')
      .map((row) => row.attributes("data-test"));
    expect(ids).toEqual(["oncall-routing-row-r_narrow", "oncall-routing-row-r_broad"]);
  });

  it("reads each condition in the org's own vocabulary", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-row-r_broad"]').text()).toContain(
      "K8s Cluster = introspection",
    );
  });

  /// Evidence replaces the health pill: what it caught, and when.
  it("shows what a rule caught, and says plainly when it caught nothing", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-caught-r_broad"]').text()).toContain("2 pages");
    expect(wrapper.find('[data-test="oncall-routing-row-r_narrow"]').text()).toContain(
      "never matched",
    );
  });

  /// Specificity is a note on the row it changes, not a column on every row —
  /// and it is the server's verdict, never a recomputed one.
  it("notes an overlap only where the server found one", async () => {
    const wrapper = render({
      rules: [
        BROAD,
        {
          ...NARROW,
          health: "shadowed",
          shadowed_by: [{ rule_id: "x", team_id: "team_2", path: "service=query-planner", outcome: "a service match beats a cluster match" }],
        },
      ],
    });
    await flushPromises();
    const note = wrapper.find('[data-test="oncall-routing-note-r_narrow"]').text();
    expect(note).toContain("overlaps a more specific row");
    expect(note).toContain("a service match beats a cluster match");
  });

  /// What a broad rule does NOT pin is the honest reading of how broad it is.
  it("names the axes a rule leaves open", async () => {
    const wrapper = render();
    await flushPromises();
    const note = wrapper.find('[data-test="oncall-routing-note-r_broad"]').text();
    expect(note).toContain("any Service");
    expect(note).toContain("any K8s Namespace");
  });

  /// "It pages" has to survive the question "who, right now" — a team name on
  /// its own does not answer it.
  it("says which ladder runs and who is holding it", async () => {
    const wrapper = render();
    await flushPromises();
    const row = wrapper.find('[data-test="oncall-routing-row-r_broad"]').text();
    expect(row).toContain("Search");
    expect(row).toContain("P1 ladder");
    expect(row).toContain("mei@o2.ai");
  });

  it("says when nobody is holding the pager", async () => {
    const wrapper = render({ onCallNow: [] });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-row-r_broad"]').text()).toContain(
      "nobody on call now",
    );
  });

  describe("the catch-all row", () => {
    /// Nothing auto-creates a default, so the unset state is the warning — and
    /// it sits in the row a reader reaches after the rules above fail.
    it("says nobody takes it when no catch-all is nominated", async () => {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-catch-all-team"]').text()).toBe("Nobody");
      expect(wrapper.find('[data-test="oncall-routing-catch-all-set"]').text()).toContain(
        "Set a catch-all team",
      );
    });

    it("names the nominated team once there is one", async () => {
      const wrapper = render({ defaultTeamId: "team_2" });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-catch-all-team"]').text()).toBe("Payments");
    });

    /// The row carries the volume that landed on it, which is the argument for
    /// nominating anybody at all.
    it("counts the signals and fires that landed in it", async () => {
      const wrapper = render();
      await flushPromises();
      const volume = wrapper.find('[data-test="oncall-routing-catch-all-volume"]').text();
      expect(volume).toContain("2 signals");
      expect(volume).toContain("9 fires");
    });

    /// The picker's empty string is a UI vocabulary; the wire takes null.
    it("clears the nomination by emitting null", async () => {
      const wrapper = render({ defaultTeamId: "team_2" });
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-catch-all-set"]').trigger("click");
      wrapper
        .findComponent('[data-test="oncall-routing-catch-all-select"]')
        .vm.$emit("update:modelValue", "");
      await wrapper.vm.$nextTick();
      await wrapper.find('[data-test="oncall-routing-catch-all-save"]').trigger("click");

      expect(wrapper.emitted("set-default")?.[0]?.[0]).toBeNull();
    });
  });

  describe("the queue attached to it", () => {
    it("lists what landed in the last row, with a claim per signal", async () => {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-unclaimed"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-routing-signal-s1"]').text()).toContain(
        "fraud_scoring_stalled",
      );
      expect(wrapper.find('[data-test="oncall-routing-claim-s1"]').text()).toContain(
        "Claim for Search",
      );
    });

    /// A dismissed row is the historical record, not the worklist.
    it("leaves dismissed signals out of the queue and its counts", async () => {
      const wrapper = render({ signals: [SIGNALS[0], { ...SIGNALS[1], dismissed_at: 7 }] });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-signal-s2"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-routing-catch-all-volume"]').text()).toContain(
        "1 signal",
      );
    });

    it("disappears entirely when nothing is unclaimed", async () => {
      const wrapper = render({ signals: [] });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-unclaimed"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-routing-catch-all-volume"]').text()).toContain(
        "nothing landed here",
      );
    });

    it("emits a dismissal for one signal", async () => {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-dismiss-s1"]').trigger("click");
      expect((wrapper.emitted("dismiss")?.[0]?.[0] as { id: string }).id).toBe("s1");
    });

    it("offers a bulk claim for the team whose screen this is", async () => {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-claim-all"]').trigger("click");
      expect(wrapper.emitted("claim-all")).toHaveLength(1);
    });
  });

  /// Add, edit and claim are the same three fields, so they are one dialog —
  /// which means each entry point has to hand it the right thing to edit.
  describe("the rule dialog", () => {
    const editor = (w: ReturnType<typeof render>) => w.findComponent({ name: "OnCallRuleEditor" });

    it("stays shut until something asks for it", async () => {
      const wrapper = render();
      await flushPromises();
      expect(editor(wrapper).props("open")).toBe(false);
    });

    it("opens empty from Add rule", async () => {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-list-add"]').trigger("click");
      expect(editor(wrapper).props("open")).toBe(true);
      expect(editor(wrapper).props("rule")).toBeNull();
      expect(editor(wrapper).props("initialDimensions")).toBeNull();
    });

    it("opens on the row Edit was pressed on", async () => {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-edit-r_broad"]').trigger("click");
      expect(editor(wrapper).props("rule")).toMatchObject({ rule_id: "r_broad" });
    });

    /// Claiming pre-fills from the signal's IDENTITY path only — a rule pinned
    /// to a pod name matches one incarnation of one process, then nothing.
    it("opens pre-filled from a claimed signal, without its evidence", async () => {
      const wrapper = render({
        signals: [
          {
            ...SIGNALS[0],
            dimensions: { ...SIGNALS[0].dimensions, "k8s-pod-name": "fraud-scorer-7d9" },
          },
        ],
      });
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-claim-s1"]').trigger("click");

      expect(editor(wrapper).props("initialDimensions")).toEqual({
        service: "fraud-scorer",
        "k8s-namespace": "risk",
      });
      expect(editor(wrapper).props("rule")).toBeNull();
    });

    it("closes itself and passes the draft up on save", async () => {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-routing-edit-r_broad"]').trigger("click");
      editor(wrapper).vm.$emit("save", { dimensions: { service: "api" }, team_id: "team_1" });
      await wrapper.vm.$nextTick();

      expect(editor(wrapper).props("open")).toBe(false);
      expect(wrapper.emitted("save-rule")?.[0]?.[0]).toMatchObject({
        dimensions: { service: "api" },
        team_id: "team_1",
        rule: { rule_id: "r_broad" },
      });
    });
  });

  /// A long rule set must not push the catch-all row and the queue below it off
  /// the screen — the two things a reader must never have to hunt for.
  describe("a long rule set", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...BROAD,
      rule_id: `r_${index}`,
      dimensions: { service: `svc-${index}` },
    }));

    it("scrolls the rules inside their own box", async () => {
      const wrapper = render({ rules: many });
      await flushPromises();
      const box = wrapper.find('[data-test="oncall-routing-rules-scroll"]');
      expect(box.exists()).toBe(true);
      expect(box.findAll('[data-test^="oncall-routing-row-"]')).toHaveLength(30);
    });

    it("keeps the catch-all row and the queue outside that box", async () => {
      const wrapper = render({ rules: many });
      await flushPromises();
      const box = wrapper.find('[data-test="oncall-routing-rules-scroll"]');
      expect(box.find('[data-test="oncall-routing-catch-all"]').exists()).toBe(false);
      expect(box.find('[data-test="oncall-routing-unclaimed"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-routing-catch-all"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-routing-unclaimed"]').exists()).toBe(true);
    });
  });

  it("emits a removal from the row's own menu", async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-delete-r_broad"]').trigger("click");
    expect((wrapper.emitted("remove")?.[0]?.[0] as { rule_id: string }).rule_id).toBe("r_broad");
  });

  it("asks the host to open the tester", async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-list-test"]').trigger("click");
    expect(wrapper.emitted("toggle-tester")).toHaveLength(1);
  });

  /// An empty rule set is not an empty screen: everything falls to the last
  /// row, and that row is still there saying so.
  it("keeps the catch-all row when there are no rules at all", async () => {
    const wrapper = render({ rules: [] });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-catch-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-no-rules"]').exists()).toBe(true);
  });
});
