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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";

vi.mock("@/services/alerts", () => ({
  default: {
    get_by_alert_id: vi.fn(),
    list_groups: vi.fn(),
    list_group_transitions: vi.fn(),
    getHistory: vi.fn(),
  },
}));

// The view reads its identity from the route; a hermetic route beats standing
// up the whole app router with its guards.
const mockRouterPush = vi.fn();
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      name: "alertDetail",
      path: "/alerts/detail/alert-1",
      params: { alert_id: "alert-1" },
      query: {},
      meta: {},
    }),
    useRouter: () => ({ push: mockRouterPush }),
  };
});

import AlertDetail from "@/views/alerts/AlertDetail.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import type { AlertGroupTransition } from "@/ts/interfaces/alert";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** A plain scheduled alert — no aggregation, so no groups and no multi_alert. */
function makeSimpleAlert() {
  return {
    id: "alert-1",
    name: "cpu-high",
    stream_name: "default",
    query_condition: {},
  };
}

function makeMultiAlert() {
  return {
    id: "alert-1",
    name: "cpu-per-host",
    stream_name: "default",
    query_condition: {
      aggregation: { group_by: ["host"], multi_alert: true },
    },
  };
}

function makeRollupTransition(
  overrides: Partial<AlertGroupTransition> = {},
): AlertGroupTransition {
  return {
    group_key: "",
    group_labels: "",
    from_level: "ok",
    to_level: "critical",
    from_outcome: "resolved",
    to_outcome: "firing",
    at: 1700000000000000,
    value: 1234.5,
    ...overrides,
  };
}

function makeGroupTransition(
  overrides: Partial<AlertGroupTransition> = {},
): AlertGroupTransition {
  return makeRollupTransition({
    group_key: "host=web-1",
    group_labels: "host=web-1",
    value: 6789.1,
    ...overrides,
  });
}

/** One TriggerData record from GET /alerts/history — one evaluation. */
function makeEvaluation(overrides: Record<string, any> = {}) {
  return {
    timestamp: 1700000000000000,
    status: "firing",
    actual_value: 92.5,
    threshold_operator: ">=",
    threshold_value: 80,
    level: "critical",
    evaluation_took_in_secs: 0.412,
    query_took: 231,
    error: null,
    ...overrides,
  };
}

async function mountView({
  alert = makeSimpleAlert(),
  transitions = [] as AlertGroupTransition[],
  evaluations = [] as any[],
  groupsResponse = { list: [], capped: false, group_cap: 100 } as Record<
    string,
    any
  >,
} = {}) {
  vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
    data: alert,
  } as any);
  vi.mocked(alertsService.list_groups).mockResolvedValue({
    data: groupsResponse,
  } as any);
  vi.mocked(alertsService.list_group_transitions).mockResolvedValue({
    data: { list: transitions },
  } as any);
  vi.mocked(alertsService.getHistory).mockResolvedValue({
    data: { hits: evaluations, total: evaluations.length },
  } as any);

  const wrapper = mount(AlertDetail, {
    global: {
      plugins: [i18n, store],
      stubs: {
        // The chart runs its own query pipeline on mount; the tabs under it
        // are what this spec is about.
        AlertGroupChart: true,
        AlertGroupsTable: true,
        AlertConfigSummary: true,
      },
    },
  });
  await flushPromises();
  // OTable holds its loading skeleton for a minimum of 50ms so it doesn't
  // flash on fast responses; the instantly-resolving mocks land inside that
  // hold, so wait it out before asserting on rows/empty states.
  await new Promise((resolve) => setTimeout(resolve, 75));
  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AlertDetail — History tab", () => {
  let wrapper: VueWrapper;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    wrapper?.unmount();
  });

  /** Flip the simple-alert History tab from Evaluations to Level changes. */
  async function switchToLevelChanges(w: VueWrapper) {
    await w
      .find('[data-test="alerts-alertdetail-history-view-transitions"]')
      .trigger("click");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await flushPromises();
  }

  describe("simple alert", () => {
    it("defaults to the per-evaluation record, not the old apology banner", async () => {
      wrapper = await mountView({
        evaluations: [makeEvaluation()],
        transitions: [makeRollupTransition()],
      });
      expect(
        wrapper
          .find('[data-test="alerts-alertdetail-history-view"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="alerts-alertevaluationhistory-table"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).not.toContain(
        "Per-group history is available for multi-alerts only",
      );
      // The evaluation's value context is on the page.
      expect(wrapper.text()).toContain("92.5 >= 80");
      expect(alertsService.getHistory).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ alert_id: "alert-1" }),
      );
    });

    it("shows the evaluations empty state when no runs are in the window", async () => {
      wrapper = await mountView({ evaluations: [] });
      expect(
        wrapper
          .find('[data-test="alerts-alertevaluationhistory-empty"]')
          .exists(),
      ).toBe(true);
    });

    it("Level changes view shows rollup transitions without the group column", async () => {
      wrapper = await mountView({
        transitions: [makeRollupTransition()],
      });
      await switchToLevelChanges(wrapper);
      expect(
        wrapper.find('[data-test="alerts-alertgrouphistory-table"]').exists(),
      ).toBe(true);
      // The rollup transition's value is on the page.
      expect(wrapper.text()).toContain("1234.5");
      expect(wrapper.find('[data-test="o2-table-th-group"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="o2-table-th-at"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="alerts-alertgrouphistory-filter"]').exists(),
      ).toBe(false);
    });

    it("Level changes keeps only rollup rows, hiding stale per-group leftovers", async () => {
      wrapper = await mountView({
        transitions: [makeRollupTransition(), makeGroupTransition()],
      });
      await switchToLevelChanges(wrapper);
      expect(wrapper.text()).toContain("1234.5");
      expect(wrapper.text()).not.toContain("6789.1");
      expect(wrapper.text()).not.toContain("host=web-1");
    });

    it("Level changes shows the normal empty state when the rollup has no transitions yet", async () => {
      wrapper = await mountView({ transitions: [] });
      await switchToLevelChanges(wrapper);
      expect(
        wrapper.find('[data-test="alerts-alertgrouphistory-empty"]').exists(),
      ).toBe(true);
    });

    it("Level changes shows the empty state when only stale per-group rows exist", async () => {
      wrapper = await mountView({
        transitions: [makeGroupTransition()],
      });
      await switchToLevelChanges(wrapper);
      expect(
        wrapper.find('[data-test="alerts-alertgrouphistory-empty"]').exists(),
      ).toBe(true);
    });

    it("has no groups tab and never fetches groups", async () => {
      wrapper = await mountView({
        transitions: [makeRollupTransition()],
      });
      expect(wrapper.find('[data-otab-name="groups"]').exists()).toBe(false);
      expect(alertsService.list_groups).not.toHaveBeenCalled();
    });
  });

  describe("multi alert (unchanged behaviour)", () => {
    it("defaults to the groups tab and fetches groups", async () => {
      wrapper = await mountView({ alert: makeMultiAlert() });
      expect(wrapper.find('[data-otab-name="groups"]').exists()).toBe(true);
      expect(alertsService.list_groups).toHaveBeenCalledWith(
        "default",
        "alert-1",
      );
    });

    it("keeps the group column and shows every group's transitions", async () => {
      wrapper = await mountView({
        alert: makeMultiAlert(),
        transitions: [makeRollupTransition(), makeGroupTransition()],
      });
      // Reka's TabsTrigger activates on mousedown/focus, not click.
      const historyTab = wrapper.find('[data-otab-name="history"]');
      await historyTab.trigger("mousedown", { button: 0 });
      await historyTab.trigger("focus");
      await historyTab.trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="o2-table-th-group"]').exists()).toBe(
        true,
      );
      // Unfiltered: the per-group row AND the rollup row both render.
      expect(wrapper.text()).toContain("host=web-1");
      expect(wrapper.text()).toContain("6789.1");
      expect(wrapper.text()).toContain("1234.5");
      // No Evaluations/Level-changes toggle and no per-evaluation fetch —
      // the multi-alert history view is exactly what it was.
      expect(
        wrapper
          .find('[data-test="alerts-alertdetail-history-view"]')
          .exists(),
      ).toBe(false);
      expect(alertsService.getHistory).not.toHaveBeenCalled();
    });

    it("shows the firing count as a badge on the Groups tab", async () => {
      wrapper = await mountView({
        alert: makeMultiAlert(),
        groupsResponse: {
          list: [],
          capped: false,
          group_cap: 100,
          groups_firing: 3,
          groups_observed: 12,
        },
      });
      const badge = wrapper.find(
        '[data-test="alerts-alertdetail-tab-groups-count"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("3");
    });

    it("marks a lower-bound firing count with ≥ on the badge", async () => {
      wrapper = await mountView({
        alert: makeMultiAlert(),
        groupsResponse: {
          list: [],
          capped: false,
          group_cap: 100,
          groups_firing: 5,
          groups_firing_is_lower_bound: true,
        },
      });
      expect(
        wrapper
          .find('[data-test="alerts-alertdetail-tab-groups-count"]')
          .text(),
      ).toBe("≥5");
    });

    it("shows no badge when nothing is firing — zero is calm", async () => {
      wrapper = await mountView({
        alert: makeMultiAlert(),
        groupsResponse: {
          list: [],
          capped: false,
          group_cap: 100,
          groups_firing: 0,
          groups_observed: 12,
        },
      });
      expect(wrapper.find('[data-otab-name="groups"]').exists()).toBe(true);
      expect(
        wrapper
          .find('[data-test="alerts-alertdetail-tab-groups-count"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("tab strip placement", () => {
    it("renders the tabs in the body, below the evaluation chart, not in the header", async () => {
      wrapper = await mountView({ evaluations: [makeEvaluation()] });
      const tabs = wrapper.find('[data-test="alerts-alertdetail-tabs"]');
      expect(tabs.exists()).toBe(true);
      // Not inside the page header...
      expect(tabs.element.closest(".app-page-header")).toBeNull();
      // ...but after the chart in document order.
      const chart = wrapper.find("alert-group-chart-stub");
      expect(chart.exists()).toBe(true);
      expect(
        chart.element.compareDocumentPosition(tabs.element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});
