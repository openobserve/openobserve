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
    getHistory: vi.fn(),
  },
}));

import AlertEvaluationHistory from "./AlertEvaluationHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** One TriggerData record — one evaluation of the alert (D8). */
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

async function mountComp({
  hits = [makeEvaluation()],
  total = hits.length,
  alertId = "alert-1",
}: { hits?: any[]; total?: number; alertId?: string } = {}) {
  vi.mocked(alertsService.getHistory).mockResolvedValue({
    data: { hits, total },
  } as any);
  const wrapper = mount(AlertEvaluationHistory, {
    props: { alertId },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  // OTable holds its loading skeleton a minimum of 50ms; the instant mocks
  // land inside that hold.
  await new Promise((resolve) => setTimeout(resolve, 75));
  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AlertEvaluationHistory", () => {
  let wrapper: VueWrapper;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one row per evaluation with status and value context", async () => {
    wrapper = await mountComp({
      hits: [
        makeEvaluation(),
        makeEvaluation({
          timestamp: 1700000060000000,
          status: "conditionnotsatisfied",
          actual_value: 12.25,
          level: "ok",
        }),
      ],
    });
    expect(wrapper.find('[data-test="alerts-alertevaluationhistory-table"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="alerts-alertevaluationhistory-status"]')).toHaveLength(2);
    // conditionSummary: "actual operator threshold".
    expect(wrapper.text()).toContain("92.5 >= 80");
    expect(wrapper.text()).toContain("12.25 >= 80");
    // Evaluation and query durations.
    expect(wrapper.text()).toContain("0.412s");
    expect(wrapper.text()).toContain("231ms");
  });

  it("queries the history endpoint scoped to this alert", async () => {
    wrapper = await mountComp({ alertId: "alert-42" });
    expect(alertsService.getHistory).toHaveBeenCalledTimes(1);
    const [org, query] = vi.mocked(alertsService.getHistory).mock.calls[0];
    expect(org).toBe("default");
    expect(query.alert_id).toBe("alert-42");
    expect(query.from).toBe(0);
    expect(query.size).toBe(25);
    // Default window is the chart's default: the last hour.
    expect(query.end_time - query.start_time).toBe(60 * 60 * 1000 * 1000);
  });

  it("shows rows written before the value-context fields existed as em dashes", async () => {
    wrapper = await mountComp({
      hits: [
        makeEvaluation({
          actual_value: null,
          threshold_value: null,
          threshold_operator: null,
          level: null,
          evaluation_took_in_secs: null,
          query_took: null,
        }),
      ],
    });
    expect(wrapper.text()).toContain("—");
  });

  it("shows the empty state when no evaluations are in the window", async () => {
    wrapper = await mountComp({ hits: [] });
    expect(wrapper.find('[data-test="alerts-alertevaluationhistory-empty"]').exists()).toBe(true);
  });

  it("shows the empty state when the fetch fails", async () => {
    vi.mocked(alertsService.getHistory).mockRejectedValue(new Error("API Error"));
    wrapper = mount(AlertEvaluationHistory, {
      props: { alertId: "alert-1" },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-alertevaluationhistory-empty"]').exists()).toBe(true);
  });

  it("re-fetches with a wider window when the range changes", async () => {
    wrapper = await mountComp();
    const sixHours = wrapper
      .findAll('[data-test="alerts-alertevaluationhistory-range"] button')
      .find((b) => b.text().includes("6h"));
    expect(sixHours).toBeTruthy();
    await sixHours!.trigger("click");
    await flushPromises();
    expect(alertsService.getHistory).toHaveBeenCalledTimes(2);
    const [, query] = vi.mocked(alertsService.getHistory).mock.calls[1];
    expect(query.end_time - query.start_time).toBe(6 * 60 * 60 * 1000 * 1000);
    expect(query.from).toBe(0);
  });

  it("re-fetches when the refresh button is clicked", async () => {
    wrapper = await mountComp();
    await wrapper.find('[data-test="alerts-alertevaluationhistory-refresh"]').trigger("click");
    await flushPromises();
    expect(alertsService.getHistory).toHaveBeenCalledTimes(2);
  });
});
