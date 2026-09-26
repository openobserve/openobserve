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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import ExemplarCard from "./ExemplarCard.vue";
import type { ExemplarMarker, TraceVerdict } from "@/ts/interfaces/exemplars";

const TS = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

const marker = (over: Partial<ExemplarMarker> = {}): ExemplarMarker => ({
  id: "m",
  queryIndexes: [0],
  tsMs: TS,
  value: 0.123456,
  labels: { trace_id: "abc123", span_id: "s1", http_route: "/pay" },
  seriesLabels: {},
  traceId: "abc123",
  spanId: "s1",
  ...over,
});

const queryLabels = [
  { index: 0, name: "Query A", query: "histogram_quantile(0.99, rate(x_bucket[5m]))" },
  { index: 1, name: "Query B", query: "histogram_quantile(0.5, rate(x_bucket[5m]))" },
];

const mountCard = (props: Record<string, unknown> = {}) =>
  mount(ExemplarCard, {
    props: {
      marker: marker(),
      queryLabels,
      unit: undefined,
      decimals: 3,
      timezone: "UTC",
      verdict: { state: "checking" } as TraceVerdict,
      anchor: new DOMRect(100, 100, 0, 0),
      ...props,
    },
    global: { plugins: [i18n], stubs: { teleport: true } },
  });

const byTest = (wrapper: ReturnType<typeof mountCard>, id: string) =>
  wrapper.find(`[data-test="${id}"]`);

describe("ExemplarCard", () => {
  it("formats the value with the panel unit and decimals", () => {
    const text = byTest(mountCard(), "dashboard-panel-exemplar-value").text();
    expect(text).toContain("0.123");
    expect(text).not.toContain("0.123456");
    const seconds = byTest(mountCard({ unit: "seconds" }), "dashboard-panel-exemplar-value").text();
    expect(seconds).toBe("123.456ms");
  });

  it("shows the timestamp in the selected timezone", () => {
    expect(byTest(mountCard(), "dashboard-panel-exemplar-time").text()).toBe(
      "2026-01-02 03:04:05.678",
    );
    expect(
      byTest(mountCard({ timezone: "Asia/Kolkata" }), "dashboard-panel-exemplar-time").text(),
    ).toBe("2026-01-02 08:34:05.678");
  });

  it("names its single query in a chip and no longer prints the query text", () => {
    const wrapper = mountCard();
    const tags = wrapper.findAll('[data-test="dashboard-panel-exemplar-query"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].text()).toBe("Query A");
    expect(tags[0].attributes("data-query-index")).toBe("0");
    expect(tags[0].attributes("title")).toBe(queryLabels[0].query);
    expect(byTest(wrapper, "dashboard-panel-exemplar-query-text").exists()).toBe(false);
  });

  it("tags every query that returned a shared exemplar and says how many", () => {
    const wrapper = mountCard({ marker: marker({ queryIndexes: [0, 1] }) });
    const tags = wrapper.findAll('[data-test="dashboard-panel-exemplar-query"]');
    expect(tags.map((t) => t.attributes("data-query-index"))).toEqual(["0", "1"]);
    expect(byTest(wrapper, "dashboard-panel-exemplar-returned-by").text()).toBe(
      "Returned by 2 queries",
    );
    expect(byTest(wrapper, "dashboard-panel-exemplar-query-text").exists()).toBe(false);
  });

  it("lists the exemplar's own labels, without trace_id, span_id or internal fields", () => {
    const wrapper = mountCard({
      marker: marker({
        labels: { trace_id: "abc123", span_id: "s1", http_route: "/pay", flag: "x" },
      }),
    });
    expect(byTest(wrapper, "dashboard-panel-exemplar-label-http_route").text()).toContain("/pay");
    for (const key of ["trace_id", "span_id", "flag"]) {
      expect(byTest(wrapper, `dashboard-panel-exemplar-label-${key}`).exists()).toBe(false);
    }
  });

  it("shows the full 32-character trace_id in monospace, wrapping instead of truncating", () => {
    const id = "0123456789abcdef0123456789abcdef";
    for (const verdict of [
      { state: "found", stream: "default", startUs: 1, endUs: 2 },
      { state: "not_available" },
      { state: "unverified", reason: "timeout" },
      { state: "checking" },
    ] as TraceVerdict[]) {
      const wrapper = mountCard({
        marker: marker({ traceId: id, labels: { trace_id: id } }),
        verdict,
      });
      const shown = byTest(wrapper, "dashboard-panel-exemplar-trace-id");
      expect(shown.text()).toBe(id);
      expect(shown.classes()).toEqual(expect.arrayContaining(["font-mono", "break-all"]));
      expect(shown.classes()).not.toContain("truncate");
      expect(shown.classes()).not.toContain("whitespace-nowrap");
      expect(shown.text()).not.toContain("…");
      const block = byTest(wrapper, "dashboard-panel-exemplar-trace");
      expect(block.find('[data-test="dashboard-panel-exemplar-trace-id"]').exists()).toBe(true);
    }
  });

  it("puts the trace action before the labels so it is never below the fold", () => {
    const html = mountCard().html();
    expect(html.indexOf('data-test="dashboard-panel-exemplar-trace"')).toBeLessThan(
      html.indexOf('data-test="dashboard-panel-exemplar-labels"'),
    );
  });

  it("never renders series labels", () => {
    const wrapper = mountCard({
      marker: marker({ seriesLabels: { service_name: "api", aggregation_temporality: "x" } }),
    });
    expect(byTest(wrapper, "dashboard-panel-exemplar-series-labels").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("aggregation_temporality");
  });

  it("shows the true value and a note for a clamped marker", () => {
    const wrapper = mountCard({ marker: marker({ value: 500 }), clamped: "top", decimals: 0 });
    expect(byTest(wrapper, "dashboard-panel-exemplar-value").text()).toContain("500");
    expect(byTest(wrapper, "dashboard-panel-exemplar-clamped-note").text()).toBe(
      "Above the chart range; drawn at the top edge",
    );
  });

  it("shows a disabled checking action while the lookup runs", () => {
    const wrapper = mountCard();
    expect(byTest(wrapper, "dashboard-panel-exemplar-tooltip").attributes("data-trace-state")).toBe(
      "checking",
    );
    const action = byTest(wrapper, "dashboard-panel-exemplar-trace-checking");
    expect(action.attributes("disabled")).toBeDefined();
    expect(action.text()).toContain("Checking trace");
  });

  it("offers Open trace once found and emits on click", async () => {
    const wrapper = mountCard({
      verdict: { state: "found", stream: "default", startUs: 1, endUs: 2 },
    });
    expect(byTest(wrapper, "dashboard-panel-exemplar-tooltip").attributes("data-trace-state")).toBe(
      "found",
    );
    await byTest(wrapper, "dashboard-panel-exemplar-open-trace").trigger("click");
    expect(wrapper.emitted("open-trace")).toHaveLength(1);
  });

  it("shows a not-available trace as a muted line that wraps inside the card", () => {
    const wrapper = mountCard({ verdict: { state: "not_available" } });
    const line = byTest(wrapper, "dashboard-panel-exemplar-trace-unavailable");
    expect(line.element.tagName).not.toBe("BUTTON");
    expect(line.attributes("aria-disabled")).toBe("true");
    expect(line.text()).toContain("Trace not available — sampled out or past retention");
    expect(line.classes()).toEqual(expect.arrayContaining(["whitespace-normal", "break-words"]));
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("never lets trace text overflow the card sideways", () => {
    for (const verdict of [
      { state: "not_available" },
      { state: "unverified", reason: "forbidden" },
    ] as TraceVerdict[]) {
      const id = "fedcba9876543210fedcba9876543210";
      const wrapper = mountCard({ marker: marker({ traceId: id }), verdict });
      const root = byTest(wrapper, "dashboard-panel-exemplar-tooltip");
      expect(root.classes()).toContain("overflow-x-hidden");
      const trace = byTest(wrapper, "dashboard-panel-exemplar-trace");
      const nowrap = trace
        .findAll("*")
        .filter((el) => el.element.tagName !== "BUTTON" && el.text().length > 30)
        .filter((el) => el.classes().includes("whitespace-nowrap"));
      expect(nowrap).toHaveLength(0);
    }
  });

  it.each([
    ["timeout", "timed out"],
    ["forbidden", "may not have access"],
    ["partial", "Only part of the retention"],
    ["error", "Couldn't check"],
  ] as const)("labels an unverified (%s) trace and still lets it open", async (reason, hint) => {
    const wrapper = mountCard({ verdict: { state: "unverified", reason } });
    const action = byTest(wrapper, "dashboard-panel-exemplar-open-trace-unverified");
    expect(action.attributes("data-reason")).toBe(reason);
    expect(action.text()).toBe("Open trace (unverified)");
    expect(wrapper.text()).toContain(hint);
    await action.trigger("click");
    expect(wrapper.emitted("open-trace")).toHaveLength(1);
  });

  it("explains a missing trace_id and offers no trace action", () => {
    const wrapper = mountCard({
      marker: marker({ traceId: undefined, labels: { pod: "a" } }),
      verdict: { state: "none" },
    });
    expect(byTest(wrapper, "dashboard-panel-exemplar-no-trace").text()).toContain("trace_id");
    expect(byTest(wrapper, "dashboard-panel-exemplar-open-trace").exists()).toBe(false);
    expect(byTest(wrapper, "dashboard-panel-exemplar-open-trace-unverified").exists()).toBe(false);
    expect(byTest(wrapper, "dashboard-panel-exemplar-labels").text()).toContain("pod");
  });
});
