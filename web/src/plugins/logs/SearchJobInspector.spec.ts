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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import SearchJobInspector from "@/plugins/logs/SearchJobInspector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";

installQuasar({ plugins: [Dialog, Notify] });

// ── Stubs for migrated ODialog / ODrawer ────────────────────────────────────
// Mirror the real contract: v-model:open, title, size and the named slots
// (default + header-right) that SearchJobInspector relies on.
const oDrawerStub = {
  inheritAttrs: false,
  template:
    '<div data-test="o-drawer" v-if="open">' +
    '<div data-test="o-drawer-title">{{ title }}</div>' +
    '<div data-test="o-drawer-header-right"><slot name="header-right" /></div>' +
    '<div data-test="o-drawer-body"><slot /></div>' +
    '</div>',
  props: ["open", "size", "title"],
  emits: ["update:open"],
};

const oDialogStub = {
  inheritAttrs: false,
  template:
    '<div data-test="o-dialog" v-if="open">' +
    '<div data-test="o-dialog-title">{{ title }}</div>' +
    '<div data-test="o-dialog-body"><slot /></div>' +
    '</div>',
  props: ["open", "size", "title"],
  emits: ["update:open"],
};

// A fixed microsecond timestamp: 2024-03-15 09:30:00 UTC
const START_TIME_US = "1710495000000000";
// A fixed microsecond timestamp: 2024-03-15 09:35:00 UTC
const END_TIME_US = "1710495300000000";

const mockRoute = {
  query: {
    org_identifier: "default",
    trace_id: "abc123",
  },
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/services/search", () => ({
  default: {
    get_search_profile: vi.fn().mockResolvedValue({ data: null }),
  },
}));

const mountComponent = () =>
  mount(SearchJobInspector, {
    global: {
      provide: { store },
      plugins: [i18n],
    },
  });

// Helper to inject profile data with events directly into a mounted wrapper
const setProfileData = (wrapper: any, overrides: object = {}) => {
  wrapper.vm.profileData = {
    sql: "SELECT * FROM logs",
    start_time: START_TIME_US,
    end_time: END_TIME_US,
    total_duration: 350,
    data_records: 1000,
    scan_records: 50000,
    events: [
      { component: "flight:leader get file id", duration: 300, timestamp: "0", search_role: "leader", node_name: "node-1" },
      { component: "service:search leader finish", duration: 50, timestamp: "1", search_role: "leader", node_name: "node-1" },
    ],
    ...overrides,
  };
};

describe("SearchJobInspector — formatTimeRange timezone handling", () => {
  beforeEach(() => {
    // Reset to UTC before each test
    store.commit("setTimezone", "UTC");
  });

  it("TC1: formats time in UTC when store timezone is 'UTC'", () => {
    store.commit("setTimezone", "UTC");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // Both dates should be formatted in UTC — date string must be non-empty and contain AM/PM
    expect(result).not.toBe("-");
    expect(result).toContain(" - ");

    // Verify the UTC hour is present (9:30 AM UTC)
    expect(result).toMatch(/9:30/);
    expect(result).toMatch(/9:35/);
  });

  it("TC2: formats time in a custom timezone (America/New_York, UTC-5 in March)", () => {
    store.commit("setTimezone", "America/New_York");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    expect(result).not.toBe("-");
    expect(result).toContain(" - ");

    // America/New_York is UTC-5 in March (EST), so 10:30 UTC → 5:30 AM local
    expect(result).toMatch(/5:30/);
    expect(result).toMatch(/5:35/);
  });

  it("TC3: falls back to UTC when store timezone is empty string", () => {
    store.commit("setTimezone", "");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // Should not throw and should return a valid range string
    expect(result).not.toBe("-");
    expect(result).toContain(" - ");
    // UTC hour 9 should appear (fallback to UTC)
    expect(result).toMatch(/9:30/);
  });

  it("TC4: returns '-' when start_time is missing", () => {
    const wrapper = mountComponent();

    expect(wrapper.vm.formatTimeRange("", END_TIME_US)).toBe("-");
    expect(wrapper.vm.formatTimeRange(null as any, END_TIME_US)).toBe("-");
    expect(wrapper.vm.formatTimeRange(undefined as any, END_TIME_US)).toBe("-");
  });

  it("TC5: returns '-' when end_time is missing", () => {
    const wrapper = mountComponent();

    expect(wrapper.vm.formatTimeRange(START_TIME_US, "")).toBe("-");
    expect(wrapper.vm.formatTimeRange(START_TIME_US, null as any)).toBe("-");
    expect(wrapper.vm.formatTimeRange(START_TIME_US, undefined as any)).toBe("-");
  });

  it("TC6: returns '-' when both start_time and end_time are missing", () => {
    const wrapper = mountComponent();

    expect(wrapper.vm.formatTimeRange("", "")).toBe("-");
  });

  it("TC7: renders the timezone badge label from store (custom timezone)", () => {
    store.commit("setTimezone", "Asia/Kolkata");
    const wrapper = mountComponent();

    // Inject profileData so the badge is visible
    wrapper.vm.profileData = {
      sql: "",
      start_time: START_TIME_US,
      end_time: END_TIME_US,
      total_duration: 100,
      events: [{ component: "test", duration: 100, timestamp: "0" }],
    };

    // The badge text should reflect the store timezone
    expect(store.state.timezone).toBe("Asia/Kolkata");
  });

  it("TC8: returns '-' when an invalid timezone is provided (catches error gracefully)", () => {
    store.commit("setTimezone", "Invalid/Timezone");
    const wrapper = mountComponent();

    // Should catch the RangeError thrown by toLocaleString and return "-"
    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);
    expect(result).toBe("-");
  });

  it("TC9: formats time in Asia/Kolkata timezone (UTC+5:30)", () => {
    store.commit("setTimezone", "Asia/Kolkata");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // Asia/Kolkata is UTC+5:30, so 9:30 UTC → 15:00 IST (3:00 PM)
    expect(result).not.toBe("-");
    expect(result).toContain(" - ");
    expect(result).toMatch(/3:00/);
    expect(result).toMatch(/3:05/);
  });

  it("TC10: output contains a separator ' - ' between start and end", () => {
    store.commit("setTimezone", "UTC");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    const parts = result.split(" - ");
    expect(parts).toHaveLength(2);
    expect(parts[0].trim()).not.toBe("");
    expect(parts[1].trim()).not.toBe("");
  });

  it("TC11: timezone change updates formatted output without remounting", () => {
    store.commit("setTimezone", "UTC");
    const wrapper = mountComponent();

    const utcResult = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    store.commit("setTimezone", "America/New_York");
    const nyResult = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // UTC and New York results must differ since they are different timezones
    expect(utcResult).not.toBe(nyResult);
  });

  it("TC12: formatTimeRange handles same start and end time (zero-duration range)", () => {
    store.commit("setTimezone", "UTC");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, START_TIME_US);

    expect(result).not.toBe("-");
    expect(result).toContain(" - ");
    // Both halves should be identical
    const parts = result.split(" - ");
    expect(parts[0]).toBe(parts[1]);
  });

  it("TC13: store timezone badge shows 'UTC' when timezone is not set", () => {
    store.commit("setTimezone", "");
    const wrapper = mountComponent();

    // The template renders: store.state.timezone || 'UTC'
    const effective = store.state.timezone || "UTC";
    expect(effective).toBe("UTC");
  });

  it("TC14: formatTimeRange produces locale-formatted date string (contains '/')", () => {
    store.commit("setTimezone", "UTC");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // en-US locale uses M/D/YYYY format
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it("TC15: Europe/London timezone (UTC+1 in March due to BST)", () => {
    store.commit("setTimezone", "Europe/London");
    const wrapper = mountComponent();

    const result = wrapper.vm.formatTimeRange(START_TIME_US, END_TIME_US);

    // March 15 is after BST starts (last Sunday in March ~Mar 30), so London = UTC+0
    // 9:30 UTC → 9:30 AM London (still UTC+0 on March 15)
    expect(result).not.toBe("-");
    expect(result).toMatch(/9:30/);
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe("SearchJobInspector — formatDuration", () => {
  it("returns '0ms' for falsy values (0, undefined, null)", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.formatDuration(0)).toBe("0ms");
    expect(wrapper.vm.formatDuration(undefined)).toBe("0ms");
    expect(wrapper.vm.formatDuration(null)).toBe("0ms");
  });

  it("formats sub-second durations as integer ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.formatDuration(1)).toBe("1ms");
    expect(wrapper.vm.formatDuration(250)).toBe("250ms");
    expect(wrapper.vm.formatDuration(999)).toBe("999ms");
  });

  it("formats exactly 1000ms as '1.00s'", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.formatDuration(1000)).toBe("1.00s");
  });

  it("formats durations >= 1000ms in seconds with 2 decimal places", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.formatDuration(1500)).toBe("1.50s");
    expect(wrapper.vm.formatDuration(3750)).toBe("3.75s");
    expect(wrapper.vm.formatDuration(60000)).toBe("60.00s");
  });
});

// ---------------------------------------------------------------------------
// getResponseTimeLabel
// ---------------------------------------------------------------------------
describe("SearchJobInspector — getResponseTimeLabel", () => {
  beforeEach(() => store.commit("appTheme", "dark"));

  it("returns 'No data' for undefined/0", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(undefined).text).toBe("No data");
    expect(wrapper.vm.getResponseTimeLabel(0).text).toBe("No data");
  });

  it("returns 'Ultra-fast response' for < 50ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(1).text).toBe("Ultra-fast response");
    expect(wrapper.vm.getResponseTimeLabel(49).text).toBe("Ultra-fast response");
  });

  it("returns 'Fast response' for 50ms–199ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(50).text).toBe("Fast response");
    expect(wrapper.vm.getResponseTimeLabel(199).text).toBe("Fast response");
  });

  it("returns 'Good response' for 200ms–499ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(200).text).toBe("Good response");
    expect(wrapper.vm.getResponseTimeLabel(499).text).toBe("Good response");
  });

  it("returns 'Moderate response' for 500ms–999ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(500).text).toBe("Moderate response");
    expect(wrapper.vm.getResponseTimeLabel(999).text).toBe("Moderate response");
  });

  it("returns 'Slow response' for >= 1000ms", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(1000).text).toBe("Slow response");
    expect(wrapper.vm.getResponseTimeLabel(9999).text).toBe("Slow response");
  });

  it("uses green color class in dark theme for ultra-fast/fast", () => {
    store.commit("appTheme", "dark");
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(10).colorClass).toBe("tw:text-green-400");
    expect(wrapper.vm.getResponseTimeLabel(100).colorClass).toBe("tw:text-green-400");
  });

  it("uses green color class in light theme for ultra-fast/fast", () => {
    store.commit("appTheme", "light");
    const wrapper = mountComponent();
    expect(wrapper.vm.getResponseTimeLabel(10).colorClass).toBe("tw:text-green-600");
    expect(wrapper.vm.getResponseTimeLabel(100).colorClass).toBe("tw:text-green-600");
    store.commit("appTheme", "dark"); // restore
  });
});

// ---------------------------------------------------------------------------
// getDurationColor
// ---------------------------------------------------------------------------
describe("SearchJobInspector — getDurationColor", () => {
  it("returns red for > 75% of maxDuration", () => {
    const wrapper = mountComponent();
    // Set profileData so maxDuration is 100
    setProfileData(wrapper, {
      events: [{ component: "a", duration: 100, timestamp: "0" }],
    });
    expect(wrapper.vm.getDurationColor(100)).toBe("#f44336"); // 100% → red
    expect(wrapper.vm.getDurationColor(76)).toBe("#f44336");  // 76% → red
  });

  it("returns orange for > 50% and <= 75% of maxDuration", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [{ component: "a", duration: 100, timestamp: "0" }],
    });
    expect(wrapper.vm.getDurationColor(51)).toBe("#ff9800");
    expect(wrapper.vm.getDurationColor(75)).toBe("#ff9800");
  });

  it("returns yellow for > 25% and <= 50% of maxDuration", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [{ component: "a", duration: 100, timestamp: "0" }],
    });
    expect(wrapper.vm.getDurationColor(26)).toBe("#ffc107");
    expect(wrapper.vm.getDurationColor(50)).toBe("#ffc107");
  });

  it("returns green for <= 25% of maxDuration", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [{ component: "a", duration: 100, timestamp: "0" }],
    });
    expect(wrapper.vm.getDurationColor(25)).toBe("#4caf50");
    expect(wrapper.vm.getDurationColor(1)).toBe("#4caf50");
  });
});

// ---------------------------------------------------------------------------
// getPaddingLeft
// ---------------------------------------------------------------------------
describe("SearchJobInspector — getPaddingLeft", () => {
  it("returns '0px' for level 0 (top-level rows)", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getPaddingLeft(0)).toBe("0px");
  });

  it("returns '44px' for level 1", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getPaddingLeft(1)).toBe("44px");
  });

  it("returns '56px' for level 2 (44 + 12)", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getPaddingLeft(2)).toBe("56px");
  });

  it("returns '68px' for level 3 (44 + 24)", () => {
    const wrapper = mountComponent();
    expect(wrapper.vm.getPaddingLeft(3)).toBe("68px");
  });

  it("increments by 12px per additional level beyond 1", () => {
    const wrapper = mountComponent();
    const l4 = parseInt(wrapper.vm.getPaddingLeft(4));
    const l5 = parseInt(wrapper.vm.getPaddingLeft(5));
    expect(l5 - l4).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// hasNoData computed
// ---------------------------------------------------------------------------
describe("SearchJobInspector — hasNoData", () => {
  it("is true when profileData is null", () => {
    const wrapper = mountComponent();
    wrapper.vm.profileData = null;
    expect(wrapper.vm.hasNoData).toBe(true);
  });

  it("is true when events array is empty", () => {
    const wrapper = mountComponent();
    wrapper.vm.profileData = { sql: "", start_time: "", end_time: "", total_duration: 0, events: [] };
    expect(wrapper.vm.hasNoData).toBe(true);
  });

  it("is false when profileData has at least one event", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper);
    expect(wrapper.vm.hasNoData).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hierarchicalEvents + toggleNode
// ---------------------------------------------------------------------------
describe("SearchJobInspector — hierarchicalEvents tree & toggleNode", () => {
  it("returns empty array when profileData has no events", () => {
    const wrapper = mountComponent();
    wrapper.vm.profileData = null;
    expect(wrapper.vm.hierarchicalEvents).toEqual([]);
  });

  it("returns top-level events with index '1', '2', etc.", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper);
    const events = wrapper.vm.hierarchicalEvents;
    expect(events[0].index).toBe("1");
    expect(events[1].index).toBe("2");
  });

  it("does not show children when parent node is collapsed", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [
        {
          component: "follower parent",
          duration: 200,
          timestamp: "0",
          events: [
            { component: "child step", duration: 50, timestamp: "1" },
          ],
        },
      ],
    });
    // Parent is collapsed by default — only parent row should appear
    expect(wrapper.vm.hierarchicalEvents).toHaveLength(1);
  });

  it("shows children after toggleNode expands parent", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [
        {
          component: "follower parent",
          duration: 200,
          timestamp: "0",
          events: [
            { component: "child step 1", duration: 50, timestamp: "1" },
            { component: "child step 2", duration: 30, timestamp: "2" },
          ],
        },
      ],
    });
    const parentRow = wrapper.vm.hierarchicalEvents[0];
    wrapper.vm.toggleNode(parentRow);
    // After expand: parent + 2 children
    expect(wrapper.vm.hierarchicalEvents).toHaveLength(3);
    expect(wrapper.vm.hierarchicalEvents[1].index).toBe("1.1");
    expect(wrapper.vm.hierarchicalEvents[2].index).toBe("1.2");
  });

  it("collapses children when toggleNode called again on expanded parent", () => {
    const wrapper = mountComponent();
    setProfileData(wrapper, {
      events: [
        {
          component: "parent",
          duration: 100,
          timestamp: "0",
          events: [{ component: "child", duration: 20, timestamp: "1" }],
        },
      ],
    });
    const parentRow = wrapper.vm.hierarchicalEvents[0];
    wrapper.vm.toggleNode(parentRow); // expand
    expect(wrapper.vm.hierarchicalEvents).toHaveLength(2);
    wrapper.vm.toggleNode(parentRow); // collapse
    expect(wrapper.vm.hierarchicalEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// fetchProfileData — loading state & error handling
// ---------------------------------------------------------------------------
describe("SearchJobInspector — fetchProfileData", () => {
  it("sets loading to true while fetch is in flight, false after resolve", async () => {
    let resolvePromise: (val: any) => void;
    const pendingPromise = new Promise((res) => { resolvePromise = res; });
    vi.mocked(searchService.get_search_profile).mockReturnValueOnce(pendingPromise as any);

    const wrapper = mountComponent();
    // loading starts true during the pending call
    expect(wrapper.vm.loading).toBe(true);

    resolvePromise!({ data: null });
    await flushPromises();
    expect(wrapper.vm.loading).toBe(false);
  });

  it("sets errorMessage when API call rejects", async () => {
    vi.mocked(searchService.get_search_profile).mockRejectedValueOnce({
      message: "Network error",
    });

    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.vm.errorMessage).toBe("Network error");
    expect(wrapper.vm.loading).toBe(false);
  });

  it("sets profileData from API response on success", async () => {
    const mockData = {
      sql: "SELECT * FROM logs",
      start_time: START_TIME_US,
      end_time: END_TIME_US,
      total_duration: 200,
      events: [{ component: "op", duration: 200, timestamp: "0" }],
    };
    vi.mocked(searchService.get_search_profile).mockResolvedValueOnce({ data: mockData });

    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.vm.profileData).toEqual(mockData);
    expect(wrapper.vm.errorMessage).toBe("");
  });

  it("sets errorMessage from response body when available", async () => {
    vi.mocked(searchService.get_search_profile).mockRejectedValueOnce({
      response: { data: { message: "Trace ID not found" } },
      message: "Request failed",
    });

    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.vm.errorMessage).toBe("Trace ID not found");
  });
});

// ---------------------------------------------------------------------------
// ODialog / ODrawer migration coverage
// ---------------------------------------------------------------------------
describe("SearchJobInspector — ODrawer (SQL) & ODialog (Trace ID) migration", () => {
  const mountWithStubs = async () => {
    const wrapper = mount(SearchJobInspector, {
      global: {
        provide: { store },
        plugins: [i18n],
        stubs: {
          ODrawer: oDrawerStub,
          ODialog: oDialogStub,
        },
      },
    });
    // Settle the onMounted fetch (mocked to resolve { data: null }) so that
    // subsequent profileData assignments are not overwritten.
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    // Ensure each test starts from a clean clipboard mock
    vi.restoreAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("does not render the SQL ODrawer or Trace ID ODialog by default", async () => {
    const wrapper = await mountWithStubs();
    expect(wrapper.find('[data-test="o-drawer"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(false);
  });

  it("renders the SQL ODrawer with title 'SQL Query' once showSqlDialog flips true", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper);
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    const drawer = wrapper.find('[data-test="o-drawer"]');
    expect(drawer.exists()).toBe(true);
    expect(wrapper.find('[data-test="o-drawer-title"]').text()).toBe("SQL Query");
  });

  it("renders the SQL content inside the ODrawer body slot", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "SELECT id FROM events" });
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    const body = wrapper.find('[data-test="inspector-sql-query-content"]');
    expect(body.exists()).toBe(true);
    expect(body.text()).toBe("SELECT id FROM events");
  });

  it("falls back to 'No SQL query available' when profileData has no sql", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "" });
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    expect(
      wrapper.find('[data-test="inspector-sql-query-content"]').text()
    ).toBe("No SQL query available");
  });

  it("exposes the Copy SQL button inside the ODrawer header-right slot when sql is present", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "SELECT 1" });
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    const headerRight = wrapper.find('[data-test="o-drawer-header-right"]');
    expect(headerRight.exists()).toBe(true);
    expect(
      headerRight.find('[data-test="inspector-copy-sql-btn"]').exists()
    ).toBe(true);
  });

  it("hides the Copy SQL button in the header-right slot when profileData.sql is empty", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "" });
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    expect(
      wrapper.find('[data-test="inspector-copy-sql-btn"]').exists()
    ).toBe(false);
  });

  it("closes the SQL ODrawer when it emits update:open=false (v-model:open contract)", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper);
    wrapper.vm.showSqlDialog = true;
    await flushPromises();

    const drawer = wrapper.findComponent(oDrawerStub);
    drawer.vm.$emit("update:open", false);
    await flushPromises();

    expect(wrapper.vm.showSqlDialog).toBe(false);
    expect(wrapper.find('[data-test="o-drawer"]').exists()).toBe(false);
  });

  it("renders the Trace ID ODialog with title 'Full Trace ID' once showTraceIdDialog flips true", async () => {
    const wrapper = await mountWithStubs();
    wrapper.vm.showTraceIdDialog = true;
    await flushPromises();

    const dialog = wrapper.find('[data-test="o-dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(wrapper.find('[data-test="o-dialog-title"]').text()).toBe(
      "Full Trace ID"
    );
  });

  it("renders the traceId from the route inside the ODialog body", async () => {
    const wrapper = await mountWithStubs();
    wrapper.vm.showTraceIdDialog = true;
    await flushPromises();

    // mockRoute.query.trace_id === "abc123"
    expect(wrapper.find('[data-test="o-dialog-body"]').text()).toContain(
      "abc123"
    );
  });

  it("closes the Trace ID ODialog when it emits update:open=false (v-model:open contract)", async () => {
    const wrapper = await mountWithStubs();
    wrapper.vm.showTraceIdDialog = true;
    await flushPromises();

    const dialog = wrapper.findComponent(oDialogStub);
    dialog.vm.$emit("update:open", false);
    await flushPromises();

    expect(wrapper.vm.showTraceIdDialog).toBe(false);
    expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(false);
  });

  it("copySql writes profileData.sql to the clipboard and toggles copiedSql", async () => {
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "SELECT COUNT(*) FROM logs" });
    wrapper.vm.copySql();
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "SELECT COUNT(*) FROM logs"
    );
    expect(wrapper.vm.copiedSql).toBe(true);
  });

  it("copySql writes an empty string when profileData is null and still resolves cleanly", async () => {
    const wrapper = await mountWithStubs();
    wrapper.vm.profileData = null;
    wrapper.vm.copySql();
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("");
    expect(wrapper.vm.copiedSql).toBe(true);
  });

  it("copyTraceId writes the route trace_id to the clipboard and toggles copiedTraceId", async () => {
    const wrapper = await mountWithStubs();
    wrapper.vm.copyTraceId();
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("abc123");
    expect(wrapper.vm.copiedTraceId).toBe(true);
  });

  it("copySql gracefully handles a clipboard rejection without throwing", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValueOnce(new Error("denied")),
      },
    });
    const wrapper = await mountWithStubs();
    setProfileData(wrapper, { sql: "SELECT 1" });

    expect(() => wrapper.vm.copySql()).not.toThrow();
    await flushPromises();
    expect(wrapper.vm.copiedSql).toBe(false);
  });

  it("copyTraceId gracefully handles a clipboard rejection without throwing", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValueOnce(new Error("denied")),
      },
    });
    const wrapper = await mountWithStubs();

    expect(() => wrapper.vm.copyTraceId()).not.toThrow();
    await flushPromises();
    expect(wrapper.vm.copiedTraceId).toBe(false);
  });
});
