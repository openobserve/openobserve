// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import AlertRecentRuns from "./AlertRecentRuns.vue";

const push = vi.fn();
const getHistory = vi.fn();

vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/composables/query", () => ({ useOrgId: () => computed(() => "default") }));
vi.mock("@/composables/downtimes/useViewerTimezone", () => ({
  useViewerTimezone: () => computed(() => "UTC"),
}));
vi.mock("@/services/alerts.queries", () => ({
  alertHistoryQuery: (org: string, query: Record<string, unknown>) => ({
    queryKey: ["recent-runs-test", org, query.alert_id, Math.random()],
    queryFn: () => getHistory(query),
  }),
}));

const at = (h: number, m: number) => Date.UTC(2026, 9, 30, h, m) * 1000;

describe("AlertRecentRuns", () => {
  beforeEach(() => {
    push.mockReset();
    getHistory.mockReset();
  });

  it("lists the newest runs first with their time and recorded outcome", async () => {
    getHistory.mockResolvedValue({
      hits: [
        { timestamp: at(9, 10), status: "firing" },
        { timestamp: at(14, 50), status: "normal" },
        { timestamp: at(3, 20), status: "error", error: "http 404: channel_not_found" },
      ],
    });
    const wrapper = mount(AlertRecentRuns, { props: { alertId: "a1", folderId: "f1" } });
    await flushPromises();
    const rows = wrapper.findAll('[data-test="add-alert-recent-run"]');
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain("Oct 30, 14:50");
    expect(rows[1].text()).toContain("Firing");
    expect(rows[2].find('[data-test="add-alert-recent-run-error"]').text()).toBe(
      "http 404: channel_not_found",
    );
    expect(rows[0].find('[data-test="add-alert-recent-run-error"]').exists()).toBe(false);
  });

  it("asks for the last day of this alert's runs, five at most", async () => {
    getHistory.mockResolvedValue({ hits: [] });
    mount(AlertRecentRuns, { props: { alertId: "a1" } });
    await flushPromises();
    const query = getHistory.mock.calls[0][0];
    expect(query).toMatchObject({ alert_id: "a1", from: 0, size: 5 });
    expect(query.end_time - query.start_time).toBe(24 * 60 * 60 * 1_000_000);
  });

  it("says so when there are no runs", async () => {
    getHistory.mockResolvedValue({ hits: [] });
    const wrapper = mount(AlertRecentRuns, { props: { alertId: "a1" } });
    await flushPromises();
    expect(wrapper.find('[data-test="add-alert-recent-runs-empty"]').exists()).toBe(true);
  });

  it("says so when the history cannot be read", async () => {
    getHistory.mockRejectedValue(new Error("boom"));
    const wrapper = mount(AlertRecentRuns, { props: { alertId: "a1" } });
    await flushPromises();
    expect(wrapper.find('[data-test="add-alert-recent-runs-error"]').exists()).toBe(true);
  });

  it("opens the run in the alert's history", async () => {
    getHistory.mockResolvedValue({ hits: [{ timestamp: at(1, 0), status: "normal" }] });
    const wrapper = mount(AlertRecentRuns, { props: { alertId: "a1", folderId: "f1" } });
    await flushPromises();
    await wrapper.find('[data-test="add-alert-recent-run-open"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "alertDetail",
      params: { alert_id: "a1" },
      query: { folder: "f1", org_identifier: "default" },
    });
  });
});
