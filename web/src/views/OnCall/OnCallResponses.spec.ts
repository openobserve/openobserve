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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import { resetOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import { resetOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import OnCallResponses from "@/views/OnCall/OnCallResponses.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

// A pass-through spy: every other test keeps the real toast.
vi.mock("@/lib/feedback/Toast/useToast", async (original) => {
  const real = await original<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...real, toast: vi.fn((...args: Parameters<typeof real.toast>) => real.toast(...args)) };
});

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
    unsnoozeResponse: vi.fn(),
    teamContext: vi.fn(),
    getPolicy: vi.fn(),
    escalationProgressBatch: vi.fn(),
    getResponse: vi.fn(),
    myOnCall: vi.fn(),
  },
}));

// The permission probe reads the org member list. Left unmocked it would fire
// a real request from every test in this file.
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
import analytics from "@/services/product_analytics";
import { axiosReply, deferredReply } from "@/test/unit/helpers/mockService";

/// What the view hands OTable as a row and a column; only the fields these tests read are typed.
type TableRow = { latest: { id: string }; firings: unknown[]; [key: string]: unknown };
type TableColumn = {
  id: string;
  header?: unknown;
  sortable?: boolean;
  hideable?: boolean;
  accessorFn: (row: TableRow | undefined) => unknown;
};

vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn() },
}));

const push = vi.fn();
const routeQuery: Record<string, string> = {};
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: routeQuery }),
}));

// Mutable per case, so the phone tests can switch while every other test stays desktop.
const mockViewport = vi.hoisted(() => ({ mdUp: true, lgUp: true }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !mockViewport.mdUp),
      isTablet: computed(() => mockViewport.mdUp && !mockViewport.lgUp),
      isDesktop: computed(() => mockViewport.lgUp),
      mdUp: computed(() => mockViewport.mdUp),
      lgUp: computed(() => mockViewport.lgUp),
    }),
  };
});

const service = vi.mocked(oncallService);
const destinations = vi.mocked(destinationService);

// Every `mount()` in this file — across all three top-level `describe`s —
// stays alive as a real, reactive component instance unless something
// unmounts it. Nothing did, so by the end of the file dozens of past
// instances were still watching the shared `store`: any test that mutates
// shared state (e.g. `store.state.userInfo`) forced every one of them to
// re-render, and the cost compounded test over test until a mount+flush that
// takes milliseconds in isolation blew a 5s timeout deep into the run.
const mountedWrappers: VueWrapper[] = [];
function mountTracked(...args: Parameters<typeof mount>): VueWrapper {
  const wrapper = mount(...args) as VueWrapper;
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  // Renders the real cell slots, so the tests exercise what the page actually
  // draws rather than a column-def function OTable never calls.
  OTable: {
    name: "OTable",
    props: [
      "data",
      "rowTone",
      "columns",
      "selectedIds",
      "isRowSelectable",
      "error",
      "loading",
      "sortBy",
      "sortOrder",
      "columnVisibility",
      "rowSection",
      "sectionOrder",
      "currentPage",
      "pageSize",
      "expandedIds",
    ],
    emits: [
      "update:selectedIds",
      "update:currentPage",
      "update:pageSize",
      "update:sortBy",
      "update:sortOrder",
    ],
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
      <slot v-if="selectedIds && selectedIds.length" name='selection-actions' />
      <slot v-else name='footer-note' />
      <slot v-if="error" name='error' />
    </div>`,
  },
  OnCallSetupChecklist: {
    name: "OnCallSetupChecklist",
    props: [
      "hasTeam",
      "hasStaffedRotation",
      "hasPolicy",
      "hasRouting",
      "compact",
      "canConfigure",
      "firstTeamId",
      "firstTeamName",
    ],
    // The two shapes the real component takes, so the page's layout decision is
    // visible from the outside rather than only in a prop.
    template: "<div :data-test=\"compact ? 'oncall-setup-banner' : 'oncall-setup-checklist'\" />",
  },
  // `open`, not `modelValue`: ODialog has no `modelValue` prop, and unstubbed
  // it pulls reka-ui's Dialog primitives into every mount that opens one.
  ODialog: {
    name: "ODialog",
    props: ["open"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  OTextarea: {
    name: "OTextarea",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  // "vue-router" is mocked wholesale above, so the real RouterLink (which
  // navigates via the router injected by its plugin) never resolves — this
  // mirrors just enough of it to make a click call the same `push` mock a
  // programmatic navigation would.
  RouterLink: {
    name: "RouterLink",
    props: ["to"],
    template: '<a @click.stop="push(to)"><slot /></a>',
    setup() {
      return { push };
    },
  },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  // Open by construction, like ODropdown above: what the phone filter panel holds is the assertion, not the toggle.
  OPopover: { name: "OPopover", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
  },
  // Stubbed like the rest of the family: unstubbed they pull reka-ui into every
  // row's action cell, which pushed several mounts past the 5s test timeout.
  ODropdownGroup: { name: "ODropdownGroup", props: ["label"], template: "<div><slot /></div>" },
  // Also reka-ui underneath. A bare div/button pair is enough: tests drive a
  // tab change by emitting `update:modelValue` on the group directly, the
  // same way they drive OSelect below.
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: "<button><slot /></button>",
  },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OEmptyState: {
    name: "OEmptyState",
    props: ["preset", "filtered"],
    template: "<div :data-preset='preset' />",
  },
  OSelect: {
    name: "OSelect",
    props: ["options", "disabled", "width", "modelValue", "searchable"],
    template: "<select />",
  },
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
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

// File-level so every describe starts from an empty saved view.
beforeEach(() => resetListViewState());

function render() {
  return mountTracked(OnCallResponses, { global: { plugins: [i18n, store], stubs } });
}

/// Picks "all" explicitly, so a test does not lean on the default tab.
async function showAllTab(wrapper: VueWrapper) {
  wrapper
    .findAllComponents({ name: "OSelect" })
    .find((c) => c.attributes("data-test") === "oncall-responses-filter-tabs")
    .vm.$emit("update:modelValue", "all");
  await flushPromises();
}

/// What a team answers by default: "answered, with nothing in it".
const emptyTeam = { policy: { rungs: [] }, on_call: [], schedule: null };

/// The team-context read answers `facts(id)` for each asked team, plus `mine` when `include_mine` is set; `undefined` is a team the server left out.
function answerTeams(facts: (teamId: string) => object | undefined, mine: string[] = []) {
  service.teamContext.mockImplementation(async ({ team_ids, include_mine }) => {
    const ids = [...new Set([...team_ids, ...(include_mine ? mine : [])])];
    const teams = ids.flatMap((id) => {
      const answer = facts(id);
      return answer ? [{ team_id: id, ...answer }] : [];
    });
    return axiosReply({ teams });
  });
}

/// The batch ladder read answers `progress(id)` for each asked id; `undefined` is an id the server left out.
function answerProgress(progress: (responseId: string) => object | undefined) {
  service.escalationProgressBatch.mockImplementation(async ({ response_ids }) =>
    axiosReply({
      progress: response_ids.flatMap((id: string) => {
        const answer = progress(id);
        return answer ? [{ response_id: id, ...answer }] : [];
      }),
    }),
  );
}

describe("OnCallResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The global teardown clears too, but a test that leaves a load in flight
    // repopulates the cache between the two hooks, and the next test would then
    // be served that entry instead of the mock it had just declared.
    queryClient.clear();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.listResponses.mockResolvedValue(axiosReply([]));
    service.listTeams.mockResolvedValue(axiosReply([]));
    // A fully configured org by default, so only the tests that care about the
    // checklist have to say anything about it.
    service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 0, teams: [] }));
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    service.listOwnershipRules.mockResolvedValue(axiosReply([{ id: "rule_1" }]));
    destinations.list.mockResolvedValue(axiosReply([{ name: "dest_1" }]));
    // The ladder, the policy behind its denominator, and the expanded row's
    // events. Every one of them degrades a single cell rather than the page,
    // so the default is "answered, with nothing in it".
    answerTeams(() => emptyTeam);
    answerProgress(() => ({ fired: [], next_targets: [], next_at: null, exhausted: false }));
    service.getResponse.mockResolvedValue(axiosReply({ events: [] }));
  });

  /// Mounts the real page layout so the tag is proven to reach the rendered header.
  it("tags the page title as Beta", async () => {
    const wrapper = mountTracked(OnCallResponses, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OPageLayout: false } },
    });
    await flushPromises();
    const badge = wrapper.find('[data-test="beta-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(String(i18n.global.t("common.beta")));
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
    service.listTeams.mockResolvedValue(axiosReply([team]));
    service.listResponses.mockResolvedValue(axiosReply(rows));
    const wrapper = render();
    await flushPromises();
    return wrapper;
  }

  /// The rows are the screen; team context and the checklist only fill cells and a bar around them.
  it("renders the rows before the team context and checklist reads answer", async () => {
    const teams = deferredReply();
    const context = deferredReply();
    const gaps = deferredReply();
    service.listTeams.mockImplementation(() => teams.promise);
    service.teamContext.mockImplementation(() => context.promise);
    service.coverageGaps.mockImplementation(() => gaps.promise);
    service.listResponses.mockResolvedValue(axiosReply([page()]));
    const wrapper = render();
    await flushPromises();

    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("loading")).toBe(false);
    expect(table.props("data")).toHaveLength(1);
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);

    teams.answer([team]);
    context.answer({ teams: [] });
    gaps.answer({ at: 0, total: 0, teams: [] });
    await flushPromises();
    expect(table.props("data")).toHaveLength(1);
  });

  it("keeps the skeleton on an empty list until setup answers", async () => {
    const teams = deferredReply();
    service.listTeams.mockImplementation(() => teams.promise);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: "OTable" }).props("loading")).toBe(true);

    teams.answer([team]);
    await flushPromises();
    expect(wrapper.findComponent({ name: "OTable" }).props("loading")).toBe(false);
  });

  /// The state counts the section headings carry — the only counts on the
  /// screen now that the P1/Mine/Unrouted tiles are gone.
  const sections = (w: VueWrapper) =>
    Object.fromEntries(
      ["ringing", "snoozed", "handled"]
        .filter((key) => w.find(`[data-test='oncall-section-header-${key}']`).exists())
        .map((key) => [key, Number(w.find(`[data-test='oncall-section-count-${key}']`).text())]),
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

  // C13: the table pages only the visible tab, so a later page cannot hide its rows.
  it("hands the table only the rows of the visible tab", async () => {
    const wrapper = await withPages([
      page({ id: "a", acked_by: "engineer@example.com", state: "acknowledged" }),
      page({ id: "c" }, "al_ord"),
    ]);
    const table = () => wrapper.findComponent({ name: "OTable" });
    expect(table().props("data")).toHaveLength(2);

    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "oncall-responses-filter-tabs")!
      .vm.$emit("update:modelValue", "ringing");
    await flushPromises();

    expect(
      table()
        .props("data")
        .map((row: TableRow) => row.latest.id),
    ).toEqual(["c"]);
    expect(sections(wrapper)).toEqual({ ringing: 1 });
  });

  /// Snoozed rows recede rather than shouting; the loud treatment is reserved
  /// for something you must act on now.
  it("mutes a snoozed row", async () => {
    const wrapper = await withPages([page()]);
    const rowTone = wrapper.findComponent({ name: "OTable" }).props("rowTone") as (
      row: TableRow,
    ) => string | null;

    const asRow = (p: { id: string }): TableRow => ({
      latest: p,
      firings: [p],
      escalating: [],
      rowKey: p.id,
    });
    expect(rowTone(asRow(page()))).toBeNull();
    expect(rowTone(asRow(page({ snoozed_until: Date.now() * 1000 + 60_000_000 })))).toBe("muted");
  });

  /// A triage list read at 3am is newest-first. `state` and `firings` are said
  /// by another cell — the escalation cell and the alert chips — so they stay
  /// available for sorting but off by default. Team is NOT one of them: it is
  /// the fact that decides who answers, so it is a column you can see and sort.
  it("sorts newest first and hides the columns another cell already says", async () => {
    const wrapper = await withPages([page()]);
    const table = wrapper.findComponent({ name: "OTable" });

    expect(table.props("sortBy")).toBe("last_alert_at");
    expect(table.props("sortOrder")).toBe("desc");
    expect(table.props("columnVisibility")).toEqual({
      firings: false,
      channels: false,
    });
    const ids = (table.props("columns") as TableColumn[]).map((c) => c.id);
    expect(ids).toContain("escalation");
    expect(ids).toContain("responder");
    expect(ids).toContain("team");
    expect(ids).toContain("last_alert_at");
    // One instant, one column. `opened_at` rendered the same timestamp as the
    // time column beside it, in the same format.
    expect(ids).not.toContain("opened_at");
    expect(ids).not.toContain("acked_by");
    // Actions last: the column you act from should not sit between two you read.
    expect(ids[ids.length - 1]).toBe("actions");
  });

  /// The Pages list and the Incident list both answer "when did this last
  /// fire". They used to answer it in two formats — a bespoke duration here, a
  /// relative time there — so a reader carried the conversion between them.
  it("renders the time column the way the incident list renders Last Alert", async () => {
    const wrapper = await withPages([page()]);
    const time = wrapper.findComponent({ name: "OTable" }).props("columns") as TableColumn[];
    const col = time.find((c) => c.id === "last_alert_at")!;

    expect(col.header).toBe("Created");
    expect(col.sortable).toBe(true);
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

  /// Every read behind this screen — the paged walk itself, teams, coverage,
  /// rules, each team's policy and rotation, each open page's ladder — is a
  /// cache entry. Opening the screen again inside their freshness window must
  /// spend no request on them; only the reader's own refresh forces one.
  it("serves a remount from the cache, and still reaches the server on refresh", async () => {
    const cachedCalls = () =>
      service.listResponses.mock.calls.length +
      service.listTeams.mock.calls.length +
      service.coverageGaps.mock.calls.length +
      service.listOwnershipRules.mock.calls.length +
      service.teamContext.mock.calls.length +
      service.escalationProgressBatch.mock.calls.length;

    const first = await withPages([page()]);
    const afterFirst = cachedCalls();
    expect(afterFirst).toBeGreaterThan(0);
    first.unmount();

    const second = await withPages([page()]);
    expect(cachedCalls()).toBe(afterFirst);
    expect(service.listResponses).toHaveBeenCalledTimes(1);
    expect(service.listTeams).toHaveBeenCalledTimes(1);
    // The rows are the cached ones, not an empty table over a fetch nobody made.
    expect(second.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);

    await second.find('[data-test="oncall-responses-refresh"]').trigger("click");
    await flushPromises();

    expect(cachedCalls()).toBe(afterFirst * 2);
    expect(service.listResponses).toHaveBeenCalledTimes(2);
    expect(service.listTeams).toHaveBeenCalledTimes(2);
  });

  // Alert destinations do not wake anybody, so setup does not ask for them.
  it("does not read alert destinations for the setup checklist", async () => {
    await withPages([page()]);
    expect(destinations.list).not.toHaveBeenCalled();
  });

  describe("the ringing run", () => {
    /// "Is anything waiting on a person" is the ringing section of the list
    /// itself, not a second count above it — so a page somebody has claimed
    /// leaves that run rather than being subtracted from a separate total.
    it("leaves an acknowledged page out of the ringing run", async () => {
      const wrapper = await withPages([
        page({ id: "resp_1", state: "acknowledged", acked_by: "ana@o2.ai" }),
      ]);

      expect(sections(wrapper)).toEqual({ handled: 1 });
    });

    /// A ladder that ran out of rungs with nobody reaching anybody is the one
    /// case a responder most needs to see, not one to bury under "handled"
    /// next to pages that already have an owner — "Nobody yet" under a
    /// heading that says a human owns each of these was the bug.
    it("hints that a row's Acknowledge stops paging its team and shows on the alert", async () => {
      const wrapper = await withPages([page({ id: "resp_1" })]);
      const ack = wrapper.find('[data-test^="oncall-row-ack-"]');
      expect(ack.findComponent({ name: "OTooltip" }).props("content")).toBe(
        `Stops paging ${team.name}. Shows as acknowledged on the alert.`,
      );
    });

    it("says incident in an incident row's hint", async () => {
      const wrapper = await withPages([
        page({
          id: "resp_1",
          subject: { subject_type: "incident", source_id: "inc_1", firing: 1 },
        }),
      ]);
      const ack = wrapper.find('[data-test^="oncall-row-ack-"]');
      expect(ack.findComponent({ name: "OTooltip" }).props("content")).toBe(
        `Stops paging ${team.name}. Shows as acknowledged on the incident.`,
      );
    });

    it("keeps an exhausted-ladder page in the ringing run until somebody claims it", async () => {
      answerProgress(() => ({
        fired: [{ after_micros: 0, at: 1, targets: [] }],
        next_targets: [],
        next_at: null,
        exhausted: true,
        stopped_because: "the ladder is exhausted — nobody acknowledged",
      }));
      const wrapper = await withPages([page({ id: "resp_1" })]);

      expect(sections(wrapper)).toEqual({ ringing: 1 });
      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(true);
      const header = wrapper.find("[data-test='oncall-section-header-ringing']").text();
      expect(header).not.toContain("not being paged");
      expect(wrapper.find("[data-test='oncall-section-hint-stopped']").exists()).toBe(false);
    });

    /// A priority with no rungs configured (P4, by design) never starts a
    /// ladder at all, so `exhausted` never even gets a chance to be true.
    /// Same fix has to cover this path too, or the bug just moves.
    it("keeps a zero-rung priority in the ringing run until somebody claims it", async () => {
      answerTeams(() => ({
        ...emptyTeam,
        policy: { rungs: [{ priority: 1, steps: [], channels: [] }] },
      }));
      const wrapper = await withPages([page({ id: "resp_1" })]);

      expect(sections(wrapper)).toEqual({ ringing: 1 });
      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(true);
    });

    const ringingHeader = "[data-test='oncall-section-header-ringing']";

    it("says unrouted pages are not paging, apart from the ones that are", async () => {
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "b", team_id: null }, "al_pay"),
        page({ id: "c", team_id: null }, "al_disk"),
      ]);

      const text = wrapper.find(ringingHeader).text();
      expect(text).not.toContain("nobody has acknowledged — these are still paging");
      expect(text).toContain(
        "nobody has acknowledged — 1 of these is still paging·2 have no team, so they are not paging",
      );
    });

    /// R11: a page whose ladder stopped has a team but pages nobody, so it is not counted as paging.
    it("does not count a page whose ladder stopped as still paging", async () => {
      answerProgress((id) => ({
        fired: [{ after_micros: 0, at: 1, targets: [], reached: ["ana@o2.ai"] }],
        next_targets: [],
        next_at: null,
        exhausted: false,
        stopped_because: id === "b" ? "the owning team was deleted" : undefined,
      }));
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      const text = wrapper.find(ringingHeader).text();
      expect(text).toContain(
        "nobody has acknowledged — 1 of these is still paging·1 is not being paged",
      );
      expect(wrapper.find('[data-test="oncall-escalation-cell-b"]').text()).toContain(
        "Nobody is being paged",
      );
    });

    /// F4: a deleted team pages nobody, so a page past the progress cap is counted and phrased as such.
    it("counts and phrases a page whose team was deleted as not paged, without its progress", async () => {
      service.escalationProgressBatch.mockRejectedValue({ response: { status: 500, data: {} } });
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_gone" }, "al_pay"),
      ]);

      expect(wrapper.find(ringingHeader).text()).toContain(
        "nobody has acknowledged — 1 of these is still paging·1 is not being paged",
      );
      expect(wrapper.find('[data-test="oncall-escalation-cell-b"]').text()).toContain(
        "Nobody is being paged",
      );
    });

    it("adds no caption when every ringing page has a team", async () => {
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      const text = wrapper.find(ringingHeader).text();
      expect(text).not.toContain("nobody has acknowledged");
      expect(wrapper.find("[data-test='oncall-section-hint-unrouted']").exists()).toBe(false);
    });

    it("counts a grouped alert as paging when an earlier firing of it has a team", async () => {
      const wrapper = await withPages([
        page({ id: "new", team_id: null, opened_at: 1_700_000_100_000_000 }),
        page({ id: "old", opened_at: 1_700_000_000_000_000 }),
        page({ id: "c", team_id: null }, "al_disk"),
      ]);

      expect(sections(wrapper)).toEqual({ ringing: 2 });
      const text = wrapper.find(ringingHeader).text();
      expect(text).toContain("1 of these is still paging");
      expect(text).toContain("1 has no team, so it is not paging");
    });

    it("counts a grouped alert as not paging when only its snoozed firing has a team", async () => {
      const wrapper = await withPages([
        page({ id: "new", team_id: null, opened_at: 1_700_000_100_000_000 }),
        page({
          id: "old",
          opened_at: 1_700_000_000_000_000,
          snoozed_until: (Date.now() + 60_000) * 1000,
        }),
      ]);

      expect(sections(wrapper)).toEqual({ ringing: 1 });
      const text = wrapper.find(ringingHeader).text();
      expect(text).not.toContain("still paging");
      expect(text).toContain("1 has no team, so it is not paging");
    });

    it("drops the still-paging hint when no ringing page has a team", async () => {
      const wrapper = await withPages([page({ id: "b", team_id: null }, "al_pay")]);

      const text = wrapper.find(ringingHeader).text();
      expect(text).not.toContain("still paging");
      expect(text).toContain("1 has no team, so it is not paging");
    });
  });

  describe("the escalation ladder", () => {
    it("loads the ladder for open pages in one read and passes it to the cell", async () => {
      answerProgress(() => ({
        fired: [{ after_micros: 0, at: 1, targets: ["the on-call"] }],
        next_targets: ["the next on-call"],
        next_at: (Date.now() + 60_000) * 1000,
        exhausted: false,
      }));
      const wrapper = await withPages([page(), page({ id: "resp_2" }, "al_pay")]);

      expect(service.escalationProgressBatch).toHaveBeenCalledTimes(1);
      expect(service.escalationProgressBatch).toHaveBeenCalledWith({
        org_identifier: "default",
        response_ids: ["resp_1", "resp_2"],
      });
      expect(wrapper.findComponent({ name: "OnCallEscalationCell" }).props("progress")).toEqual(
        expect.objectContaining({ next_targets: ["the next on-call"] }),
      );
    });

    /// A resolved page has no ladder left to climb, so asking for one is a
    /// request per row spent on an answer nobody reads.
    it("does not ask for the ladder of a page that is already closed", async () => {
      await withPages([page({ state: "resolved", closed_at: Date.now() * 1000 })]);
      expect(service.escalationProgressBatch).not.toHaveBeenCalled();
    });

    /// Past the route's cap a row speaks for itself, so the footer stays quiet.
    it("caps how many ladders it loads without a footer note about it", async () => {
      // Mounting 205 rows takes over 2s on a fast CI runner and can pass the 5s default on a slow one.
      const many = Array.from({ length: 205 }, (_, i) =>
        page({ id: `resp_${i}`, opened_at: 1_700_000_000_000_000 + i }, `al_${i}`),
      );
      const wrapper = await withPages(many);

      expect(service.escalationProgressBatch).toHaveBeenCalledTimes(1);
      const asked = service.escalationProgressBatch.mock.calls[0][0].response_ids;
      expect(asked).toHaveLength(200);
      expect(asked).not.toContain("resp_200");
      expect(wrapper.find('[data-test="oncall-escalation-capped"]').exists()).toBe(false);
    }, 20000);

    /// Rows the server left out have no progress: the record's own step, or no claim, never "Not paged yet".
    it("says what it can for rows without an answer, without claiming they were not paged", async () => {
      answerTeams(() => ({
        ...emptyTeam,
        policy: {
          rungs: [
            {
              priority: 1,
              channels: [],
              steps: [
                { after_micros: 0 },
                { after_micros: 300_000_000 },
                { after_micros: 900_000_000 },
              ],
            },
          ],
        },
      }));
      answerProgress((id) =>
        id === "resp_0"
          ? { fired: [], next_targets: [], next_at: null, exhausted: false }
          : undefined,
      );
      const wrapper = await withPages([
        page({ id: "resp_0", opened_at: 1_700_000_000_000_000 }, "al_0"),
        page({ id: "resp_1", opened_at: 1_700_000_000_000_001 }, "al_1"),
        page(
          { id: "resp_2", opened_at: 1_700_000_000_000_002, reached_rung_micros: 300_000_000 },
          "al_2",
        ),
      ]);
      const cell = (id: string) =>
        wrapper.find(`[data-test="oncall-escalation-cell-${id}"]`).text();

      expect(cell("resp_0")).toBe("Not paged yet");
      expect(cell("resp_2")).toBe("Paging step 2 of 3");
      expect(cell("resp_1")).toBe("");

      const table = wrapper.findComponent({ name: "OTable" });
      const escalation = (table.props("columns") as TableColumn[]).find(
        (c) => c.id === "escalation",
      )!;
      const rowFor = (id: string) =>
        (table.props("data") as TableRow[]).find((r) => r.latest.id === id);
      expect(escalation.accessorFn(rowFor("resp_2"))).toBe(2);
    });

    /// A failed ladder read is not an answer: the row makes no claim rather than "Not paged yet".
    it("makes no claim for a row when the ladder read fails", async () => {
      service.escalationProgressBatch.mockRejectedValue(new Error("down"));
      const wrapper = await withPages([page()]);

      expect(wrapper.find('[data-test="oncall-escalation-cell-resp_1"]').text()).toBe("");
    });

    it("takes the rung total for the row's priority from the team's policy", async () => {
      answerTeams(() => ({
        ...emptyTeam,
        policy: {
          rungs: [
            { priority: 1, steps: [{}, {}, {}], channels: [] },
            { priority: 2, steps: [{}], channels: [] },
          ],
        },
      }));
      const wrapper = await withPages([page({ priority: 1 })]);

      expect(wrapper.findComponent({ name: "OnCallEscalationCell" }).props("totalRungs")).toBe(3);
    });
  });

  describe("the row itself", () => {
    /// Driving width by a `class` lost to OSelect's own width class and stacked
    /// the whole toolbar into three full-width rows.
    it("sizes the filters with the width prop, not a class", async () => {
      const wrapper = await withPages([page()]);
      const byTest = (test: string) =>
        wrapper
          .findAllComponents({ name: "OSelect" })
          .find((s) => s.attributes("data-test") === test);

      expect(byTest("oncall-responses-team-filter")?.props("width")).toBe("sm");
      expect(byTest("oncall-responses-priority-filter")?.props("width")).toBe("sm");
    });

    /// Claiming is only offered while something is still escalating; a page
    /// nobody owns is a routing fix rather than a triage.
    it("offers a team assignment instead of triage when nothing owns the page", async () => {
      const wrapper = await withPages([page({ team_id: null })]);

      expect(wrapper.find('[data-test^="oncall-row-assign-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(false);
    });

    it("offers acknowledge and snooze while the ladder is still climbing", async () => {
      const wrapper = await withPages([page()]);

      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(true);
    });

    /// Pages are forward-only, so a resolved row has no Acknowledge or Resolve; the row click opens it, so ⋯ only expands and links it.
    it("gives a resolved row only the ⋯ menu: timeline, copy link", async () => {
      const wrapper = await withPages([
        page({ state: "resolved", closed_at: Date.now() * 1000, acked_by: "ana@o2.ai" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test^="oncall-row-resolve-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-row-more-alert:al_ckt"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-row-open-alert:al_ckt"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-row-copy-link-alert:al_ckt"]').exists()).toBe(true);
      const timeline = wrapper.findComponent('[data-test="oncall-row-show-timeline-alert:al_ckt"]');
      expect(timeline.text()).toBe("Show timeline");
      timeline.vm.$emit("select");
      await flushPromises();
      expect(wrapper.findComponent({ name: "OTable" }).props("expandedIds")).toEqual([
        "alert:al_ckt",
      ]);
    });

    /// Every row shows the step it is actually on. "Acknowledge or nothing" left
    /// a handled page — which still has to be closed — with its one visible
    /// button pointing at a menu.
    it("labels resolve on a row nobody can acknowledge any more", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-ack-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-row-resolve-alert:al_ckt"]').exists()).toBe(true);
    });

    /// The labelled action and the menu must never offer the same thing twice.
    /// One row state per test: two mounts in one test would share the cached
    /// list and the second would render the first's rows.
    it("gives a ringing row both icons, with the phone menu mirroring them", async () => {
      const ringing = await withPages([page()]);
      expect(ringing.find('[data-test="oncall-row-ack-alert:al_ckt"]').exists()).toBe(true);
      expect(ringing.find('[data-test="oncall-row-resolve-alert:al_ckt"]').exists()).toBe(true);
      expect(ringing.find('[data-test="oncall-row-ack-alert:al_ckt-menu"]').exists()).toBe(true);
      expect(ringing.find('[data-test="oncall-row-resolve-alert:al_ckt-menu"]').exists()).toBe(
        true,
      );
      expect(ringing.find('[data-test^="oncall-row-timeline-"]').exists()).toBe(false);
    });

    it("keeps an empty slot where a row has no Acknowledge, so the icons line up", async () => {
      const handled = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);
      const cell = handled.find('[data-test="oncall-row-resolve-alert:al_ckt"]').element
        .parentElement!;
      expect(cell.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });

    it("offers unsnooze instead of snooze on a snoozed row", async () => {
      const wrapper = await withPages([page({ snoozed_until: (Date.now() + 60_000) * 1000 })]);
      service.unsnoozeResponse.mockResolvedValue(axiosReply({}));

      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(false);
      await wrapper.find('[data-test^="oncall-row-unsnooze-"]').trigger("click");
      await flushPromises();

      expect(service.unsnoozeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
    });

    it("keeps snooze for the awake firing of a row whose other firing is snoozed", async () => {
      const wrapper = await withPages([
        page({ id: "a", snoozed_until: (Date.now() + 60_000) * 1000 }),
        page({ id: "b" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-unsnooze-"]').exists()).toBe(true);
      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(true);
    });

    it("centres a resolved row's lone ⋯ with no empty slots beside it", async () => {
      const resolved = await withPages([
        page({ state: "resolved", closed_at: Date.now() * 1000, acked_by: "ana@o2.ai" }),
      ]);
      const cell = resolved
        .find('[data-test="oncall-row-more-alert:al_ckt"]')
        .element.closest(".justify-center")!;
      expect(cell).not.toBeNull();
      expect(cell.querySelectorAll(":scope > span.size-8[aria-hidden='true']").length).toBe(0);
    });

    /// Snoozing only makes sense while the ladder is still climbing, so a
    /// handled row's menu must not offer it.
    it("offers no snooze once nothing is escalating", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);

      expect(wrapper.find('[data-test^="oncall-row-snooze-"]').exists()).toBe(false);
    });

    /// The channels shown are the policy's — what WOULD be used, not what happened.
    it("shows the channels the page would go out on", async () => {
      answerTeams(() => ({
        ...emptyTeam,
        policy: { rungs: [{ priority: 1, steps: [{}, {}], channels: ["email", "webhook"] }] },
      }));
      const wrapper = await withPages([page({ priority: 1 })]);

      expect(wrapper.find('[data-test$="-email"]').exists()).toBe(true);
      expect(wrapper.find('[data-test$="-webhook"]').exists()).toBe(true);
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
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 1, teams: [team] }));
      const wrapper = render();
      await flushPromises();

      const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
      expect(checklist.exists()).toBe(true);
      expect(checklist.props("hasTeam")).toBe(true);
      expect(checklist.props("hasStaffedRotation")).toBe(false);
    });

    /// The policy step is answered by the team's own policy read, not by alert destinations.
    it("still shows while no team's escalation policy can be read", async () => {
      service.listTeams.mockResolvedValue(axiosReply([team]));
      answerTeams(() => ({ on_call: [], schedule: null }));
      const wrapper = render();
      await flushPromises();

      const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
      expect(checklist.exists()).toBe(true);
      expect(checklist.props("hasTeam")).toBe(true);
      expect(checklist.props("hasRouting")).toBe(true);
      expect(checklist.props("hasPolicy")).toBe(false);
    });

    /// The row teams are only some of the org's, so a policy on a team with no page still counts.
    it("counts a policy on a team that has no page, from one read of every team", async () => {
      service.listTeams.mockResolvedValue(
        axiosReply([team, { ...team, id: "team_2", name: "Payments" }]),
      );
      answerTeams((id) =>
        id === "team_2" ? emptyTeam : { on_call: [{ user_email: "a@o2.ai" }], schedule: null },
      );
      service.listResponses.mockResolvedValue(axiosReply([page()]));
      const wrapper = render();
      await flushPromises();

      expect(service.teamContext).toHaveBeenLastCalledWith({
        org_identifier: "default",
        team_ids: ["team_1", "team_2"],
        include_mine: false,
      });
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    describe("when the bulk team read is missing", () => {
      const notFound = Object.assign(new Error("404"), { response: { status: 404 } });

      beforeEach(() => {
        resetOnCallPolicyReviewed();
        window.localStorage.clear();
        service.listTeams.mockResolvedValue(axiosReply([team]));
        service.teamContext.mockRejectedValue(notFound);
      });
      afterEach(() => window.localStorage.clear());

      it("asks the missing bulk read once per load, not again for the checklist", async () => {
        service.getPolicy.mockResolvedValue(axiosReply({ rungs: [] }));
        service.listResponses.mockResolvedValue(axiosReply([page()]));
        render();
        await flushPromises();

        expect(service.teamContext).toHaveBeenCalledTimes(1);
        expect(service.getPolicy).toHaveBeenCalledTimes(1);
      });

      it("falls back to the team's own policy read", async () => {
        service.getPolicy.mockResolvedValue(axiosReply({ rungs: [] }));
        const wrapper = render();
        await flushPromises();

        expect(service.getPolicy).toHaveBeenCalledWith({
          org_identifier: "default",
          team_id: "team_1",
        });
        expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      });

      /// Neither read answered, so the step is unknown rather than owed.
      it("leaves the step unknown when the fallback fails too", async () => {
        service.getPolicy.mockRejectedValue(notFound);
        service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 1, teams: [team] }));
        const wrapper = render();
        await flushPromises();

        const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
        expect(checklist.props("hasPolicy")).toBeNull();
        expect(wrapper.find('[data-test="oncall-setup-step-policy"]').exists()).toBe(false);
      });

      it("hides the checklist when the unknown step is all that is left", async () => {
        service.getPolicy.mockRejectedValue(notFound);
        const wrapper = render();
        await flushPromises();

        expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      });
    });

    /// Reviewing the escalation from the checklist is the step, whatever the server says.
    it("counts a reviewed escalation as done", async () => {
      window.localStorage.setItem(`oncall-setup-policy-reviewed:default:${team.id}`, "1");
      resetOnCallPolicyReviewed();
      service.listTeams.mockResolvedValue(axiosReply([team]));
      answerTeams(() => ({ on_call: [], schedule: null }));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      window.localStorage.clear();
      resetOnCallPolicyReviewed();
    });

    /// Being on call is a fact about the reader, so an unfinished setup never hides it.
    it("shows the shift chip while setup is unfinished", async () => {
      const viewer = store.state.userInfo.email;
      service.listTeams.mockResolvedValue(axiosReply([team]));
      answerTeams(
        () => ({
          on_call: [{ rotation_id: "r1", rotation_name: "Primary", rule: "", user_email: viewer }],
          schedule: null,
        }),
        [team.id],
      );
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallSetupChecklist" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallShiftBanner" }).exists()).toBe(true);
    });

    it("keeps the shift chip after the setup bar is dismissed", async () => {
      resetOnCallSetupDismissed();
      const viewer = store.state.userInfo.email;
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.listOwnershipRules.mockResolvedValue(axiosReply([]));
      service.listResponses.mockResolvedValue(
        axiosReply([
          {
            id: "resp_1",
            org_id: "default",
            subject: { subject_type: "alert", source_id: "al_ckt", firing: 1 },
            team_id: null,
            priority: 1,
            state: "triggered",
            responder_role: "owner",
            title: "checkout_failing",
            opened_at: 1_700_000_000_000_000,
            acked_by: null,
            acked_at: null,
            closed_at: null,
          },
        ]),
      );
      answerTeams(
        () => ({
          on_call: [{ rotation_id: "r1", rotation_name: "Primary", rule: "", user_email: viewer }],
          schedule: null,
        }),
        [team.id],
      );
      const wrapper = mountTracked(OnCallResponses, {
        global: { plugins: [i18n, store], stubs: { ...stubs, OnCallSetupChecklist: false } },
      });
      await flushPromises();

      await wrapper.find('[data-test="oncall-setup-dismiss"]').trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallShiftBanner" }).exists()).toBe(true);
      resetOnCallSetupDismissed();
    });

    /// A server without the coverage-gap endpoint used to read as "zero gaps",
    /// which ticked the rotation step and hid the checklist on an org whose
    /// team had no rotation at all.
    it("asks each team directly when the coverage endpoint is unavailable", async () => {
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.coverageGaps.mockRejectedValue({ response: { status: 404 } });
      service.whoIsOnCall.mockResolvedValue(axiosReply([]));
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
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.coverageGaps.mockRejectedValue({ response: { status: 404 } });
      service.whoIsOnCall.mockResolvedValue(
        axiosReply([{ rotation: "Weekdays", user_email: "ana@corp.com" }]),
      );
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    it("disappears once a team is staffed and routed", async () => {
      service.listTeams.mockResolvedValue(axiosReply([team]));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(true);
    });

    // A checklist that flashes on every load would read as "your setup vanished".
    it("does not show before the first fetch resolves", () => {
      service.listResponses.mockReturnValue(new Promise<never>(() => {}));
      const wrapper = render();
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    /// The reported bug: the list and the setup facts come from two different
    /// fetches, and the setup defaults are all-false. The moment the LIST
    /// landed, a configured org was told to create a team — and on an org with
    /// no pages yet, setup took the whole screen before the table appeared.
    it("does not show while the setup fetch is still outstanding", async () => {
      service.listTeams.mockReturnValue(new Promise<never>(() => {}));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(false);
    });

    /// And the list must not flash its own empty state in that window either —
    /// "no pages yet" is the wrong answer to show while we still cannot tell
    /// whether setup owns the screen.
    it("holds the list in its loading state until setup has answered", async () => {
      service.listTeams.mockReturnValue(new Promise<never>(() => {}));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTable" }).props("loading")).toBe(true);
    });

    /// Teams did not answer, so "this org has no team" is the default we
    /// started from, not a fact. Its first step would be a lie.
    it("does not show when the teams call failed", async () => {
      service.listTeams.mockRejectedValue(new Error("boom"));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    // A failed fetch must not be mistaken for an empty org.
    it("does not show when the fetch failed", async () => {
      service.listResponses.mockRejectedValue(new Error("boom"));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    });

    /// Nothing has paged and the wiring is incomplete: there is no list worth
    /// showing, and an empty table under the checklist would offer "no pages
    /// yet" as though that were the healthy answer.
    it("is the whole screen when nothing has ever paged", async () => {
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-responses-table"]').exists()).toBe(false);
    });

    /// "Create a team" that lands on a list you then have to find a button in is
    /// the same click asked twice, and this step is only ever shown to an org
    /// that has no team to look at anyway.
    it("sends the first step to the teams screen with the form already open", async () => {
      const wrapper = render();
      await flushPromises();

      wrapper.findComponent({ name: "OnCallSetupChecklist" }).vm.$emit("create-team");

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "onCallTeams",
          query: expect.objectContaining({ action: "add" }),
        }),
      );
    });

    /// The other half of the same rule: pages exist, so the list is the work and
    /// setup shrinks to one line above it.
    it("collapses to a bar over the list once pages exist", async () => {
      service.listOwnershipRules.mockResolvedValue(axiosReply([]));
      service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 1, teams: [team] }));
      const wrapper = await withPages([page({ team_id: null })]);

      const checklist = wrapper.findComponent({ name: "OnCallSetupChecklist" });
      expect(checklist.exists()).toBe(true);
      expect(checklist.props("compact")).toBe(true);
      expect(wrapper.find('[data-test="oncall-responses-table"]').exists()).toBe(true);
    });

    // C4: a server-side filter that matches nothing is a filtered empty list, not an unpaged org.
    it.each([
      ["team", "oncall-responses-team-filter", "team_1"],
      ["cause", "oncall-responses-cause-filter", "genuine_defect"],
    ])("keeps the list when the %s filter matches nothing", async (_, test, value) => {
      service.listResponses.mockImplementation((params) =>
        Promise.resolve(axiosReply(params.team_id || params.cause ? [] : [page()])),
      );
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);

      wrapper
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === test)!
        .vm.$emit("update:modelValue", value);
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-responses-table"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OEmptyState" }).props("filtered")).toBe(true);

      wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action", "clear-filters");
      await flushPromises();
      expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
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

      service.listResponses.mockResolvedValue(axiosReply([page()]));
      await wrapper.find('[data-test="oncall-responses-refresh"]').trigger("click");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTable" }).props("error")).toBeNull();
    });
  });

  /// The team list is `oncall` LIST. Losing it must cost the filter, not the
  /// list somebody was paged about.
  it("disables the team filter when teams cannot be listed, and still lists pages", async () => {
    service.listTeams.mockRejectedValue({ response: { status: 403 } });
    service.listResponses.mockResolvedValue(axiosReply([page()]));
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
      service.listResponses.mock.calls.filter(
        ([args]) => (args as { offset?: number } | undefined)?.offset !== undefined,
      );

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
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.listResponses.mockResolvedValue(axiosReply(full));

      const wrapper = render();
      await flushPromises();

      // Three pages is the cap; the fourth is not requested.
      expect(pagingCalls()).toHaveLength(3);
      expect(pagingCalls().at(-1)?.[0]).toEqual(expect.objectContaining({ offset: 400 }));
      expect(wrapper.find('[data-test="oncall-responses-truncated"]').exists()).toBe(true);

      // Stopping at the cap is a fact about these rows, so it rides in the
      // cached value: a remount still says so without walking the pages again.
      wrapper.unmount();
      const again = render();
      await flushPromises();

      expect(pagingCalls()).toHaveLength(3);
      expect(again.find('[data-test="oncall-responses-truncated"]').exists()).toBe(true);
    }, 20_000);

    /// The truncation line never claims a total. `/responses/count` was
    /// invented by the client — no build has ever served it — so it 404'd on
    /// every load and the total was always unknown anyway.
    it("says how many it loaded without claiming that is all of them", async () => {
      const full = Array.from({ length: 200 }, (_, i) => page({ id: `r${i}` }, `al_${i}`));
      service.listTeams.mockResolvedValue(axiosReply([team]));
      service.listResponses.mockResolvedValue(axiosReply(full));

      const wrapper = render();
      await flushPromises();

      const line = wrapper.find('[data-test="oncall-responses-truncated"]').text();
      expect(line).toContain("600");
      expect(line).not.toContain(" of ");
    }, 20_000);
  });

  /// The team column is the answer to "who owns this page", and the question
  /// straight after it is "who is on that rotation" — which is a screen, not a
  /// string. The cell navigates there rather than making the reader find the
  /// team by name on another list.
  it("opens the team from the team column", async () => {
    const wrapper = await withPages([page()]);

    const cell = wrapper.find('[data-test^="oncall-row-team-"]');
    expect(cell.exists()).toBe(true);

    await cell.trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallTeamDetail",
        params: { teamId: "team_1" },
      }),
    );
  });

  /// The section headers already say ringing/handled/resolved, so a Status column only repeated them.
  it("has no Status column, and the always-shown Escalation column says what is happening", async () => {
    const wrapper = await withPages([page()]);
    const table = wrapper.findComponent({ name: "OTable" });
    const columns = table.props("columns") as TableColumn[];

    expect(columns.some((c) => c.id === "state")).toBe(false);
    expect(Object.keys(table.props("columnVisibility"))).not.toContain("state");
    expect(columns.find((c) => c.id === "escalation")!.hideable).not.toBe(true);
  });

  /// One signal: the ladder's own progress, which the "nobody answered" tag and the ladder text both read.
  it("tags nobody answered from the ladder's progress, before the record's flag lands", async () => {
    answerProgress((id) => ({
      fired: [{ after_micros: 0, at: 1, targets: [], reached: ["ana@o2.ai"] }],
      next_targets: [],
      next_at: null,
      exhausted: id === "resp_done",
    }));
    const wrapper = await withPages([
      page({ id: "resp_done", exhausted_at: null }, "al_done"),
      page({ id: "resp_live" }, "al_live"),
    ]);

    expect(wrapper.find('[data-test="oncall-escalation-cell-exhausted"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="oncall-escalation-cell-exhausted"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Ladder finished");
    expect(wrapper.text()).not.toContain("Triggered");
  });

  it("names a team missing from the loaded list as deleted, without a link", async () => {
    const wrapper = await withPages([page({ team_id: "team_gone" })]);

    expect(wrapper.findAll('a[data-test^="oncall-row-team-"]')).toHaveLength(0);
    const tag = wrapper.find('[data-test="oncall-row-team-deleted"]');
    expect(tag.text()).toBe("Deleted team");
  });

  it("says an unrouted page is unrouted, never a deleted team", async () => {
    const wrapper = await withPages([page({ team_id: null })]);

    expect(wrapper.find('[data-test="oncall-row-team-deleted"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Unrouted");
  });

  it("keeps the id when the team list could not be loaded", async () => {
    service.listTeams.mockRejectedValue(new Error("down"));
    service.listResponses.mockResolvedValue(axiosReply([page({ team_id: "team_gone" })]));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-row-team-deleted"]').exists()).toBe(false);
    expect(wrapper.find('[data-test^="oncall-row-team-"]').text()).toContain("team_gone");
  });

  it("names every filter for a screen reader", async () => {
    const wrapper = await withPages([page()]);
    await showAllTab(wrapper);

    for (const control of ["team-filter", "priority-filter", "cause-filter"]) {
      expect(
        wrapper.find(`[data-test="oncall-responses-${control}"]`).attributes("aria-label"),
      ).toBeTruthy();
    }
  });

  describe("list view state", () => {
    const seed = () =>
      useListViewState("oncall-responses", {
        search: "",
        teamFilter: "all",
        priorityFilter: "all",
        mineOnly: false,
        grouped: true,
        activeFilter: "all",
        causeFilter: "",
        currentPage: 1,
        pageSize: 20,
        sortBy: "last_alert_at",
        sortOrder: "desc",
      }) as Record<string, unknown>;

    const tabs = (w: VueWrapper) =>
      w
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === "oncall-responses-filter-tabs")!;

    /// An open-only tab fetches without resolved pages, so an empty answer must not take away the tabs that widen it.
    it("keeps the filter bar when an open-only tab fetches nothing", async () => {
      Object.assign(seed(), { activeFilter: "ringing" });
      const wrapper = await withPages([]);

      expect(tabs(wrapper)?.exists()).toBe(true);
    });

    /// An open-only tab never fetched resolved pages, so their count is unknown rather than zero.
    it.each(["ringing", "snoozed", "handled"])(
      "leaves the resolved and all counts off after a saved %s tab",
      async (tab) => {
        Object.assign(seed(), { activeFilter: tab });
        const wrapper = await withPages([page({ id: "a" })]);

        const labels = Object.fromEntries(
          (tabs(wrapper).props("options") as { value: string; label: string }[]).map((o) => [
            o.value,
            o.label,
          ]),
        );
        expect(labels.resolved).toBe("Resolved");
        expect(labels.all).toBe("All");
        expect(labels.ringing).toBe("Ringing · 1");
        expect(tabs(wrapper).props("modelValue")).toBe(tab);
      },
    );

    it("counts resolved pages once a resolved-showing tab has fetched them", async () => {
      Object.assign(seed(), { activeFilter: "ringing" });
      const wrapper = await withPages([page({ id: "a" })]);

      tabs(wrapper).vm.$emit("update:modelValue", "resolved");
      await flushPromises();

      const resolved = (tabs(wrapper).props("options") as { value: string; label: string }[]).find(
        (o) => o.value === "resolved",
      );
      expect(resolved?.label).toBe("Resolved · 0");
    });

    /// The Status column is gone, and a view saved while sorted by it must still load.
    it("falls back to the default sort when the saved view sorted by Status", async () => {
      Object.assign(seed(), { sortBy: "state" });
      const wrapper = await withPages([page()]);

      expect(wrapper.findComponent({ name: "OTable" }).props("sortBy")).toBe("last_alert_at");
    });

    it("restores the filter tab, page, page size and sort", async () => {
      Object.assign(seed(), {
        activeFilter: "ringing",
        teamFilter: "team_1",
        grouped: false,
        currentPage: 2,
        pageSize: 50,
        sortBy: "priority",
        sortOrder: "asc",
      });
      const wrapper = await withPages([page({ id: "a" })]);

      expect(tabs(wrapper).props("modelValue")).toBe("ringing");
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("currentPage")).toBe(2);
      expect(table.props("pageSize")).toBe(50);
      expect(table.props("sortBy")).toBe("priority");
      expect(table.props("sortOrder")).toBe("asc");
    });

    it("saves tab and table changes and resets the page on a filter change", async () => {
      const wrapper = await withPages([page({ id: "a" })]);
      const table = wrapper.findComponent({ name: "OTable" });
      table.vm.$emit("update:currentPage", 3);
      table.vm.$emit("update:sortBy", "priority");
      await flushPromises();

      tabs(wrapper).vm.$emit("update:modelValue", "handled");
      await flushPromises();

      const saved = seed();
      expect(saved.sortBy).toBe("priority");
      expect(saved.activeFilter).toBe("handled");
      expect(saved.currentPage).toBe(1);
    });

    it("lets ?mine=1 override a saved mine=false", async () => {
      Object.assign(seed(), { mineOnly: false });
      routeQuery.mine = "1";
      await withPages([page({ id: "a" })]);
      expect(seed().mineOnly).toBe(true);
    });
  });

  /// "My on-call" narrows THIS list. It used to navigate, which threw away
  /// every other filter the reader had set and answered the question from a
  /// different dataset on a different screen.
  describe("my on-call", () => {
    const scopeToggle = '[data-test="oncall-responses-scope"]';

    async function withMyShift(rows: Record<string, unknown>[]) {
      answerTeams((id) => ({
        ...emptyTeam,
        on_call: id === "team_1" ? [{ rotation: "Primary", user_email: "example@gmail.com" }] : [],
      }));
      return withPages(rows);
    }

    /// `?mine=1` is how the personal page hands "pages that need me" back to
    /// this list. It has to arrive already narrowed, or the link lands on a
    /// list answering a different question from the one that was clicked.
    it("opens already narrowed when it is linked to with mine=1", async () => {
      routeQuery.mine = "1";
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);

      const data = wrapper.findComponent({ name: "OTable" }).props("data") as TableRow[];
      expect(data.map((row) => row.latest.id)).toEqual(["a"]);
    });

    const ids = (wrapper: VueWrapper) =>
      (wrapper.findComponent({ name: "OTable" }).props("data") as TableRow[]).map(
        (row) => row.latest.id,
      );
    async function pick(wrapper: VueWrapper, value: "mine" | "everyone") {
      wrapper
        .findComponent('[data-test="oncall-responses-scope"]')
        .vm.$emit("update:modelValue", value);
      await flushPromises();
    }

    it("leads the filter bar with Mine and Everyone", async () => {
      const wrapper = await withMyShift([page({ id: "a" })]);
      const scope = wrapper.find(scopeToggle);
      expect(scope.text()).toContain("Mine");
      expect(scope.text()).toContain("Everyone");
      expect(wrapper.find('[data-test="oncall-responses-mine-btn"]').exists()).toBe(false);
    });

    /// Everyone is the default even while on call; Mine filters in place and never navigates.
    it("starts on Everyone for someone on call, and filters in place on Mine", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      expect(ids(wrapper)).toEqual(["a", "b"]);

      await pick(wrapper, "mine");
      expect(push).not.toHaveBeenCalled();
      expect(ids(wrapper)).toEqual(["a"]);
    });

    it("starts on Everyone for someone not on call", async () => {
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      expect(ids(wrapper)).toEqual(["a", "b"]);
    });

    it("starts on every page, resolved included", async () => {
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "r", state: "resolved", closed_at: 1_700_000_100_000_000 }, "al_old"),
      ]);
      const status = wrapper.findComponent('[data-test="oncall-responses-filter-tabs"]');
      expect(status.props("modelValue")).toBe("all");
      expect(status.props("searchable")).toBe(false);
      expect(ids(wrapper).sort()).toEqual(["a", "r"]);
    });

    it("keeps Mine once the reader picked it", async () => {
      useListViewState("oncall-responses", {}).mineOnly = true;
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      expect(ids(wrapper)).toEqual(["a"]);
    });

    /// The section headings claim to describe the rows, so the scope applies before the counts.
    it("counts the narrowed list, not the whole one", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      await pick(wrapper, "mine");
      expect(sections(wrapper)).toEqual({ ringing: 1 });
      await pick(wrapper, "everyone");
      expect(sections(wrapper)).toEqual({ ringing: 2 });
    });

    /// The acknowledgement outlives the shift: whoever claimed a page still owns it after handover.
    it("keeps a page the viewer acknowledged on another team", async () => {
      const wrapper = await withMyShift([
        page(
          { id: "b", team_id: "team_other", acked_by: "example@gmail.com", state: "acknowledged" },
          "al_pay",
        ),
      ]);
      expect(ids(wrapper)).toEqual(["b"]);
    });

    // The server lowercases an email on handoff but not on a self-ack.
    it("matches the owner regardless of case", async () => {
      const wrapper = await withMyShift([
        page(
          { id: "b", team_id: "team_other", acked_by: "Example@Gmail.com", state: "acknowledged" },
          "al_pay",
        ),
      ]);
      expect(ids(wrapper)).toEqual(["b"]);
    });

    it("switches both ways", async () => {
      const wrapper = await withMyShift([
        page({ id: "a" }),
        page({ id: "b", team_id: "team_other" }, "al_pay"),
      ]);
      await pick(wrapper, "everyone");
      expect(ids(wrapper)).toEqual(["a", "b"]);
      await pick(wrapper, "mine");
      expect(ids(wrapper)).toEqual(["a"]);
    });

    /// A toggle that can only ever empty the table is worse than no toggle.
    it("is absent when we do not know who is signed in", async () => {
      const original = store.state.userInfo;
      store.state.userInfo = {};
      try {
        const wrapper = await withPages([page()]);
        expect(wrapper.find(scopeToggle).exists()).toBe(false);
      } finally {
        store.state.userInfo = original;
      }
    });

    /// No filters before anything has paged: they could only narrow an empty list.
    it("shows no filter bar while there are no pages", async () => {
      const wrapper = await withMyShift([]);
      expect(wrapper.find(scopeToggle).exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-responses-filter-tabs"]').exists()).toBe(false);
    });

    /// Nothing of yours open is a real answer; "no pages at all" is not.
    it("offers to clear itself when it empties the list", async () => {
      const wrapper = await withMyShift([page({ id: "b", team_id: "team_other" }, "al_pay")]);
      await pick(wrapper, "mine");

      const empty = wrapper
        .findAllComponents({ name: "OEmptyState" })
        .find((node) => node.props("preset") === "no-oncall-responses");
      expect(empty?.props("filtered")).toBe(true);
    });

    it("counts down the handover of the rotation the viewer holds, not the first one", async () => {
      const nowMs = 1_786_000_000_000;
      const now = vi.spyOn(Date, "now").mockReturnValue(nowMs);
      const rule = (members: string[], shift_micros: number) => ({
        name: "Base",
        members,
        shift_micros,
        anchor_micros: 0,
      });
      // The viewer's team has no row on screen: only `include_mine` brings it into the answer.
      answerTeams(
        (id) =>
          id === "team_1"
            ? {
                ...emptyTeam,
                schedule: {
                  id: "sch_1",
                  org_id: "default",
                  team_id: "team_1",
                  timezone: "UTC",
                  created_at: 0,
                  updated_at: 0,
                  rotations: [
                    {
                      id: "rot_weekly",
                      name: "Primary",
                      shift_rules: [rule(["ana@o2.ai"], 604_800_000_000)],
                    },
                    {
                      id: "rot_hourly",
                      name: "Secondary",
                      shift_rules: [rule(["example@gmail.com"], 3_600_000_000)],
                    },
                  ],
                },
                on_call: [
                  {
                    rotation_id: "rot_weekly",
                    rotation_name: "Primary",
                    rule: "Base",
                    user_email: "ana@o2.ai",
                  },
                  {
                    rotation_id: "rot_hourly",
                    rotation_name: "Secondary",
                    rule: "Base",
                    user_email: "example@gmail.com",
                  },
                ],
              }
            : emptyTeam,
        ["team_1"],
      );
      try {
        const wrapper = await withPages([page({ team_id: "team_other" })]);

        const banner = wrapper.findComponent({ name: "OnCallShiftBanner" });
        expect(banner.props("rotation")).toBe("Secondary");
        // The next hour boundary, where the first rotation would have given the next week's.
        expect(banner.props("endsAt")).toBe(1_786_003_200_000_000);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe("request fan-out", () => {
    const position = (email: string) => ({
      rotation_id: "r",
      rotation_name: "Primary",
      rule: "Base",
      user_email: email,
    });
    const shownOnCall = (wrapper: VueWrapper) =>
      wrapper
        .findAll('[data-test^="oncall-oncallnow-"]:not([data-test="oncall-oncallnow-gap"])')
        .map((node) => node.text().trim());
    const pickTeam = (wrapper: VueWrapper, teamId: string) =>
      wrapper
        .findAllComponents({ name: "OSelect" })
        .find((node) => node.attributes("data-test") === "oncall-responses-team-filter")!
        .vm.$emit("update:modelValue", teamId);

    it("names an incident from the row's title, and the id when the row has none", async () => {
      const wrapper = await withPages([
        page({ id: "a", incident_id: "inc_1", incident_title: "Checkout down" }),
        page({ id: "b", incident_id: "inc_2" }, "al_b"),
      ]);

      const chips = wrapper.findAll('[data-test^="oncall-row-incident-"]').map((c) => c.text());
      expect(chips.sort()).toEqual(["Checkout down", "inc_2"]);
    });

    it("reads every team's context in one request, for the row teams and the viewer's", async () => {
      service.listTeams.mockResolvedValue(
        axiosReply([team, { ...team, id: "team_2", name: "Payments" }]),
      );
      service.listResponses.mockResolvedValue(
        axiosReply([
          page(),
          page({ id: "b", team_id: "team_2" }, "al_b"),
          page({ id: "c" }, "al_c"),
        ]),
      );
      render();
      await flushPromises();

      expect(service.teamContext).toHaveBeenCalledTimes(1);
      expect(service.teamContext).toHaveBeenCalledWith({
        org_identifier: "default",
        team_ids: ["team_1", "team_2"],
        include_mine: true,
      });
      expect(service.whoIsOnCall).not.toHaveBeenCalled();
    });

    it("splits row teams past the route's cap across context reads, asking for the viewer's once", async () => {
      // Mounting 205 rows takes over 2s on a fast CI runner and can pass the 5s default on a slow one.
      answerTeams((id) => ({ ...emptyTeam, on_call: [position(`${id}@o2.ai`)] }));
      const many = Array.from({ length: 205 }, (_, i) =>
        page({ id: `resp_${i}`, team_id: `team_${i}` }, `al_${i}`),
      );
      const wrapper = await withPages(many);

      const calls = service.teamContext.mock.calls.map(([args]) => args);
      expect(calls.map((c) => [c.team_ids.length, c.include_mine])).toEqual([
        [200, true],
        [5, false],
      ]);
      expect(shownOnCall(wrapper)).toContain("team_204@o2.ai");
    }, 20000);

    it("shows the on-call cell from the context answer", async () => {
      answerTeams(() => ({ ...emptyTeam, on_call: [position("ana@o2.ai")] }));
      const wrapper = await withPages([page()]);

      expect(shownOnCall(wrapper)).toEqual(["ana@o2.ai"]);
    });

    it("forces the context and ladder reads on refresh", async () => {
      const wrapper = await withPages([page()]);
      expect(service.teamContext).toHaveBeenCalledTimes(1);
      expect(service.escalationProgressBatch).toHaveBeenCalledTimes(1);

      await wrapper.find('[data-test="oncall-responses-refresh"]').trigger("click");
      await flushPromises();

      expect(service.teamContext).toHaveBeenCalledTimes(2);
      expect(service.escalationProgressBatch).toHaveBeenCalledTimes(2);
    });

    it("sends the context and ladder reads together, without waiting for the teams list", async () => {
      service.listTeams.mockReturnValue(new Promise<never>(() => {}));
      service.listResponses.mockResolvedValue(axiosReply([page()]));
      render();
      await flushPromises();

      expect(service.teamContext).toHaveBeenCalledTimes(1);
      expect(service.escalationProgressBatch).toHaveBeenCalledTimes(1);
    });

    it("keeps the newer context read when an older one answers last", async () => {
      const answerOld = deferredReply();
      service.teamContext.mockImplementation(({ team_ids }) =>
        team_ids.includes("team_1")
          ? answerOld.promise
          : Promise.resolve(
              axiosReply({
                teams: [{ team_id: "team_new", ...emptyTeam, on_call: [position("new@o2.ai")] }],
              }),
            ),
      );
      const wrapper = await withPages([page()]);
      service.listResponses.mockResolvedValue(
        axiosReply([page({ id: "n", team_id: "team_new" }, "al_new")]),
      );
      pickTeam(wrapper, "team_new");
      await flushPromises();

      answerOld.answer({
        teams: [{ team_id: "team_new", ...emptyTeam, on_call: [position("old@o2.ai")] }],
      });
      await flushPromises();

      expect(shownOnCall(wrapper)).toEqual(["new@o2.ai"]);
    });
  });

  /// During an incident the list IS the work surface. Opening 200 pages one at
  /// a time to claim them is not triage.
  describe("acting from the list", () => {
    it("acknowledges a single page without opening it", async () => {
      service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
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
    /// button would only produce an error. Split in two: the list is one cache
    /// entry per filter set, so a second mount in the same test would be served
    /// the first one's rows rather than the ones it just mocked.
    it("offers acknowledge while something in the row is escalating", async () => {
      const escalating = await withPages([page()]);
      expect(escalating.find('[data-test="oncall-row-ack-alert:al_ckt"]').exists()).toBe(true);
    });

    it("offers resolve rather than acknowledge once the row is owned", async () => {
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
      service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
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
      service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
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
      service.snoozeResponse.mockResolvedValue(axiosReply({}));
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

    /// The server refuses Snooze on a page with no team (one-ack AK-4), so bulk leaves it out and says why.
    it("leaves a teamless page out of a bulk snooze, and says so", async () => {
      service.snoozeResponse.mockResolvedValue(axiosReply({}));
      const wrapper = await withPages([
        page({ id: "a" }),
        page({ id: "b", team_id: null }, "al_pay"),
      ]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-snooze-30"]').trigger("click");
      await flushPromises();

      expect(service.snoozeResponse).toHaveBeenCalledTimes(1);
      expect(service.snoozeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "a" }),
      );
      expect(vi.mocked(toast)).toHaveBeenCalledWith({
        variant: "warning",
        message: "1 page has no team, so it was not snoozed. Hand it off to a team first.",
      });
    });

    it("snoozes nothing when every selected page has no team", async () => {
      const wrapper = await withPages([page({ id: "b", team_id: null }, "al_pay")]);

      wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-snooze-30"]').trigger("click");
      await flushPromises();

      expect(service.snoozeResponse).not.toHaveBeenCalled();
      expect(vi.mocked(toast)).not.toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success" }),
      );
    });

    /// Closing records in bulk is irreversible, so it asks first.
    it("confirms before bulk resolving, and resolves every unresolved firing", async () => {
      service.resolveResponse.mockResolvedValue(axiosReply({}));
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);

      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-resolve"]').trigger("click");
      await flushPromises();

      // Nothing is closed on the click alone.
      expect(service.resolveResponse).not.toHaveBeenCalled();

      await wrapper.find('[data-test="oncall-bulk-resolve-confirm"]').trigger("click");
      await flushPromises();

      expect(service.resolveResponse).toHaveBeenCalledTimes(2);
    });

    /// One page failing must not silently abandon the other ninety-nine.
    it("reports partial failure and still acknowledges the rest", async () => {
      service.acknowledgeResponse
        .mockResolvedValueOnce(axiosReply({}))
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

    describe("product analytics", () => {
      const tracked = (event: string) =>
        vi.mocked(analytics.track).mock.calls.filter((c) => c[0] === event);

      beforeEach(() => vi.mocked(analytics.track).mockClear());

      it("tracks one acknowledge per row action, counting every firing acknowledged", async () => {
        service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
        const wrapper = await withPages([
          page({ id: "f3", opened_at: 300 }),
          page({ id: "f2", opened_at: 200 }),
        ]);

        await wrapper.find('[data-test="oncall-row-ack-alert:al_ckt"]').trigger("click");
        await flushPromises();

        expect(tracked("oncall_page_acknowledged")).toEqual([
          ["oncall_page_acknowledged", { count: 2 }],
        ]);
      });

      it("counts only the acknowledgements that succeeded in a bulk action", async () => {
        service.acknowledgeResponse
          .mockResolvedValueOnce(axiosReply({}))
          .mockRejectedValueOnce(new Error("boom"));
        const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);
        wrapper
          .findComponent({ name: "OTable" })
          .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
        await flushPromises();

        await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
        await flushPromises();

        expect(tracked("oncall_page_acknowledged")).toEqual([
          ["oncall_page_acknowledged", { count: 1 }],
        ]);
      });

      it("tracks nothing when every acknowledgement failed", async () => {
        service.acknowledgeResponse.mockRejectedValue(new Error("boom"));
        const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);
        wrapper
          .findComponent({ name: "OTable" })
          .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
        await flushPromises();

        await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
        await flushPromises();

        expect(analytics.track).not.toHaveBeenCalled();
      });

      it("tracks one resolve per bulk action with its cause and count", async () => {
        service.resolveResponse.mockResolvedValue(axiosReply({}));
        const wrapper = await withPages([page({ id: "a" }), page({ id: "b" }, "al_pay")]);
        wrapper
          .findComponent({ name: "OTable" })
          .vm.$emit("update:selectedIds", ["alert:al_ckt", "alert:al_pay"]);
        await flushPromises();
        await wrapper.find('[data-test="oncall-bulk-resolve"]').trigger("click");
        await flushPromises();

        await wrapper.find('[data-test="oncall-bulk-resolve-confirm"]').trigger("click");
        await flushPromises();

        expect(tracked("oncall_page_resolved")).toEqual([
          ["oncall_page_resolved", { cause: "none", count: 2 }],
        ]);
      });

      it("tracks one resolve per row action", async () => {
        service.resolveResponse.mockResolvedValue(axiosReply({}));
        const wrapper = await withPages([
          page({ state: "acknowledged", acked_by: "engineer@example.com" }),
        ]);

        await wrapper.find('[data-test="oncall-row-resolve-alert:al_ckt"]').trigger("click");
        await flushPromises();

        expect(tracked("oncall_page_resolved")).toEqual([
          ["oncall_page_resolved", { cause: "none", count: 1 }],
        ]);
      });
    });

    /// The whole point of the Alert column: a woken engineer cannot act on a
    /// ksuid.
    it("shows the alert name, not the ksuid, and searches it", async () => {
      const wrapper = await withPages([page({ title: "checkout_failing" })]);
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as TableColumn[];
      const subject = columns.find((c) => c.id === "subject")!;
      const asRow = (p: { id: string }): TableRow => ({
        latest: p,
        firings: [p],
        escalating: [],
        rowKey: p.id,
      });
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

    (wrapper.vm as unknown as { priorityFilter: string }).priorityFilter = "3";
    await flushPromises();

    const data = wrapper.findComponent({ name: "OTable" }).props("data") as TableRow[];
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

      const data = wrapper.findComponent({ name: "OTable" }).props("data") as TableRow[];
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

  /// A phone has one toolbar row and one control per table row, so the laptop's spread is folded rather than clipped.
  describe("on a phone", () => {
    beforeEach(() => {
      mockViewport.mdUp = false;
      mockViewport.lgUp = false;
    });

    afterEach(() => {
      mockViewport.mdUp = true;
      mockViewport.lgUp = true;
    });

    it("moves the team, priority and cause filters behind one button", async () => {
      const wrapper = await withPages([page()]);
      await showAllTab(wrapper);

      expect(wrapper.find('[data-test="oncall-responses-filters-btn"]').exists()).toBe(true);
      const panel = wrapper.find('[data-test="oncall-responses-filters-panel"]');
      for (const control of ["team-filter", "priority-filter", "cause-filter", "group-toggle"]) {
        expect(panel.find(`[data-test="oncall-responses-${control}"]`).exists()).toBe(true);
        // Moved, not duplicated: a second copy left inline would wrap the row again.
        expect(wrapper.findAll(`[data-test="oncall-responses-${control}"]`)).toHaveLength(1);
      }
    });

    it("names the folded filters for a screen reader", async () => {
      const wrapper = await withPages([page()]);
      await showAllTab(wrapper);

      for (const control of ["team-filter", "priority-filter", "cause-filter"]) {
        expect(
          wrapper.find(`[data-test="oncall-responses-${control}"]`).attributes("aria-label"),
        ).toBeTruthy();
      }
    });

    /// The labelled button does not fit the one-control column, so the menu leads with the row's next step.
    it("leads the row menu with acknowledge while the page is ringing", async () => {
      service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
      const wrapper = await withPages([page()]);

      await wrapper.find('[data-test="oncall-row-ack-alert:al_ckt-menu"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
    });

    it("leads the row menu with resolve once the page is owned", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "engineer@example.com" }),
      ]);

      expect(wrapper.find('[data-test="oncall-row-resolve-alert:al_ckt-menu"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="oncall-row-ack-alert:al_ckt-menu"]').exists()).toBe(false);
    });

    /// A phone hides the inline icons, so a closed row still needs its ⋯ there.
    it("keeps the ⋯ menu on a closed row", async () => {
      const wrapper = await withPages([
        page({ state: "resolved", closed_at: Date.now() * 1000, acked_by: "ana@o2.ai" }),
      ]);

      const more = wrapper.find('[data-test="oncall-row-more-alert:al_ckt"]');
      expect(more.exists()).toBe(true);
      expect(more.classes()).not.toContain("md:hidden");
    });

    /// An open tooltip is the top layer, so leaving it on the trigger made Escape close the tooltip and not the menu.
    it("drops the ⋯ tooltip while its menu is open", async () => {
      const wrapper = await withPages([page({ state: "resolved", closed_at: Date.now() * 1000 })]);
      const menu = wrapper
        .findAllComponents({ name: "ODropdown" })
        .find((d) => d.find('[data-test="oncall-row-more-alert:al_ckt"]').exists())!;
      const tooltips = () =>
        menu
          .find('[data-test="oncall-row-more-alert:al_ckt"]')
          .findAllComponents({ name: "OTooltip" });
      expect(tooltips()).toHaveLength(1);

      menu.vm.$emit("update:open", true);
      await wrapper.vm.$nextTick();
      expect(tooltips()).toHaveLength(0);

      menu.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();
      expect(tooltips()).toHaveLength(1);
    });

    /// With no name on file the whole email is the only thing that tells two people apart.
    it("names a responder with no display name by the full email", async () => {
      const wrapper = await withPages([
        page({ state: "acknowledged", acked_by: "tl-eve-mvt9nu9l1842@maxxspace.com" }),
      ]);
      expect(wrapper.find('[data-test="oncall-responder-alert:al_ckt"]').text()).toBe(
        "tl-eve-mvt9nu9l1842@maxxspace.com",
      );
    });
  });
});

/// Two things the triage list already held and did not use.
describe("OnCallResponses — the rows' own fields", () => {
  const stubsForList = stubs;

  beforeEach(() => {
    vi.clearAllMocks();
    // The global teardown clears too, but a test that leaves a load in flight
    // repopulates the cache between the two hooks, and the next test would then
    // be served that entry instead of the mock it had just declared.
    queryClient.clear();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.listResponses.mockResolvedValue(axiosReply([]));
    service.listTeams.mockResolvedValue(axiosReply([]));
    service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 0, teams: [] }));
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    service.listOwnershipRules.mockResolvedValue(axiosReply([{ id: "rule_1" }]));
    destinations.list.mockResolvedValue(axiosReply([{ name: "dest_1" }]));
    answerTeams(() => emptyTeam);
    answerProgress(() => ({ fired: [], next_targets: [], next_at: null, exhausted: false }));
    service.getResponse.mockResolvedValue(axiosReply({ events: [] }));
  });

  function row(over: Record<string, unknown> = {}) {
    return {
      id: "resp_1",
      org_id: "default",
      // Distinct per row: the list groups by subject, so two rows sharing a
      // source_id collapse into one and only the latest firing renders.
      subject: { subject_type: "alert", source_id: String(over.id ?? "al_ckt"), firing: 1 },
      team_id: "team_1",
      priority: 1,
      state: "triggered",
      responder_role: "owner",
      title: "checkout_failing",
      opened_at: 1_700_000_000_000_000,
      ...over,
    };
  }

  async function withRows(rows: Record<string, unknown>[]) {
    service.listResponses.mockResolvedValue(axiosReply(rows));
    const wrapper = mountTracked(OnCallResponses, {
      global: { plugins: [i18n, store], stubs: stubsForList },
    });
    await flushPromises();
    return wrapper;
  }

  /// A page you fix and a blast radius you contain are different errands, and
  /// the field that tells them apart was on every row already. Without it the
  /// two are indistinguishable until you open one.
  describe("impacted rows", () => {
    it("badges a row that hangs off somebody else's record", async () => {
      const wrapper = await withRows([
        row({ id: "resp_1" }),
        row({ id: "resp_2", responder_role: "impacted", origin_response_id: "resp_1" }),
      ]);

      expect(wrapper.find('[data-test="oncall-impacted-resp_1"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-impacted-resp_2"]').exists()).toBe(true);
    });

    /// Either marker is enough, so a record carrying one and not the other —
    /// the shape a partial write leaves — still reads as what it is.
    it("badges on either marker", async () => {
      const wrapper = await withRows([
        row({ id: "resp_3", responder_role: "impacted" }),
        row({ id: "resp_4", origin_response_id: "resp_1" }),
      ]);

      expect(wrapper.find('[data-test="oncall-impacted-resp_3"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-impacted-resp_4"]').exists()).toBe(true);
    });
  });

  /// The filter narrowed the rows this page happened to have walked. Past the
  /// fetch cap, a team's older pages were simply not in the list — and the
  /// screen reported that by showing nothing rather than by saying so.
  describe("the team filter", () => {
    it("asks the server rather than filtering what it already loaded", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_1", name: "Platform" }]));
      const wrapper = await withRows([row()]);

      service.listResponses.mockClear();
      wrapper
        .findComponent('[data-test="oncall-responses-team-filter"]')
        .vm.$emit("update:modelValue", "team_1");
      await flushPromises();

      expect(service.listResponses).toHaveBeenCalled();
      expect(service.listResponses.mock.calls.at(-1)![0]).toMatchObject({ team_id: "team_1" });
    });

    /// Clearing sends no `team_id` — and because that is the same request the
    /// first load already made, the unfiltered walk comes back from the cache
    /// rather than off the wire. A filter that sent `team_id: "all"` would key
    /// itself differently and show up here as a round trip.
    it("sends no team_id when the filter is cleared, re-using the walk it already made", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_1", name: "Platform" }]));
      const wrapper = await withRows([row()]);
      const filter = wrapper.findComponent('[data-test="oncall-responses-team-filter"]');

      filter.vm.$emit("update:modelValue", "team_1");
      await flushPromises();
      expect(service.listResponses.mock.calls.at(-1)![0]).toMatchObject({ team_id: "team_1" });

      service.listResponses.mockClear();
      filter.vm.$emit("update:modelValue", "all");
      await flushPromises();

      expect(service.listResponses).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
    });

    /// A cached filter answers at once while a cold one is still on the wire,
    /// so the cold answer lands LAST — and must not paint its rows under a
    /// filter the reader has already left.
    it("ignores a slower answer for a filter the reader has already left", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_1", name: "Platform" }]));
      const wrapper = await withRows([row()]);
      const answerTeam = deferredReply();
      service.listResponses.mockImplementationOnce(() => answerTeam.promise);
      const filter = wrapper.findComponent('[data-test="oncall-responses-team-filter"]');

      filter.vm.$emit("update:modelValue", "team_1");
      await flushPromises();
      filter.vm.$emit("update:modelValue", "all");
      await flushPromises();
      answerTeam.answer([row({ id: "resp_t1" }), row({ id: "resp_t2" })]);
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
    });
  });

  /// A timeline is live state: the reader expands a row to see what has
  /// happened since, so every expand and every Refresh reaches the server.
  describe("the expanded row's timeline", () => {
    const ROW_KEY = "alert:al_ckt";

    async function withExpandedRow() {
      service.getResponse.mockResolvedValue(axiosReply({ response: row(), events: [] }));
      const wrapper = await withRows([row()]);
      wrapper.findComponent({ name: "OTable" }).vm.$emit("update:expandedIds", [ROW_KEY]);
      await flushPromises();
      expect(service.getResponse).toHaveBeenCalledTimes(1);
      return wrapper;
    }

    it("reads the timeline fresh each time the row is expanded", async () => {
      const wrapper = await withExpandedRow();
      const table = wrapper.findComponent({ name: "OTable" });

      table.vm.$emit("update:expandedIds", []);
      await flushPromises();
      table.vm.$emit("update:expandedIds", [ROW_KEY]);
      await flushPromises();

      expect(service.getResponse).toHaveBeenCalledTimes(2);
    });

    it("re-reads the open row's timeline on Refresh", async () => {
      const wrapper = await withExpandedRow();

      await wrapper.find('[data-test="oncall-responses-refresh"]').trigger("click");
      await flushPromises();

      expect(service.getResponse).toHaveBeenCalledTimes(2);
    });
  });
});

/// The server validates `cause`, `subject_type`+`source_id` and
/// `ownership_path` and the list offered none of them. A cause is the one
/// worth a control: it is written at resolve, and "what was a config change
/// last quarter" is a question about records far past any page cap.
describe("OnCallResponses — filtering by cause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The global teardown clears too, but a test that leaves a load in flight
    // repopulates the cache between the two hooks, and the next test would then
    // be served that entry instead of the mock it had just declared.
    queryClient.clear();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.listResponses.mockResolvedValue(axiosReply([]));
    service.listTeams.mockResolvedValue(axiosReply([]));
    service.coverageGaps.mockResolvedValue(axiosReply({ at: 0, total: 0, teams: [] }));
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    service.listOwnershipRules.mockResolvedValue(axiosReply([{ id: "rule_1" }]));
    destinations.list.mockResolvedValue(axiosReply([{ name: "dest_1" }]));
    answerTeams(() => emptyTeam);
    answerProgress(() => ({ fired: [], next_targets: [], next_at: null, exhausted: false }));
    service.getResponse.mockResolvedValue(axiosReply({ events: [] }));
  });

  /// The `data-test` lands as an ATTRIBUTE on the rendered root rather than on
  /// the component, which a CSS selector passed to `findComponent` does not
  /// match.
  const byTest = (wrapper: VueWrapper, name: string, test: string) =>
    wrapper.findAllComponents({ name }).find((c) => c.attributes("data-test") === test);

  const cause = (wrapper: VueWrapper) =>
    byTest(wrapper, "OSelect", "oncall-responses-cause-filter");
  const filterTabs = (wrapper: VueWrapper) =>
    byTest(wrapper, "OSelect", "oncall-responses-filter-tabs");

  /// With no pages the setup checklist owns the screen and the toolbar is not
  /// rendered at all, so these tests need something in the list before there
  /// is a filter to drive.
  async function open() {
    service.listResponses.mockResolvedValue(
      axiosReply([
        {
          id: "resp_1",
          org_id: "default",
          subject: { subject_type: "alert", source_id: "al_ckt", firing: 1 },
          team_id: "team_1",
          priority: 1,
          state: "triggered",
          responder_role: "owner",
          title: "checkout_failing",
          opened_at: 1_700_000_000_000_000,
        },
      ]),
    );
    const wrapper = mountTracked(OnCallResponses, {
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();
    return wrapper;
  }

  /// `"all"` includes resolved pages; every other tab but `"resolved"` itself excludes them.
  async function showResolved(wrapper: VueWrapper, on = true) {
    filterTabs(wrapper)!.vm.$emit("update:modelValue", on ? "all" : "ringing");
    await flushPromises();
  }

  // A cause is written at resolve, so filtering an open-only list by one could only ever empty it.
  it("is offered only while the tab includes resolved pages", async () => {
    const wrapper = await open();
    expect(cause(wrapper)).toBeDefined();

    await showResolved(wrapper, false);
    expect(cause(wrapper)).toBeUndefined();

    await showResolved(wrapper, true);
    expect(cause(wrapper)).toBeDefined();
  });

  it("asks the server for the cause rather than narrowing what it loaded", async () => {
    const wrapper = await open();
    await showResolved(wrapper);

    service.listResponses.mockClear();
    cause(wrapper)!.vm.$emit("update:modelValue", "config_change_or_deploy");
    await flushPromises();

    expect(service.listResponses.mock.calls.at(-1)![0]).toMatchObject({
      cause: "config_change_or_deploy",
      include_resolved: true,
    });
  });

  /// Clearing asks for the unfiltered list again, which is the request the
  /// first load already made — so it is answered from the cache. A cleared
  /// filter that still carried `cause: ""` would key itself apart from that
  /// entry and betray itself here as a round trip.
  it("sends no cause when the filter is cleared, re-using the walk it already made", async () => {
    const wrapper = await open();
    await showResolved(wrapper);
    cause(wrapper)!.vm.$emit("update:modelValue", "genuine_defect");
    await flushPromises();
    expect(service.listResponses.mock.calls.at(-1)![0]).toMatchObject({ cause: "genuine_defect" });

    service.listResponses.mockClear();
    cause(wrapper)!.vm.$emit("update:modelValue", "any");
    await flushPromises();

    expect(service.listResponses).not.toHaveBeenCalled();
    expect(cause(wrapper)!.props("modelValue")).toBe("any");
  });

  /// Left behind when resolved pages go, it would narrow an open list to
  /// nothing and read as an empty inbox.
  /// Narrowing away from resolved is client-side only now — `responses`
  /// already has everything, so there is nothing to refetch — but the value
  /// left behind still has to go, or a later fetch (team filter, refresh)
  /// would carry a cause across to a request it cannot apply to.
  it("clears itself when resolved pages leave the list, without a round trip", async () => {
    const wrapper = await open();
    await showResolved(wrapper);
    cause(wrapper)!.vm.$emit("update:modelValue", "noisy_threshold");
    await flushPromises();

    service.listResponses.mockClear();
    await showResolved(wrapper, false);
    await flushPromises();

    expect(service.listResponses).not.toHaveBeenCalled();
    expect(cause(wrapper)).toBeUndefined();

    await showResolved(wrapper, true);
    expect(cause(wrapper)!.props("modelValue")).toBe("any");
  });

  describe("inside the real Filters popover", () => {
    const panel = () => document.body.querySelector('[data-test="oncall-responses-filters-panel"]');
    const causeTrigger = () =>
      document.body.querySelector<HTMLElement>(
        '[data-test="oncall-responses-filters-panel"] [data-test="oncall-responses-cause-filter"] button[role="combobox"]',
      );

    async function openReal() {
      service.listResponses.mockResolvedValue(
        axiosReply([
          {
            id: "resp_1",
            org_id: "default",
            subject: { subject_type: "alert", source_id: "al_ckt", firing: 1 },
            team_id: "team_1",
            priority: 1,
            state: "triggered",
            responder_role: "owner",
            title: "checkout_failing",
            opened_at: 1_700_000_000_000_000,
          },
        ]),
      );
      const wrapper = mountTracked(OnCallResponses, {
        attachTo: document.body,
        global: {
          plugins: [i18n, store],
          stubs: { ...stubs, OPopover: false, OSelect: false, OButton: false },
        },
      });
      await flushPromises();
      await wrapper.find('[data-test="oncall-responses-filters-btn"]').trigger("click");
      await flushPromises();
      return wrapper;
    }

    async function pickCause(label: string) {
      causeTrigger()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
      const option = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      ).find((el) => el.textContent?.trim() === label);
      expect(option).toBeDefined();
      option!.focus();
      option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
    }

    it("commits a picked cause, keeps the popover open, and offers no search box", async () => {
      await openReal();
      expect(panel()).not.toBeNull();

      service.listResponses.mockClear();
      causeTrigger()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
      expect(document.body.querySelector('[role="listbox"] input')).toBeNull();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();

      await pickCause("Dependency failure");

      expect(service.listResponses.mock.calls.at(-1)![0]).toMatchObject({
        cause: "dependency_failure",
      });
      expect(panel()).not.toBeNull();
      expect(causeTrigger()!.textContent).toContain("Dependency failure");
    });

    /// The narrowed answer is empty, so reading it as "no pages" dropped the toolbar and the popover with it.
    it("clears back to any cause from an empty narrowed list without losing the popover", async () => {
      await openReal();
      service.listResponses.mockResolvedValue(axiosReply([]));
      await pickCause("Genuine defect");
      expect(panel()).not.toBeNull();

      await pickCause("Any cause");

      expect(panel()).not.toBeNull();
      expect(causeTrigger()!.textContent).toContain("Any cause");
      expect(document.body.querySelectorAll('[data-test="row"]')).toHaveLength(1);
    });

    it("toggles group by alert from inside the popover", async () => {
      await openReal();
      const box = document.body.querySelector<HTMLElement>(
        '[data-test="oncall-responses-group-toggle"] button[role="checkbox"], [data-test="oncall-responses-group-toggle"][role="checkbox"]',
      );
      expect(box).not.toBeNull();
      const before = box!.getAttribute("aria-checked");
      box!.click();
      await flushPromises();
      expect(box!.getAttribute("aria-checked")).not.toBe(before);
      expect(panel()).not.toBeNull();
    });
  });
});
