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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import anomalyDetection from "@/services/anomaly_detection";
import AnomalyOriginBanner from "@/components/alerts/AnomalyOriginBanner.vue";
import { logsReapplyRequest } from "@/utils/queryHistory/logs";

vi.mock("@/services/anomaly_detection", () => ({
  default: { explore: vi.fn() },
}));

const explore = vi.mocked(anomalyDetection.explore);

const Blank = { template: "<div />" };

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/logs", name: "logs", component: Blank },
      { path: "/traces", name: "traces", component: Blank },
      { path: "/alerts/detail/:alert_id", name: "alertDetail", component: Blank },
    ],
  });

const VALUE_LINK = {
  stream: "k8s_logs",
  type: "search_scheduler",
  from_anomaly: "a1",
  anomaly_filter_applied: "1",
  anomaly_start: String(Date.parse("2026-11-16T18:00:00Z") * 1000),
  anomaly_end: String(Date.parse("2026-11-16T19:00:00Z") * 1000),
  anomaly_kind: "value",
  anomaly_measure: "count(*) per 15 min",
  anomaly_actual: "208",
  anomaly_lower: "120.4",
  anomaly_upper: "157.2",
};

let wrapper: ReturnType<typeof mount> | null = null;

const mountBanner = async (query: Record<string, string>) => {
  const router = makeRouter();
  await router.push({ name: "logs", query });
  wrapper = mount(AnomalyOriginBanner, { global: { plugins: [store, router] } });
  await flushPromises();
  return { wrapper, router };
};

const find = (key: string) =>
  wrapper!.find(`[data-test="alerts-anomalyoriginbanner${key ? `-${key}` : ""}"]`);

beforeEach(() => {
  explore.mockReset();
  explore.mockResolvedValue({ data: { name: "checkout-requests" } } as any);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AnomalyOriginBanner", () => {
  it("renders nothing on a page that was not opened from an anomaly", async () => {
    await mountBanner({ stream: "k8s_logs" });
    expect(find("").exists()).toBe(false);
    expect(explore).not.toHaveBeenCalled();
  });

  it("names the detector from one endpoint call with no window", async () => {
    await mountBanner(VALUE_LINK);
    expect(find("title").text()).toBe("Opened from anomaly checkout-requests");
    expect(explore).toHaveBeenCalledTimes(1);
    expect(explore.mock.calls[0][1]).toBe("a1");
    expect(explore.mock.calls[0][2]).toEqual({});
  });

  it("shows the values line from the link parameters", async () => {
    await mountBanner(VALUE_LINK);
    expect(find("values").text()).toBe(
      "count(*) per 15 min: actual 208.00, expected 120.40-157.20, 18:00-19:00 UTC",
    );
    expect(find("filter-not-applied").exists()).toBe(false);
  });

  it("shows no numbers for an absence and no range for a partial drop", async () => {
    await mountBanner({ ...VALUE_LINK, anomaly_kind: "absence", anomaly_actual: "" });
    expect(find("values").text()).toBe("No data for this detector's query since 18:00 UTC");
    wrapper?.unmount();
    await mountBanner({ ...VALUE_LINK, anomaly_kind: "partial_drop", anomaly_actual: "12" });
    expect(find("values").text()).toBe("count(*) per 15 min: actual 12.00, 18:00-19:00 UTC");
    wrapper?.unmount();
    await mountBanner({
      ...VALUE_LINK,
      anomaly_kind: "partial_drop",
      anomaly_actual: "12",
      anomaly_expected: "40",
    });
    expect(find("values").text()).toBe(
      "count(*) per 15 min: actual 12.00, expected 40.00, 18:00-19:00 UTC",
    );
  });

  it("shows the first line only for a link with no values", async () => {
    await mountBanner({ stream: "k8s_logs", from_anomaly: "a1" });
    expect(find("title").exists()).toBe(true);
    expect(find("values").exists()).toBe(false);
    wrapper?.unmount();
    // A shortened absence link keeps its start, and the sentence needs no measure.
    const { anomaly_measure: _measure, ...lean } = VALUE_LINK;
    await mountBanner({ ...lean, anomaly_kind: "absence", anomaly_actual: "" });
    expect(find("values").text()).toBe("No data for this detector's query since 18:00 UTC");
    wrapper?.unmount();
    const { anomaly_start: _start, ...noStart } = lean;
    await mountBanner({ ...noStart, anomaly_kind: "absence", anomaly_actual: "" });
    expect(find("values").text()).toBe("No data for this detector's query");
  });

  it("falls back to the unnamed title when the user cannot read the detector", async () => {
    explore.mockRejectedValue({ response: { status: 403 } });
    await mountBanner(VALUE_LINK);
    expect(find("title").text()).toBe("Opened from an anomaly");
    expect(find("values").exists()).toBe(true);
    expect(explore.mock.calls[0][3]).toEqual({ silentForbidden: true });
  });

  it("drops a cached name when a later lookup fails", async () => {
    await mountBanner(VALUE_LINK);
    expect(find("title").text()).toBe("Opened from anomaly checkout-requests");
    explore.mockRejectedValue({ response: { status: 500 } });
    await queryClient.refetchQueries();
    await flushPromises();
    expect(find("title").text()).toBe("Opened from an anomaly");
  });

  it("shows the amber note when the detector filter was not applied", async () => {
    await mountBanner({ ...VALUE_LINK, anomaly_filter_applied: "0" });
    const note = find("filter-not-applied");
    expect(note.text()).toBe(
      "Detector filter not applied: showing the whole stream around the anomaly",
    );
    expect(note.classes()).toContain("text-status-warning-text");
  });

  it("goes back to the anomaly detail page", async () => {
    const { router } = await mountBanner(VALUE_LINK);
    await find("back").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("alertDetail");
    expect(router.currentRoute.value.params.alert_id).toBe("a1");
  });

  it("closes by removing the banner parameters from the URL, keeping the rest", async () => {
    const { router } = await mountBanner(VALUE_LINK);
    await find("close").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      stream: "k8s_logs",
      type: "search_scheduler",
    });
    expect(find("").exists()).toBe(false);
  });

  it("stays after the page rewrites its URL with the shared helper", async () => {
    const { router } = await mountBanner(VALUE_LINK);
    const { copyAnomalyLinkParams } = await import("@/utils/alerts/anomalyLinkParams");
    await router.push({
      name: "logs",
      query: copyAnomalyLinkParams(router.currentRoute.value.query, {
        stream: "k8s_logs",
        query: "c2VsZWN0",
      }),
    });
    await flushPromises();
    expect(find("values").exists()).toBe(true);
  });

  describe("raw rows switch", () => {
    const AGGREGATE = { ...VALUE_LINK, query: "YWdn", anomaly_alt_query: "cmF3" };

    it("swaps the queries, flips the label and runs through the reapply path", async () => {
      const { router } = await mountBanner(AGGREGATE);
      const seq = logsReapplyRequest.value.seq;
      expect(find("switch-view").text()).toBe("Show raw rows");
      await find("switch-view").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({
        query: "cmF3",
        anomaly_alt_query: "YWdn",
        anomaly_view: "raw",
        from_anomaly: "a1",
        anomaly_start: VALUE_LINK.anomaly_start,
      });
      expect(logsReapplyRequest.value).toEqual({ seq: seq + 1, run: true });
      expect(find("values").exists()).toBe(true);
      expect(find("switch-view").text()).toBe("Show aggregate");
      await find("switch-view").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ query: "YWdn" });
      expect(router.currentRoute.value.query).not.toHaveProperty("anomaly_view");
      expect(logsReapplyRequest.value.seq).toBe(seq + 2);
      expect(find("switch-view").text()).toBe("Show raw rows");
    });

    it("reads the raw view of a refreshed URL", async () => {
      await mountBanner({ ...AGGREGATE, anomaly_view: "raw" });
      expect(find("switch-view").text()).toBe("Show aggregate");
    });

    it("has no switch without the second query, or off the Logs page", async () => {
      await mountBanner({ ...VALUE_LINK, query: "YWdn" });
      expect(find("switch-view").exists()).toBe(false);
      wrapper?.unmount();
      const router = makeRouter();
      await router.push({ name: "traces", query: AGGREGATE });
      wrapper = mount(AnomalyOriginBanner, { global: { plugins: [store, router] } });
      await flushPromises();
      expect(find("").exists()).toBe(true);
      expect(find("switch-view").exists()).toBe(false);
    });
  });
});
