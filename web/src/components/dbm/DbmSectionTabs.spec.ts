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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

import DbmSectionTabs from "./DbmSectionTabs.vue";

const push = vi.fn(() => Promise.resolve());

let currentRoute = { name: "dbmQueries", query: {} as Record<string, unknown> };

vi.mock("vue-router", () => ({
  useRoute: () => currentRoute,
  useRouter: () => ({ push }),
}));

const mountAt = (name: string, query: Record<string, unknown> = {}) => {
  currentRoute = { name, query };
  push.mockClear();
  return mount(DbmSectionTabs, {
    props: { databaseCount: 2, queryCount: 34 },
    global: { plugins: [i18n] },
  });
};

/**
 * Switch tab through the `change` event OTabs really emits. A DOM click lands on
 * the consumer's wrapper element rather than Reka's roving-focus trigger, so it
 * never reaches the handler.
 */
const selectTab = async (wrapper: ReturnType<typeof mountAt>, key: string) => {
  const tabs = wrapper.findComponent({ name: "OTabs" });
  tabs.vm.$emit("change", key);
  await wrapper.vm.$nextTick();
};

describe("DbmSectionTabs", () => {
  describe("active tab follows the route", () => {
    it.each([
      ["dbmDatabases", "overview"],
      ["dbmQueries", "queries"],
      ["dbmSamples", "samples"],
      ["dbmActivity", "activity"],
      ["dbmDeadlocks", "deadlocks"],
      ["dbmBlocking", "blocked"],
    ])("lights %s as %s", (routeName, tabKey) => {
      expect(mountAt(routeName).findComponent({ name: "OTabs" }).props("modelValue")).toBe(tabKey);
    });

    /**
     * The detail route has no tab of its own, so it must resolve to the tab it
     * was opened FROM. Without this, drilling into a query unlights the tab the
     * user is conceptually still inside.
     */
    it("keeps Top queries lit on the query detail route", async () => {
      const wrapper = mountAt("dbmQueryDetail");
      await selectTab(wrapper, "queries");
      // Already the active tab, so no redundant navigation is issued.
      expect(push).not.toHaveBeenCalled();
    });

    /**
     * Four tabs can open the detail page, and the origin travels as `?from=`.
     * An Activity reader drilling into a session must see Activity stay lit —
     * lighting Top queries strands them on a tab they never stood on.
     */
    it.each([
      ["activity", "activity"],
      ["samples", "samples"],
      ["deadlocks", "deadlocks"],
      ["queries", "queries"],
    ])("lights %s on the detail route when from=%s", (from, tabKey) => {
      expect(
        mountAt("dbmQueryDetail", { from }).findComponent({ name: "OTabs" }).props("modelValue"),
      ).toBe(tabKey);
    });

    /** A stale or hand-edited origin must not light a tab that cannot open the detail page. */
    it("falls back to Top queries on the detail route for an unknown origin", () => {
      expect(
        mountAt("dbmQueryDetail", { from: "overview" })
          .findComponent({ name: "OTabs" })
          .props("modelValue"),
      ).toBe("queries");
    });

    /** `from` is a detail-page key; a list tab's URL must not inherit it. */
    it("drops the origin marker when switching to a list tab", async () => {
      const wrapper = mountAt("dbmQueryDetail", { from: "activity", range: "360" });
      await selectTab(wrapper, "overview");
      expect(push).toHaveBeenCalledWith({
        name: "dbmDatabases",
        query: { range: "360" },
      });
    });
  });

  describe("scope carries across tabs", () => {
    /**
     * The load-bearing departure from PipelineSectionTabs: both tabs describe
     * the same databases over the same window, so switching must not silently
     * reset the filters the user just set.
     */
    it("spreads the current filters and range into the target route", async () => {
      const wrapper = mountAt("dbmQueries", {
        org_identifier: "default",
        range: "360",
        instance: "orders-db.prod.internal",
        env: "prod",
      });
      // OTabs raises `change` from Reka's roving-focus trigger, which a
      // synthetic click on the wrapper does not reach — so the switch is driven
      // through the same event the component actually listens to.
      await selectTab(wrapper, "overview");
      expect(push).toHaveBeenCalledWith({
        name: "dbmDatabases",
        query: {
          org_identifier: "default",
          range: "360",
          instance: "orders-db.prod.internal",
          env: "prod",
        },
      });
    });

    it.each([
      ["samples", "dbmSamples"],
      ["activity", "dbmActivity"],
      ["deadlocks", "dbmDeadlocks"],
    ])("navigates to the %s route, carrying the scope", async (tabKey, routeName) => {
      const wrapper = mountAt("dbmQueries", { org_identifier: "default", range: "360" });
      await selectTab(wrapper, tabKey);
      expect(push).toHaveBeenCalledWith({
        name: routeName,
        query: { org_identifier: "default", range: "360" },
      });
    });

    /**
     * ...but a single query's identity is meaningless on a list, so it is
     * dropped rather than carried into a table's URL.
     */
    it("drops the query identity when leaving the detail page", async () => {
      const wrapper = mountAt("dbmQueryDetail", {
        org_identifier: "default",
        fingerprint: "311bbdbdf142596f",
        stream: "default",
        range: "60",
      });
      await selectTab(wrapper, "overview");
      expect(push).toHaveBeenCalledWith({
        name: "dbmDatabases",
        query: { org_identifier: "default", range: "60" },
      });
    });
  });

  describe("lock sections", () => {
    it("renders Deadlocks and Blocked queries as live tabs", () => {
      const wrapper = mountAt("dbmQueries");
      expect(wrapper.text()).toContain("Deadlocks");
      expect(wrapper.text()).toContain("Blocked queries");
      // Both navigate; neither is a placeholder.
      expect(wrapper.text()).not.toContain("soon");
    });

    it("navigates to the blocking route", async () => {
      const wrapper = mountAt("dbmQueries");
      await selectTab(wrapper, "blocked");
      expect(push).toHaveBeenCalledWith({ name: "dbmBlocking", query: {} });
    });
  });

  describe("activity section", () => {
    /**
     * Position is load-bearing: Activity answers "what is happening NOW", the
     * question a reader asks before drilling into one query, so it sits
     * immediately after Top queries and before the two lock tabs.
     *
     * Table health is LAST, and deliberately so. The five tabs before it all
     * answer "what is happening right now"; schema health is the slow-moving
     * background question, read after the live ones rather than before them.
     * It is also the only tab whose signal is Postgres-only, so it must not
     * sit where a MySQL reader meets an unexplained empty tab first.
     */
    it("orders the tabs Overview → Top queries → Slowest calls → Activity → Deadlocks → Blocked queries → Table health", () => {
      // Slowest calls sits beside Top queries: the two are the aggregate and
      // the per-execution view of the same client-observed data.
      const wrapper = mountAt("dbmQueries");
      const labels = wrapper
        .findAll("[data-test^='dbm-section-tab-']")
        .map((tab) => tab.attributes("data-test"));
      expect(labels).toEqual([
        "dbm-section-tab-overview",
        "dbm-section-tab-queries",
        "dbm-section-tab-samples",
        "dbm-section-tab-activity",
        "dbm-section-tab-deadlocks",
        "dbm-section-tab-blocked",
        "dbm-section-tab-tableHealth",
      ]);
    });

    // Activity's badge is the window population, not capped `hits.length` — the
    // component header's badge-grain rule.
    it("shows the session count the caller resolved", () => {
      const wrapper = mount(DbmSectionTabs, {
        props: { databaseCount: 2, queryCount: 34, activityCount: 5791 },
        global: { plugins: [i18n] },
      });
      expect(wrapper.text()).toContain("5791");
    });

    // The samples badge is the finished-call population, not the capped
    // top-list's row count — the component header's badge-grain rule.
    it("shows the finished-call population on the samples tab", () => {
      const wrapper = mount(DbmSectionTabs, {
        props: { databaseCount: 2, queryCount: 34, sampleCallsCount: 12483 },
        global: { plugins: [i18n] },
      });
      expect(wrapper.text()).toContain("12483");
    });
  });

  describe("counts", () => {
    it("shows each tab's row total so the other view's shape is visible", () => {
      const wrapper = mountAt("dbmQueries");
      expect(wrapper.text()).toContain("2");
      expect(wrapper.text()).toContain("34");
    });

    // Deadlocks badges EVENTS (43) while the table shows query PAIRS (2) — the
    // component header's badge-grain rule.
    it("shows the deadlock EVENT count, not the grouped pair count", () => {
      const wrapper = mount(DbmSectionTabs, {
        props: { databaseCount: 2, queryCount: 34, deadlockCount: 43, blockedCount: 6 },
        global: { plugins: [i18n] },
      });
      expect(wrapper.text()).toContain("43");
      expect(wrapper.text()).toContain("6");
    });

    it("omits a badge for a count the caller has not resolved", () => {
      const wrapper = mount(DbmSectionTabs, {
        props: { databaseCount: 2, queryCount: 34, deadlockCount: null },
        global: { plugins: [i18n] },
      });
      // A tab whose count is unknown shows no badge rather than a misleading 0.
      expect(wrapper.text()).toContain("Deadlocks");
    });
  });
});
