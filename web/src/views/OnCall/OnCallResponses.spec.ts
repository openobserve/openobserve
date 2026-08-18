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

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallResponses from "@/views/OnCall/OnCallResponses.vue";

vi.mock("@/services/oncall", () => ({
  RESPONSE_PAGE_LIMIT: 200,
  default: {
    listResponses: vi.fn(),
    listTeams: vi.fn(),
    coverageGaps: vi.fn(),
    whoIsOnCall: vi.fn(),
    listOwnershipRules: vi.fn(),
    acknowledgeResponse: vi.fn(),
    resolveResponse: vi.fn(),
    snoozeResponse: vi.fn(),
    getPolicy: vi.fn(),
    getSchedule: vi.fn(),
    escalationProgress: vi.fn(),
    getResponse: vi.fn(),
  },
}));

// The permission probe reads the org member list. Left unmocked it would fire
// a real request from every test in this file.
vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

const push = vi.fn();
const routeQuery: Record<string, string> = {};
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: routeQuery }),
}));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  // Renders the real cell slots, so the tests exercise what the page actually
  // draws rather than a column-def function OTable never calls.
  OTable: {
    name: "OTable",
    props: [
      "data",
      "rowRailTone",
      "rowTone",
      "columns",
      "selectedIds",
      "isRowSelectable",
      "error",
      "sortBy",
      "sortOrder",
      "columnVisibility",
      "rowSection",
      "sectionOrder",
    ],
    emits: ["update:selectedIds"],
    // Sections are resolved the way the real component resolves them, so these
    // tests exercise the view's own `rowSection` rather than a stub's guess.
    computed: {
      sectionKeys(): string[] {
        if (!this.rowSection) return [];
        const seen: string[] = [];
        for (const row of this.data || []) {
          const key = this.rowSection(row);
          if (key && !seen.includes(key)) seen.push(key);
        }
        const order: string[] = this.sectionOrder || [];
        const rank = (k: string) => (order.indexOf(k) === -1 ? order.length : order.indexOf(k));
        return seen.sort((a, b) => rank(a) - rank(b));
      },
    },
    template: `<div>
      <slot name='toolbar' /><slot name='toolbar-trailing' /><slot name='subheader' />
      <div v-for="key in sectionKeys" :key="key" :data-test="'section-' + key">
        <slot name='group-header' :section-key="key" :rows="[]" />
      </div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
      <slot name='empty' />
      <slot name='bottom' />
      <slot v-if="error" name='error' />
    </div>`,
  },
  OStatStrip: {
    name: "OStatStrip",
    props: ["items", "selectedKey"],
    emits: ["select"],
    template: "<div />",
  },
  OnCallSetupChecklist: {
    name: "OnCallSetupChecklist",
    props: ["hasTeam", "hasStaffedRotation", "hasRouting", "canConfigure", "firstTeamId"],
    template: "<div data-test='oncall-setup-checklist' />",
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel"],
    template: "<div />",
  },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
  },
  // Stubbed like the rest of the family: unstubbed they pull reka-ui into every
  // row's action cell, which pushed several mounts past the 5s test timeout.
  ODropdownGroup: { name: "ODropdownGroup", props: ["label"], template: "<div><slot /></div>" },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OEmptyState: {
    name: "OEmptyState",
    props: ["preset", "filtered"],
    template: "<div :data-preset='preset' />",
  },
  OSelect: { name: "OSelect", props: ["options", "disabled", "width"], template: "<select />" },
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  // Mirrors the real OButton: `emits` declared (without it the listener also
  // falls through and every handler runs twice), and the event is passed on,
  // which row actions need in order to stop the row-click navigating.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="(e) => $emit('click', e)"><slot /></button>`,
  },
};

const team = {
  id: "team_1",
  org_id: "default",
  name: "Platform",
  timezone: "UTC",
  created_at: 0,
  updated_at: 0,
};

function render() {
  return mount(OnCallResponses, { global: { plugins: [i18n, store], stubs } });
}

describe("OnCallResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.listResponses.mockResolvedValue({ data: [] } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    // A fully configured org by default, so only the tests that care about the
    // checklist have to say anything about it.
    service.coverageGaps.mockResolvedValue({ data: { at: 0, total: 0, teams: [] } } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.listOwnershipRules.mockResolvedValue({ data: [{ id: "rule_1" }] } as any);
    // The ladder, the policy behind its denominator, and the expanded row's
    // events. Every one of them degrades a single cell rather than the page,
    // so the default is "answered, with nothing in it".
    service.getPolicy.mockResolvedValue({ data: { rungs: [] } } as any);
    service.getSchedule.mockResolvedValue({ data: null } as any);
    service.escalationProgress.mockResolvedValue({
      data: { fired: [], next_targets: [], next_at: null, exhausted: false },
    } as any);
    service.getResponse.mockResolvedValue({ data: { events: [] } } as any);
  });

  function page(over: Record<string, unknown> = {}, source = "al_ckt") {
    return {
      id: "resp_1",
      org_id: "default",
      subject: { subject_type: "alert", source_id: source, firing: 1 },
      team_id: "team_1",
      priority: 1,
      state: "triggered",
      responder_role: "owner",
      title: "checkout_failing",
      opened_at: 1_700_000_000_000_000,
      acked_by: null,
      acked_at: null,
      closed_at: null,
      ...over,
    };
  }

  async function withPages(rows: Record<string, unknown>[]) {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    service.listResponses.mockResolvedValue({ data: rows } as any);
    const wrapper = render();
    await flushPromises();
    return wrapper;
  }

  const stats = (w: any) =>
    Object.fromEntries(
      (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [
        i.key,
        i.value,
      ]),
    );

  /// The state counts the section headings carry. State left the stat strip when
  /// the list gained sections, so this is where "how many are ringing" is read.
  const sections = (w: any) =>
    Object.fromEntries(
      ["ringing", "snoozed", "handled"]
        .filter((key) => w.find(`[data-test='oncall-section-header-${key}']`).exists())
        .map((key) => [
          key,
          Number(w.find(`[data-test='oncall-section-count-${key}']`).text()),
        ]),
    );

  /// A snoozed page is still open, so it would otherwise sit in the run of
  /// pages nobody has picked up — which is the one run that is still paging.
  it("sections a snoozed page as snoozed, not as ringing", async () => {
    const wrapper = await withPages([
      page({ id: "a" }),
      page({ id: "b", snoozed_until: (Date.now() + 60_000) * 1000 }, "al_pay"),
    ]);

    expect(sections(wrapper)).toEqual({ ringing: 1, snoozed: 1 });
  });

  it("sections an acknowledged page as handled", async () => {
    const wrapper = await withPages([page({ acked_by: "engineer@example.com" })]);
    expect(sections(wrapper)).toEqual({ handled: 1 });
  });

  /// Ringing first: whoever opens this list needs the pages nobody has taken
  /// before anything else, whatever order the server answered in.
  it("orders the sections ringing, snoozed, handled", async () => {
    const wrapper = await withPages([
      page({ id: "a", acked_by: "engineer@example.com", state: "acknowledged" }),
      page({ id: "b", snoozed_until: (Date.now() + 60_000) * 1000 }, "al_pay"),
      page({ id: "c" }, "al_ord"),
    ]);

    const order = wrapper
      .findAll("[data-test^='oncall-section-header-']")
      .map((el) => el.attributes("data-test"));
    expect(order).toEqual([
      "oncall-section-header-ringing",
      "oncall-section-header-snoozed",
      "oncall-section-header-handled",
    ]);
  });

  /// "What is on me" is the second question anybody opening this list has, and
  /// it was answerable only by reading the Acknowledged-by column row by row.
  /// A handoff to a person acknowledges as the new owner, so acked_by is the
  /// owner either way.
  it("counts and filters the pages the signed-in user owns", async () => {
    const wrapper = await withPages([
      page({ id: "a", acked_by: "example@gmail.com", state: "acknowledged" }),
      page({ id: "b", acked_by: "someone.else@corp.com", state: "acknowledged" }, "al_pay"),
      page({ id: "c" }, "al_ord"),
    ]);

    expect(stats(wrapper).mine).toBe(1);

    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "mine");
    await flushPromises();

    const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(data).toHaveLength(1);
    expect(data[0].latest.id).toBe("a");
  });

  // The server lowercases an email on handoff but not on a self-ack, so the
  // comparison cannot be case-sensitive.
  it("matches the owner regardless of case", async () => {
    const wrapper = await withPages([
      page({ id: "a", acked_by: "Example@Gmail.com", state: "acknowledged" }),
    ]);
    expect(stats(wrapper).mine).toBe(1);
  });

  // A tile that can only ever read zero is noise, so it is not rendered at all.
  it("omits the tile when nobody is signed in", async () => {
    const original = store.state.userInfo;
    store.state.userInfo = {};
    try {
      const wrapper = await withPages([page()]);
      expect(stats(wrapper)).not.toHaveProperty("mine");
    } finally {
      store.state.userInfo = original;
    }
  });

  /// A record with no team paged nobody at all. It is the one facet that is a
  /// configuration bug rather than a state somebody is working through.
  it("counts and filters pages that routed to no team", async () => {
    const wrapper = await withPages([page({ id: "a" }), page({ id: "b", team_id: "" }, "al_pay")]);

    expect(stats(wrapper).unrouted).toBe(1);

    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "unrouted");
    await flushPromises();

    const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(data).toHaveLength(1);
    expect(data[0].latest.id).toBe("b");
  });

  /// Re-clicking the live tile is the only way back to the full list now that
  /// the state tiles — and with them the "All" tile — belong to the sections.
  it("toggles a facet off by re-clicking it", async () => {
    const wrapper = await withPages([page()]);
    const strip = wrapper.findComponent({ name: "OStatStrip" });

    strip.vm.$emit("select", "p1");
    await flushPromises();
    expect(strip.props("selectedKey")).toBe("p1");

    strip.vm.$emit("select", "p1");
    await flushPromises();
    expect(strip.props("selectedKey")).toBe(null);
  });

  /// The tile counts must not move as you click them, or the strip becomes
  /// unreadable — they answer to the other filters, not to their own facet.
  it("keeps the tile counts steady while a facet is applied", async () => {
    const wrapper = await withPages([
      page({ id: "a" }),
      page(
        { id: "b", priority: 3, state: "acknowledged", acked_by: "engineer@example.com" },
        "al_pay",
      ),
    ]);
    const before = stats(wrapper);

    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "p1");
    await flushPromises();

    expect(stats(wrapper)).toEqual(before);
    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
  });

  /// A resolved record has no severity left to signal; a stale rail would say
  /// it still does.
  it("rails open rows by severity and leaves closed ones bare", async () => {
    const wrapper = await withPages([page()]);
    const railTone = wrapper.findComponent({ name: "OTable" }).props("rowRailTone") as any;

    const asRow = (p: any) => ({ latest: p, firings: [p], escalating: [], rowKey: p.id });
    expect(railTone(asRow(page({ priority: 1 })))).toBe("p1");
    expect(railTone(asRow(page({ priority: 2 })))).toBe("p2");
    expect(railTone(asRow(page({ state: "resolved" })))).toBeNull();
  });

  /// Snoozed rows recede rather than shouting; the loud treatment is reserved
  /// for something you must act on now.
  it("mutes a snoozed row", async () => {
    const wrapper = await withPages([page()]);
    const rowTone = wrapper.findComponent({ name: "OTable" }).props("rowTone") as any;

    const asRow = (p: any) => ({ latest: p, firings: [p], escalating: [], rowKey: p.id });
    expect(rowTone(asRow(page()))).toBeNull();
    expect(rowTone(asRow(page({ snoozed_until: Date.now() * 1000 + 60_000_000 })))).toBe("muted");
  });

  /// A triage list read at 3am is newest-first. `state`, `team` and `opened_at`
  /// are all now said by another cell — the escalation cell, the alert chips and
  /// the age — so they stay available for sorting but off by default.
  it("sorts newest first and hides the columns another cell already says", async () => {
    const wrapper = await withPages([page()]);
    const table = wrapper.findComponent({ name: "OTable" });

    expect(table.props("sortBy")).toBe("opened_at");
    expect(table.props("sortOrder")).toBe("desc");
    expect(table.props("columnVisibility")).toEqual({
      firings: false,
      state: false,
      team: false,
      opened_at: false,
      channels: false,
    });
    const ids = (table.props("columns") as any[]).map((c) => c.id);
    expect(ids).toContain("escalation");
    expect(ids).toContain("responder");
    expect(ids).toContain("notified");
    expect(ids).not.toContain("acked_by");
    // Actions last: the column you act from should not sit between two you read.
    expect(ids[ids.length - 1]).toBe("actions");
  });

  /// The list refreshes only when somebody asks it to. A background poll was
  /// re-listing the whole open set every 20s and re-fetching every ladder with
  /// it, which is a lot of traffic for a screen that already has a refresh
  /// button in the toolbar.
  it("does not refetch on its own after the first load", async () => {
    vi.useFakeTimers();
    try {
      await withPages([page()]);
      const afterLoad = service.listResponses.mock.calls.length;

      await vi.advanceTimersByTimeAsync(120_000);

      expect(service.listResponses.mock.calls.length).toBe(afterLoad);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("the standing summary", () => {
    /// The two cards answer the questions the list answers per row. Neither
    /// means anything on an org that cannot page at all, so both wait until the
    /// checklist is satisfied.
    it("stays hidden while the setup checklist is up", async () => {
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-attention-card"]').exists()).toBe(false);
    });

    it("counts pages nobody has taken, and names the oldest", async () => {
      // Pinned rather than derived from `Date.now()` twice — the two reads
      // land on different milliseconds and the assertion would flake.
      const oldest = 1_700_000_000_000_000;
      const wrapper = await withPages([
        page({ id: "resp_1", opened_at: oldest }, "al_a"),
        page({ id: "resp_2", opened_at: oldest + 6 * 60_000_000 }, "al_b"),
      ]);

      const banner = wrapper.findComponent({ name: "OnCallRingingBanner" });
      expect(banner.props("ringing")).toBe(2);
      expect(banner.props("oldestOpenedAt")).toBe(oldest);
      // The second action goes to the record that has waited longest.
      expect(banner.props("oldestId")).toBe("resp_1");
    });

    /// Records, not rows: a grouped row standing for ninety-five firings is
    /// still ninety-five pages nobody took.
    it("counts records rather than grouped rows", async () => {
      const wrapper = await withPages([
        page({ id: "resp_1" }, "al_same"),
        page({ id: "resp_2" }, "al_same"),
      ]);

      expect(wrapper.findComponent({ name: "OnCallRingingBanner" }).props("ringing")).toBe(2);
    });

    it("leaves an acknowledged page out of the count", async () => {
      const wrapper = await withPages([
        page({ id: "resp_1", state: "acknowledged", acked_by: "ana@o2.ai" }),
      ]);

      expect(wrapper.findComponent({ name: "OnCallRingingBanner" }).props("ringing")).toBe(0);
    });

    /// There is no assignee on a record. "Yours" is the team's rotation
    /// resolving to you, which is the only fact the server actually holds.
    it("counts a page as yours when your team's rotation resolves to you", async () => {
      service.whoIsOnCall.mockResolvedValue({
        data: [{ rotation: "Primary", user_email: "example@gmail.com" }],
      } as any);
      const wrapper = await withPages([page()]);

      expect(wrapper.findComponent({ name: "OnCallRingingBanner" }).props("assignedToMe")).toBe(
        1,
      );
    });

    it("hands the on-call strip each team's rotation", async () => {
      service.whoIsOnCall.mockResolvedValue({
        data: [{ rotation: "Primary", user_email: "ana@o2.ai" }],
      } as any);
      const wrapper = await withPages([page()]);

      const strip = wrapper.findComponent({ name: "OnCallNowStrip" });
      expect(strip.props("slotsByTeam")).toEqual({
        team_1: [{ rotation: "Primary", user_email: "ana@o2.ai" }],
      });
    });
  });

  describe("the escalation ladder", () => {
    it("loads the ladder for open pages and passes it to the cell", async () => {
      service.escalationProgress.mockResolvedValue({
        data: {
          fired: [{ after_micros: 0, at: 1, targets: ["the on-call"] }],
          next_targets: ["the next on-call"],
          next_at: (Date.now() + 60_000) * 1000,
          exhausted: false,
        },
      } as any);
      const wrapper = await withPages([page()]);

      expect(service.escalationProgress).toHaveBeenCalledWith({
        org_identifier: "default",
        response_id: "resp_1",
      });
      expect(wrapper.findComponent({ name: "OnCallEscalationCell" }).props("progress")).toEqual(
        expect.objectContaining({ next_targets: ["the next on-call"] }),
      );
    });

    /// A resolved page has no ladder left to climb, so asking for one is a
    /// request per row spent on an answer nobody reads.
    it("does not ask for the ladder of a page that is already closed", async () => {
      await withPages([page({ state: "resolved", closed_at: Date.now() * 1000 })]);
      expect(service.escalationProgress).not.toHaveBeenCalled();
    });

    /// One request per page and no bulk endpoint: past the cap the list says so
    /// rather than leaving a blank cell that reads as "nothing has fired".
    it("caps how many ladders it loads, and says that it did", async () => {
      const many = Array.from({ length: 30 }, (_, i) =>
        page({ id: `resp_${i}`, opened_at: 1_700_000_000_000_000 + i }, `al_${i}`),
      );
      const wrapper = await withPages(many);

      expect(service.escalationProgress).toHaveBeenCalledTimes(25);
      expect(wrapper.find('[data-test="oncall-escalation-capped"]').exists()).toBe(true);
    });

    it("takes the rung total for the row's priority from the team's policy", async () => {
      service.getPolicy.mockResolvedValue({
        data: {
          rungs: [
            { priority: 1, steps: [{}, {}, {}], channels: [] },
            { priority: 2, steps: [{}], channels: [] },
          ],
        },
      } as any);
      const wrapper = await withPages([page({ priority: 1 })]);

      expect(wrapper.findComponent({ name: "OnCallEscalationCell" }).props("totalRungs")).toBe(
        3,
      );
    });
  });

  describe("the row itself", () => {
    /// Driving width by a `class` lost to OSelect's own width class and stacked
    /// the whole toolbar into three full-width rows.
    it("sizes the filters with the width prop, not a class", async () => {
      const wrapper = await withPages([page()]);
      const widths = wrapper
        .findAllComponents({ name: "OSelect" })
        .map((select) => select.props("width"));

      expect(widths).toEqual(["sm", "xs"]);
    });

    /// Claiming is only offered while something is still escalating; a page
    /// nobody owns is a routing fix rather than a triage.
    it("offers a team assignment instead of triage when nothing owns the page", async () => {
      const wrapper = await withPages([page({ team_id: "" })]);

      expect(wrapper.find('[data-test^="oncall-row-assign-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(false);
    });

    it("offers acknowledge and snooze while the ladder is still climbing", async () => {
      const wrapper = await withPages([page()]);

      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(true);
    });

    /// A resolved row has nothing left to do to it, so the action becomes a
    /// way to read what happened — and it is the LABELLED one, not a menu item.
    it("drops triage on a resolved row and offers the timeline", async () => {
      const wrapper = await withPages([
        page({ state: "resolved", closed_at: Date.now() * 1000, acked_by: "ana@o2.ai" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-resolve-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test^="oncall-row-timeline-"]').exists()).toBe(true);
      // Nothing is left to put behind it, so the menu is not rendered at all.
      expect(wrapper.find('[data-test^="oncall-row-more-"]').exists()).toBe(false);
    });

    /// Every row shows the step it is actually on. "Acknowledge or nothing" left
    /// a handled page — which still has to be closed — with its one visible
    /// button pointing at a menu.
    it("labels resolve on a row nobody can acknowledge any more", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test^="oncall-row-resolve-"]').exists()).toBe(true);
      // Timeline is what is left for the menu.
      expect(wrapper.find('[data-test^="oncall-row-more-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-timeline-"]').exists()).toBe(true);
    });

    /// The labelled action and the menu must never offer the same thing twice.
    it("keeps the labelled action out of the menu", async () => {
      const ringing = await withPages([page()]);
      // Acknowledge is labelled, so resolve and timeline are the menu's.
      expect(ringing.findAll('[data-test^="oncall-row-resolve-"]')).toHaveLength(1);
      expect(ringing.findAll('[data-test^="oncall-row-timeline-"]')).toHaveLength(1);

      const handled = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);
      // Resolve is labelled now — it must not also appear as an item.
      expect(handled.findAll('[data-test^="oncall-row-resolve-"]')).toHaveLength(1);
    });

    /// Snoozing only makes sense while the ladder is still climbing, so a
    /// handled row's menu must not offer it.
    it("offers no snooze once nothing is escalating", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(false);
    });

    /// Deduplicated across rungs: a ladder that reached the same person twice
    /// has rung one person, not two.
    it("counts the distinct people the ladder has rung", async () => {
      service.escalationProgress.mockResolvedValue({
        data: {
          fired: [
            { after_micros: 0, at: 1, targets: ["ana@o2.ai"] },
            { after_micros: 300, at: 2, targets: ["ana@o2.ai", "bob@o2.ai"] },
          ],
          next_targets: [],
          next_at: null,
          exhausted: false,
        },
      } as any);
      const wrapper = await withPages([page()]);

      expect(wrapper.find('[data-test^="oncall-responder-rung-"]').text()).toBe("2 people rung");
    });

    /// The channels are the policy's — what WOULD be used — so a channel with
    /// no provider behind it has to be distinguishable from one that sends.
    it("shows the channels the page would go out on", async () => {
      service.getPolicy.mockResolvedValue({
        data: { rungs: [{ priority: 1, steps: [{}, {}], channels: ["email", "sms"] }] },
      } as any);
      const wrapper = await withPages([page({ priority: 1 })]);

      expect(wrapper.find('[data-test$="-email"]').exists()).toBe(true);
      expect(wrapper.find('[data-test$="-sms"]').exists()).toBe(true);
    });
  });

  describe("the setup checklist", () => {
    /// "Nothing is paging" is only reassuring once something COULD page. On a
    /// fresh install it is indistinguishable from "nothing is set up".
    it("shows when the org has no teams", async () => {
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);
    });

    /// The bug this closes: a team with an unstaffed rotation pages nobody,
    /// and the old guide vanished the moment the first team existed.
    it("still shows when a team exists but nobody is on call", async () => {
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      service.coverageGaps.mockResolvedValue({
        data: { at: 0, total: 1, teams: [team] },
      } as any);
      const wrapper = render();
      await flushPromises();

      const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
      expect(checklist.exists()).toBe(true);
      expect(checklist.props("hasTeam")).toBe(true);
      expect(checklist.props("hasStaffedRotation")).toBe(false);
    });

    /// A server without the coverage-gap endpoint used to read as "zero gaps",
    /// which ticked the rotation step and hid the checklist on an org whose
    /// team had no rotation at all.
    it("asks each team directly when the coverage endpoint is unavailable", async () => {
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      service.coverageGaps.mockRejectedValue({ response: { status: 404 } });
      service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
      const wrapper = render();
      await flushPromises();

      const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
      expect(checklist.exists()).toBe(true);
      expect(checklist.props("hasStaffedRotation")).toBe(false);
      expect(service.whoIsOnCall).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: team.id }),
      );
    });

    it("counts the rotation staffed when that fallback finds somebody on call", async () => {
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      service.coverageGaps.mockRejectedValue({ response: { status: 404 } });
      service.whoIsOnCall.mockResolvedValue({
        data: [{ rotation: "Weekdays", user_email: "ana@corp.com" }],
      } as any);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    it("disappears once a team is staffed and routed", async () => {
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(true);
    });

    // A checklist that flashes on every load would read as "your setup vanished".
    it("does not show before the first fetch resolves", () => {
      service.listResponses.mockReturnValue(new Promise(() => {}) as any);
      const wrapper = render();
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    // A failed fetch must not be mistaken for an empty org.
    it("does not show when the fetch failed", async () => {
      service.listResponses.mockRejectedValue(new Error("boom"));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });
  });

  /// §G.8.1: the entry fetch is the capability probe — 404 (feature off) and
  /// 403 "Not Supported" (OSS build) both mean on-call is not available here.
  /// A fact about the deployment: no error tone, no retry, no setup checklist
  /// telling a build that cannot page to create teams.
  describe("when the deployment has no on-call at all", () => {
    it.each([
      { response: { status: 404, data: {} } },
      { response: { status: 403, data: { message: "Not Supported" } } },
    ])("renders the calm not-available state, never an error (%#)", async (rejection) => {
      service.listResponses.mockRejectedValue(rejection);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-responses-unavailable"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OTable" }).exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    /// The same status with the permission message is a different fact — a
    /// viewer without the grant must not be told the product does not exist.
    it("keeps 403 Forbidden an error, not an absence", async () => {
      service.listResponses.mockRejectedValue({
        response: { status: 403, data: { message: "Forbidden" } },
      });
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-responses-unavailable"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OTable" }).props("error")).toBe("Forbidden");
    });
  });

  /// B6: a transient 500 was previously presented as "this page does not
  /// exist", with nothing to click.
  describe("when the list cannot be loaded", () => {
    it("surfaces the error and offers a retry rather than an empty state", async () => {
      service.listResponses.mockRejectedValue({ response: { data: { message: "gateway" } } });
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTable" }).props("error")).toBe("gateway");
      expect(wrapper.find('[data-test="oncall-responses-error"]').exists()).toBe(true);
    });

    it("clears the error once a retry succeeds", async () => {
      service.listResponses.mockRejectedValueOnce(new Error("boom"));
      const wrapper = render();
      await flushPromises();
      expect(wrapper.findComponent({ name: "OTable" }).props("error")).toBeTruthy();

      service.listResponses.mockResolvedValue({ data: [page()] } as any);
      await wrapper.find('[data-test="oncall-responses-refresh"]').trigger("click");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTable" }).props("error")).toBeNull();
    });
  });

  /// The team list is `oncall` LIST. Losing it must cost the filter, not the
  /// list somebody was paged about.
  it("disables the team filter when teams cannot be listed, and still lists pages", async () => {
    service.listTeams.mockRejectedValue({ response: { status: 403 } });
    service.listResponses.mockResolvedValue({ data: [page()] } as any);
    const wrapper = render();
    await flushPromises();

    const teamFilter = wrapper
      .findAllComponents({ name: "OSelect" })
      .find((s) => s.attributes("data-test") === "oncall-responses-team-filter");
    expect(teamFilter?.props("disabled")).toBe(true);
    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
  });

  /// The server caps a page at 200. Stopping at one page would put a number on
  /// the stat strip that silently described a fraction of the org.
  describe("paging the server", () => {
    /// The health card issues its OWN `listResponses` (closed pages included,
    /// no offset), so paging is counted by the offset-bearing calls only.
    const pagingCalls = () =>
      service.listResponses.mock.calls.filter(([args]) => (args as any)?.offset !== undefined);

    it("asks for one page and stops when it comes back short", async () => {
      await withPages([page()]);

      expect(pagingCalls()).toHaveLength(1);
      expect(service.listResponses).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200, offset: 0 }),
      );
    });

    /// H6: this is the one test in the suite that mounts the table with 600
    /// rows, because a "full page" is only full at the component's own limit of
    /// 200 and the cap is three of them — shrinking the fixture would stop
    /// pinning the claim. It passes in about a second alone and times out at
    /// the 5s default under a 39-file parallel run, so it gets its own budget
    /// rather than a re-run every time somebody sees it red.
    it("walks on while pages come back full, and says so when it stops early", async () => {
      const full = Array.from({ length: 200 }, (_, i) => page({ id: `r${i}` }, `al_${i}`));
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      service.listResponses.mockResolvedValue({ data: full } as any);

      const wrapper = render();
      await flushPromises();

      // Three pages is the cap; the fourth is not requested.
      expect(pagingCalls()).toHaveLength(3);
      expect(pagingCalls().at(-1)?.[0]).toEqual(expect.objectContaining({ offset: 400 }));
      expect(wrapper.find('[data-test="oncall-responses-truncated"]').exists()).toBe(true);
    }, 20_000);

    /// The truncation line never claims a total. `/responses/count` was
    /// invented by the client — no build has ever served it — so it 404'd on
    /// every load and the total was always unknown anyway.
    it("says how many it loaded without claiming that is all of them", async () => {
      const full = Array.from({ length: 200 }, (_, i) => page({ id: `r${i}` }, `al_${i}`));
      service.listTeams.mockResolvedValue({ data: [team] } as any);
      service.listResponses.mockResolvedValue({ data: full } as any);

      const wrapper = render();
      await flushPromises();

      const line = wrapper.find('[data-test="oncall-responses-truncated"]').text();
      expect(line).toContain("600");
      expect(line).not.toContain(" of ");
    }, 20_000);
  });

  it("always offers a route to Teams", async () => {
    const wrapper = await withPages([page()]);

    await wrapper.find('[data-test="oncall-responses-teams-btn"]').trigger("click");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallTeams" }));
  });

  /// "My on-call" narrows THIS list. It used to navigate, which threw away
  /// every other filter the reader had set and answered the question from a
  /// different dataset on a different screen.
  describe("my on-call", () => {
    const mineBtn = '[data-test="oncall-responses-mine-btn"]';

    async function withMyShift(rows: Record<string, unknown>[]) {
      service.whoIsOnCall.mockImplementation(({ team_id }: any) =>
        Promise.resolve({
          data: team_id === "team_1" ? [{ rotation: "Primary", user_email: "example@gmail.com" }] : [],
        } as any),
      );
      return withPages(rows);
    }

    /// `oncall/me` used to be a 59-line stub that told every reader they were
    /// on no team without asking the server. It redirects here now, so the
    /// query has to arrive already narrowed or the old link lands on a list
    /// that answers a different question.
    it("opens already narrowed when the retired page redirects here", async () => {
      routeQuery.mine = "1";
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);

      const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
      expect(data.map((row) => row.latest.id)).toEqual(["a"]);
    });

    it("filters in place instead of navigating", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);

      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();

      expect(push).not.toHaveBeenCalled();
      const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
      expect(data.map((row) => row.latest.id)).toEqual(["a"]);
    });

    /// The strip sits above the rows and claims to describe them, so the scope
    /// has to apply before the counts are taken.
    it("counts the narrowed list, not the whole one", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);

      expect(sections(wrapper)).toEqual({ ringing: 2 });
      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();
      expect(sections(wrapper)).toEqual({ ringing: 1 });
    });

    /// The acknowledgement outlives the shift: whoever claimed a page still
    /// owns it after handover, even on a team they are no longer on.
    it("keeps a page the viewer acknowledged on another team", async () => {
      const wrapper = await withMyShift([
        page(
          { id: "b", team_id: "team_other", acked_by: "example@gmail.com", state: "acknowledged" },
          "al_pay",
        ),
      ]);

      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();

      const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
      expect(data.map((row) => row.latest.id)).toEqual(["b"]);
    });

    it("is a toggle, so the second click gives the full list back", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      const rowIds = () =>
        (wrapper.findComponent({ name: "OTable" }).props("data") as any[]).map(
          (row) => row.latest.id,
        );

      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();
      expect(rowIds()).toEqual(["a"]);

      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();
      expect(rowIds()).toEqual(["a", "b"]);
    });

    /// A toggle that can only ever empty the table is worse than no toggle.
    it("is absent when we do not know who is signed in", async () => {
      const original = store.state.userInfo;
      store.state.userInfo = {};
      try {
        const wrapper = await withPages([page()]);
        expect(wrapper.find(mineBtn).exists()).toBe(false);
      } finally {
        store.state.userInfo = original;
      }
    });

    /// Nothing of yours open is a real answer; "no pages at all" is not.
    it("offers to clear itself when it empties the list", async () => {
      const wrapper = await withMyShift([page({ id: "b", team_id: "team_other" }, "al_pay")]);

      await wrapper.find(mineBtn).trigger("click");
      await flushPromises();

      const empty = wrapper
        .findAllComponents({ name: "OEmptyState" })
        .find((node) => node.props("preset") === "no-oncall-responses");
      expect(empty?.props("filtered")).toBe(true);
    });
  });

  /// During an incident the list IS the work surface. Opening 200 pages one at
  /// a time to claim them is not triage.
  describe("acting from the list", () => {
    it("acknowledges a single page without opening it", async () => {
      service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page()]);

      await wrapper.find('[data-test="oncall-row-ack-alert:al_ckt"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
      // The row's own click navigates; the button must not also navigate.
      expect(push).not.toHaveBeenCalled();
    });

    /// A page somebody already owns cannot be claimed again, so offering the
    /// button would only produce an error.
    it("offers acknowledge only while something in the row is escalating", async () => {
      const escalating = await withPages([page()]);
      expect(escalating.find('[data-test="oncall-row-ack-alert:al_ckt"]').exists()).toBe(true);

      const owned = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);
      expect(owned.find('[data-test="oncall-row-ack-alert:al_ckt"]').exists()).toBe(false);
      // Resolve stays: an acknowledged page still has to be closed.
      expect(owned.find('[data-test="oncall-row-resolve-alert:al_ckt"]').exists()).toBe(true);
    });

    /// A row stands for every firing under it. Acknowledging the newest of
    /// ninety-five and leaving ninety-four escalating would be worse than
    /// showing all ninety-five rows.
    it("acknowledges every escalating firing the row stands for", async () => {
      service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([
        page({ id: "f3", opened_at: 300 }),
        page({ id: "f2", opened_at: 200 }),
        page({ id: "f1", opened_at: 100, state: "acknowledged" }),
      ]);

      await wrapper.find('[data-test="oncall-row-ack-alert:al_ckt"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
    });

    it("bulk acknowledges the selection", async () => {
      service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
    });

    /// S11: the selection UI existed and three quarters of its value did not.
    it("bulk snoozes every escalating record in the selection", async () => {
      service.snoozeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-snooze-30"]').trigger("click");
      await flushPromises();

      expect(service.snoozeResponse).toHaveBeenCalledTimes(2);
      expect(service.snoozeResponse).toHaveBeenCalledWith(expect.objectContaining({ minutes: 30 }));
    });

    /// Closing records in bulk is irreversible, so it asks first.
    it("confirms before bulk resolving, and resolves every unresolved firing", async () => {
      service.resolveResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-resolve"]').trigger("click");
      await flushPromises();

      // Nothing is closed on the click alone.
      expect(service.resolveResponse).not.toHaveBeenCalled();

      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
      await flushPromises();

      expect(service.resolveResponse).toHaveBeenCalledTimes(2);
    });

    /// One page failing must not silently abandon the other ninety-nine.
    it("reports partial failure and still acknowledges the rest", async () => {
      service.acknowledgeResponse
        .mockResolvedValueOnce({ data: {} } as any)
        .mockRejectedValueOnce(new Error("boom"));
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="oncall-bulk-ack"]').exists()).toBe(false);
    });

    /// The whole point of the Alert column: a woken engineer cannot act on a
    /// ksuid.
    it("shows the alert name, not the ksuid, and searches it", async () => {
      const wrapper = await withPages([page({ title: "checkout_failing" })]);
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      const subject = columns.find((c) => c.id === "subject");
      const asRow = (p: any) => ({ latest: p, firings: [p], escalating: [], rowKey: p.id });
      expect(subject.accessorFn(asRow(page({ title: "checkout_failing" })))).toBe(
        "checkout_failing",
      );
      // No title (an older record) still identifies itself somehow.
      expect(subject.accessorFn(asRow(page({ title: null })))).toBe("al_ckt");
    });
  });

  /// S12: the list had no way to answer "show me only the P1s".
  it("filters by priority", async () => {
    const wrapper = await withPages([
      page({ id: "a", priority: 1 }),
      page({ id: "b", priority: 3 }, "al_pay"),
    ]);

    (wrapper.vm as any).priorityFilter = "3";
    await flushPromises();

    const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(data).toHaveLength(1);
    expect(data[0].latest.id).toBe("b");
  });

  /// The wall of identical rows this exists to remove.
  describe("grouping", () => {
    it("collapses repeated firings of one alert into a single row", async () => {
      const wrapper = await withPages([
        page({ id: "f3", opened_at: 300 }),
        page({ id: "f2", opened_at: 200 }),
        page({ id: "f1", opened_at: 100 }),
        page({ id: "other" }, "al_pay"),
      ]);

      const data = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
      expect(data).toHaveLength(2);
      expect(data[0].firings).toHaveLength(3);
      // The row stands for the newest firing.
      expect(data[0].latest.id).toBe("f3");
    });

    /// A section heading claims to describe the rows below it, so with grouping
    /// on it has to count rows — "285 ringing" above one row is a lie.
    it("counts rows, not records", async () => {
      const wrapper = await withPages([
        page({ id: "f2", opened_at: 200 }),
        page({ id: "f1", opened_at: 100 }),
      ]);

      expect(sections(wrapper)).toEqual({ ringing: 1 });
    });
  });

  describe("clearing the ringing set", () => {
    /// The banner and the section heading both state a count, and the count they
    /// state is the set they act on — so it cannot require selecting rows first.
    it("acknowledges every ringing page from the banner", async () => {
      service.acknowledgeResponse.mockResolvedValue({} as any);
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "b" }, "al_pay"),
        page({ id: "c", state: "acknowledged", acked_by: "someone@o2.ai" }, "al_ord"),
      ]);

      wrapper.findComponent({ name: "OnCallRingingBanner" }).vm.$emit("acknowledge-all");
      await flushPromises();

      // The acknowledged one is left alone.
      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
      const ids = service.acknowledgeResponse.mock.calls.map((c: any[]) => c[0].response_id);
      expect(ids.sort()).toEqual(["a", "b"]);
    });

    it("acknowledges the ringing section from its own heading", async () => {
      service.acknowledgeResponse.mockResolvedValue({} as any);
      const wrapper = await withPages([page({ id: "a" })]);

      await wrapper.find("[data-test='oncall-section-ack-all']").trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(1);
    });

    /// A bulk handoff is not offered — the people a page can be handed to are
    /// per team — so the second action opens the record that needs the decision.
    it("opens the longest-ringing record", async () => {
      const oldest = 1_700_000_000_000_000;
      const wrapper = await withPages([
        page({ id: "newer", opened_at: oldest + 60_000_000 }, "al_a"),
        page({ id: "older", opened_at: oldest }, "al_b"),
      ]);

      wrapper.findComponent({ name: "OnCallRingingBanner" }).vm.$emit("open-oldest");
      await flushPromises();

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "onCallResponseDetail",
          params: { responseId: "older" },
        }),
      );
    });
  });

});
