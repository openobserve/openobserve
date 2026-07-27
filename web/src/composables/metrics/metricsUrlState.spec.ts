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

import { describe, it, expect } from "vitest";
import {
  getMetricsConfig,
  encodeMetricsConfig,
  decodeMetricsConfig,
  applyMetricsBlob,
  applyDeepLinkOverrides,
  METRICS_BLOB_VERSION,
} from "./metricsUrlState";
import { b64EncodeUnicode, b64DecodeUnicodeSafe } from "@/utils/zincutils";
import { hasAnyDeepLinkParam } from "@/utils/url/deepLinkParams";
import { METRICS_PARAMS } from "@/utils/metrics/metricsParamRegistry";
import { queryParamsToSelectedDate } from "@/utils/dashboard/urlTimeParams";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import store from "@/stores";

// a realistic panel (real default shape) with some edits to round-trip
const makePanel = () => {
  const p = getDefaultDashboardPanelData(store);
  p.data.id = "panel-1";
  p.data.title = "My Panel";
  p.data.description = "desc";
  p.data.type = "bar";
  p.data.queryType = "promql";
  p.data.queries[0].query = "rate(cpu[5m])";
  p.data.queries[0].fields.stream = "cpu";
  p.data.queries[0].fields.stream_type = "logs"; // should be forced to metrics on apply
  return p;
};

describe("metricsUrlState · getMetricsConfig", () => {
  it("returns { v, data } with the current blob version", () => {
    const cfg = getMetricsConfig(makePanel());
    expect(cfg.v).toBe(METRICS_BLOB_VERSION);
    expect(cfg.data).toBeTruthy();
  });
  it("strips volatile bits (id/title/description)", () => {
    const cfg = getMetricsConfig(makePanel());
    expect(cfg.data.id).toBeUndefined();
    expect(cfg.data.title).toBeUndefined();
    expect(cfg.data.description).toBeUndefined();
  });
  it("keeps the meaningful panel fields", () => {
    const cfg = getMetricsConfig(makePanel());
    expect(cfg.data.type).toBe("bar");
    expect(cfg.data.queryType).toBe("promql");
    expect(cfg.data.queries[0].query).toBe("rate(cpu[5m])");
  });
  it("is a deep, non-reactive clone (mutating the result never touches the source)", () => {
    const panel = makePanel();
    const cfg = getMetricsConfig(panel);
    cfg.data.queries[0].query = "changed";
    expect(panel.data.queries[0].query).toBe("rate(cpu[5m])");
  });
  it("handles a panel with no data", () => {
    const cfg = getMetricsConfig({} as any);
    expect(cfg).toEqual({ v: METRICS_BLOB_VERSION, data: {} });
  });
});

describe("metricsUrlState · encode/decode round-trip", () => {
  it("encodes then decodes back to an equivalent blob", () => {
    const cfg = getMetricsConfig(makePanel());
    const decoded = decodeMetricsConfig(encodeMetricsConfig(cfg));
    expect(decoded).toEqual(cfg);
  });
  it("encodes to a non-empty string that is not raw JSON", () => {
    const blob = encodeMetricsConfig(getMetricsConfig(makePanel()));
    expect(typeof blob).toBe("string");
    expect(blob.length).toBeGreaterThan(0);
    expect(blob.startsWith("{")).toBe(false);
  });
});

describe("metricsUrlState · decodeMetricsConfig (defensive)", () => {
  it("returns null for null/empty/undefined", () => {
    expect(decodeMetricsConfig(null)).toBeNull();
    expect(decodeMetricsConfig("")).toBeNull();
    expect(decodeMetricsConfig(undefined)).toBeNull();
  });
  it("returns null for invalid base64", () => {
    expect(decodeMetricsConfig("!!!not-base64!!!")).toBeNull();
  });
  it("returns null when the decoded text is not JSON", () => {
    expect(decodeMetricsConfig(b64EncodeUnicode("hello") as string)).toBeNull();
  });
  it("returns null when the blob has no `data`", () => {
    expect(decodeMetricsConfig(b64EncodeUnicode('{"v":1}') as string)).toBeNull();
  });
  it("returns null for a mismatched version (gate)", () => {
    const future = encodeMetricsConfig({ v: 999, data: { type: "bar" } });
    expect(decodeMetricsConfig(future)).toBeNull();
  });
  it("returns null for a JSON array (has no `data`)", () => {
    expect(decodeMetricsConfig(b64EncodeUnicode("[1,2,3]") as string)).toBeNull();
  });
  it("returns null for a JSON primitive", () => {
    expect(decodeMetricsConfig(b64EncodeUnicode("42") as string)).toBeNull();
  });
});

describe("metricsUrlState · applyMetricsBlob", () => {
  it("applies a valid blob in place and returns true", () => {
    const blob = encodeMetricsConfig(getMetricsConfig(makePanel()));
    const target = getDefaultDashboardPanelData(store);
    const dataRef = target.data;
    const ok = applyMetricsBlob(blob, target);
    expect(ok).toBe(true);
    expect(target.data).toBe(dataRef); // same reactive .data reference
    expect(target.data.type).toBe("bar");
    expect(target.data.queries[0].query).toBe("rate(cpu[5m])");
  });
  it("forces stream_type=metrics on every query", () => {
    const blob = encodeMetricsConfig(getMetricsConfig(makePanel()));
    const target = getDefaultDashboardPanelData(store);
    applyMetricsBlob(blob, target);
    expect(target.data.queries[0].fields.stream_type).toBe("metrics");
  });
  it("resets layout.currentQueryIndex to 0", () => {
    const blob = encodeMetricsConfig(getMetricsConfig(makePanel()));
    const target = getDefaultDashboardPanelData(store);
    target.layout.currentQueryIndex = 5;
    applyMetricsBlob(blob, target);
    expect(target.layout.currentQueryIndex).toBe(0);
  });
  it("returns false and leaves the panel untouched for an invalid blob", () => {
    const target = getDefaultDashboardPanelData(store);
    target.data.type = "line";
    const ok = applyMetricsBlob("garbage!!!", target);
    expect(ok).toBe(false);
    expect(target.data.type).toBe("line");
  });

  it("forces stream_type=metrics on EVERY query of a multi-query blob", () => {
    const src = getDefaultDashboardPanelData(store);
    src.data.queries.push(JSON.parse(JSON.stringify(src.data.queries[0])));
    src.data.queries[0].query = "q0";
    src.data.queries[0].fields.stream_type = "logs";
    src.data.queries[1].query = "q1";
    src.data.queries[1].fields.stream_type = "logs";
    const blob = encodeMetricsConfig(getMetricsConfig(src));

    const target = getDefaultDashboardPanelData(store);
    applyMetricsBlob(blob, target);
    expect(target.data.queries).toHaveLength(2);
    expect(target.data.queries[0].query).toBe("q0");
    expect(target.data.queries[1].query).toBe("q1");
    expect(target.data.queries[0].fields.stream_type).toBe("metrics");
    expect(target.data.queries[1].fields.stream_type).toBe("metrics");
  });
});

describe("metricsUrlState · applyDeepLinkOverrides (integration)", () => {
  it("applies chart_type + stream_name + base64 query onto the panel", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(
      {
        chart_type: "bar",
        stream_name: "cpu",
        query: b64EncodeUnicode("rate(cpu[5m])") as string,
      },
      dpd,
    );
    expect(dpd.data.type).toBe("bar");
    expect(dpd.data.queries[0].fields.stream).toBe("cpu");
    expect(dpd.data.queries[0].fields.stream_type).toBe("metrics");
    expect(dpd.data.queries[0].query).toBe("rate(cpu[5m])");
    expect(dpd.data.queries[0].customQuery).toBe(true);
  });

  it("builds TWO queries from query.0 + query.1 when there is NO metrics_data", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(
      {
        "query.0": b64EncodeUnicode("rate(cpu[5m])") as string,
        "query.1": b64EncodeUnicode("rate(mem[5m])") as string,
      },
      dpd,
    );
    expect(dpd.data.queries).toHaveLength(2);
    expect(dpd.data.queries[0].query).toBe("rate(cpu[5m])");
    expect(dpd.data.queries[0].customQuery).toBe(true);
    expect(dpd.data.queries[1].query).toBe("rate(mem[5m])");
    expect(dpd.data.queries[1].customQuery).toBe(true);
  });

  it("builds TWO queries from bare query + query.1 when there is NO metrics_data", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(
      {
        query: b64EncodeUnicode("rate(cpu[5m])") as string,
        "query.1": b64EncodeUnicode("rate(mem[5m])") as string,
      },
      dpd,
    );
    expect(dpd.data.queries).toHaveLength(2);
    expect(dpd.data.queries[0].query).toBe("rate(cpu[5m])");
    expect(dpd.data.queries[1].query).toBe("rate(mem[5m])");
  });

  it("accepts the legacy `stream` alias (real alerts/logs/incidents deep-link)", () => {
    const dpd = getDefaultDashboardPanelData(store);
    // a real alerts -> metrics link uses `stream` (NOT stream_name) + base64 query
    applyDeepLinkOverrides(
      {
        stream_type: "metrics",
        stream: "container_cpu_usage",
        query: b64EncodeUnicode('(container_cpu_usage{k8s_namespace_name="dev"}) >= 0.5') as string,
      },
      dpd,
    );
    expect(dpd.data.queries[0].fields.stream).toBe("container_cpu_usage");
    expect(dpd.data.queries[0].fields.stream_type).toBe("metrics");
    expect(dpd.data.queries[0].query).toBe(
      '(container_cpu_usage{k8s_namespace_name="dev"}) >= 0.5',
    );
    expect(dpd.data.queries[0].customQuery).toBe(true);
  });

  it("prefers canonical `stream_name` over the legacy `stream` alias when both present", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides({ stream_name: "canonical", stream: "legacy" }, dpd);
    expect(dpd.data.queries[0].fields.stream).toBe("canonical");
  });

  it("compacts a leading gap when there is no metrics_data base", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides({ "query.1": b64EncodeUnicode("B") as string }, dpd);
    // no blob -> compactIndices true -> single query at slot 0
    expect(dpd.data.queries).toHaveLength(1);
    expect(dpd.data.queries[0].query).toBe("B");
  });

  it("keeps literal indices (surgical) when a metrics_data base is present", () => {
    const dpd = getDefaultDashboardPanelData(store);
    // pretend the page already has a 2-query base
    dpd.data.queries = [
      { ...dpd.data.queries[0], query: "q0" },
      { ...JSON.parse(JSON.stringify(dpd.data.queries[0])), query: "q1" },
    ];
    applyDeepLinkOverrides(
      {
        metrics_data: "present",
        "query.1": b64EncodeUnicode("OVR") as string,
      },
      dpd,
    );
    expect(dpd.data.queries).toHaveLength(2);
    expect(dpd.data.queries[0].query).toBe("q0"); // untouched
    expect(dpd.data.queries[1].query).toBe("OVR"); // surgical override
  });

  it("is a no-op for queries when no override params are present", () => {
    const dpd = getDefaultDashboardPanelData(store);
    dpd.data.queries[0].query = "keep";
    applyDeepLinkOverrides({ org_identifier: "x" }, dpd);
    expect(dpd.data.queries).toHaveLength(1);
    expect(dpd.data.queries[0].query).toBe("keep");
  });
});

// Exercises a verbatim, real alerts -> metrics deep-link URL end-to-end:
// /web/metrics?stream_type=metrics&stream=container_cpu_usage&stream_value=…
//   &from=<µs>&to=<µs>&query=<b64>&org_identifier=default&type=alerts&show_histogram=false
describe("metricsUrlState · real alerts deep-link URL", () => {
  const URL_STR =
    "http://localhost:8081/web/metrics?stream_type=metrics&stream=container_cpu_usage" +
    "&stream_value=container_cpu_usage&from=1781243646093750&to=1781244060000000" +
    "&query=KGNvbnRhaW5lcl9jcHVfdXNhZ2V7azhzX25hbWVzcGFjZV9uYW1lPSJkZXYifSkgPj0gMC41" +
    "&org_identifier=default&type=alerts&show_histogram=false";

  // route.query is a flat string map; reproduce it from the URL.
  const queryFromUrl = (url: string): Record<string, string> => {
    const sp = new URL(url).searchParams;
    const q: Record<string, string> = {};
    sp.forEach((v, k) => (q[k] = v));
    return q;
  };
  const query = queryFromUrl(URL_STR);
  const EXPECTED_QUERY = '(container_cpu_usage{k8s_namespace_name="dev"}) >= 0.5';

  it("decodes the base64 `query` param to the expected PromQL", () => {
    expect(b64DecodeUnicodeSafe(query.query)).toBe(EXPECTED_QUERY);
  });

  it("resolves the legacy `stream` alias, the custom query, and forces stream_type=metrics", () => {
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(query, dpd);
    const q0 = dpd.data.queries[0];
    expect(dpd.data.queries).toHaveLength(1);
    expect(q0.fields.stream).toBe("container_cpu_usage"); // from the `stream` alias
    expect(q0.fields.stream_type).toBe("metrics");
    expect(q0.query).toBe(EXPECTED_QUERY); // base64-decoded
    expect(q0.customQuery).toBe(true); // a query ⇒ custom, verbatim
  });

  it("ignores the non-contract params (stream_value, type, show_histogram, stream_type)", () => {
    const dpd = getDefaultDashboardPanelData(store);
    expect(() => applyDeepLinkOverrides(query, dpd)).not.toThrow();
    expect(dpd.data.queries).toHaveLength(1); // no extra queries from junk params
  });

  it("maps the microsecond from/to to an absolute time selection (preserved verbatim)", () => {
    const sel = queryParamsToSelectedDate(query);
    expect(sel.valueType).toBe("absolute");
    expect(sel.startTime).toBe("1781243646093750");
    expect(sel.endTime).toBe("1781244060000000");
  });

  it("triggers auto-run on load (an inbound override param is present)", () => {
    expect(hasAnyDeepLinkParam(query, METRICS_PARAMS)).toBe(true);
  });
});
