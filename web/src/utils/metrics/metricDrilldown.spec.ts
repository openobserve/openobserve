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
import {
  availability,
  buildLogsRoute,
  buildTracesRoute,
  contextToDimensions,
  droppedLabelNames,
  serviceLabelFor,
} from "./metricDrilldown";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { stringifyQuery } from "vue-router";

const GROUPS: any[] = [
  { id: "service", display: "Service", fields: ["service_name", "service", "job", "__name__"] },
  { id: "k8s-namespace", display: "Namespace", fields: ["k8s_namespace_name", "namespace"] },
  { id: "k8s-pod", display: "Pod", fields: ["k8s_pod_name", "pod"] },
  { id: "le-group", display: "Bucket", fields: ["le", "quantile"] },
];
const IDENTITY = {
  sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-namespace"] }],
  tracked_alias_ids: [],
};
const filter = (label: string, value: string, operator?: string) => ({ label, value, operator });

describe("contextToDimensions", () => {
  it("keeps equality filters the metric applies, mapped to groups, with the user's label names", () => {
    const out = contextToDimensions(
      [
        filter("service_name", "checkout"),
        filter("namespace", "shop", "="),
        filter("pod", "web-1"),
        filter("k8s_namespace_name", "staging"),
      ],
      [filter("k8s_namespace_name", "staging")],
      GROUPS,
      IDENTITY,
    );
    expect(out.dimensions).toEqual({ service: "checkout", "k8s-namespace": "shop" });
    expect(out.labelByGroupId).toEqual({ service: "service_name", "k8s-namespace": "namespace" });
  });

  it("drops matchers other than equality", () => {
    const out = contextToDimensions(
      [filter("service_name", "check.*", "=~"), filter("namespace", "shop", "!=")],
      [],
      GROUPS,
      IDENTITY,
    );
    expect(out.dimensions).toEqual({});
  });

  it("never sends __name__, le or quantile", () => {
    const groups: any[] = [
      { id: "service", display: "Service", fields: ["__name__", "le", "quantile"] },
    ];
    const out = contextToDimensions(
      [filter("__name__", "up"), filter("le", "0.5"), filter("quantile", "0.99")],
      [],
      groups,
      { sets: [], tracked_alias_ids: [] },
    );
    expect(out.dimensions).toEqual({});
  });

  it("leaves service out when the org's identity config makes it optional", () => {
    const out = contextToDimensions(
      [filter("service_name", "checkout"), filter("namespace", "shop")],
      [],
      GROUPS,
      { ...IDENTITY, service_optional: true },
    );
    expect(out.dimensions).toEqual({ "k8s-namespace": "shop" });
  });

  it("sends no service with service_optional set even when no identity fields are configured", () => {
    const out = contextToDimensions([filter("service_name", "checkout")], [], GROUPS, {
      sets: [],
      tracked_alias_ids: [],
      service_optional: true,
    });
    expect(out.dimensions).toEqual({});
  });
});

describe("serviceLabelFor", () => {
  it("is the first label of the service group the metric has, never __name__", () => {
    expect(serviceLabelFor(["instance", "job", "service_name"], GROUPS)).toBe("service_name");
    expect(serviceLabelFor(["instance", "job"], GROUPS)).toBe("job");
    expect(serviceLabelFor(["instance", "__name__"], GROUPS)).toBeNull();
    expect(serviceLabelFor(["job"], [])).toBeNull();
  });
});

describe("availability", () => {
  const base = {
    isEnterprise: "true",
    serviceStreamsEnabled: true,
    identityStatus: "ok" as const,
    groupsStatus: "ok" as const,
  };

  it("is locked on an OSS build, whatever else is true", () => {
    expect(availability({ ...base, isEnterprise: "false" })).toBe("oss");
    expect(availability({ ...base, isEnterprise: undefined })).toBe("oss");
  });

  it("is off when service discovery is off", () => {
    expect(availability({ ...base, serviceStreamsEnabled: false })).toBe("discoveryOff");
  });

  it("is forbidden when either read is refused", () => {
    expect(availability({ ...base, identityStatus: 403 })).toBe("forbidden");
    expect(availability({ ...base, groupsStatus: 403 })).toBe("forbidden");
  });

  it("is pending until both reads have answered", () => {
    expect(availability({ ...base, identityStatus: "pending" })).toBe("pending");
    expect(availability({ ...base, groupsStatus: "pending" })).toBe("pending");
    expect(availability({ ...base, identityStatus: "pending", groupsStatus: 403 })).toBe(
      "forbidden",
    );
  });

  it("is available otherwise, including when a read failed for another reason", () => {
    expect(availability(base)).toBe("available");
    expect(availability({ ...base, groupsStatus: 500 })).toBe("available");
  });
});

describe("droppedLabelNames", () => {
  it("names dropped groups by the user's labels, or by the group id when there is none", () => {
    expect(
      droppedLabelNames(["k8s-namespace", "cloud-region"], { "k8s-namespace": "namespace" }),
    ).toEqual(["namespace", "cloud-region"]);
  });
});

describe("routes", () => {
  const args = {
    stream: "checkout_logs",
    filters: { service_name: "checkout", "k8s ns": "it's" },
    timeRange: { start_time: 1_000_000, end_time: 2_000_000 },
    org: "acme",
  };
  const where = `"service_name" = 'checkout' AND "k8s ns" = 'it''s'`;

  it("opens logs in non-SQL mode, quick mode off, with the stream's identity filters", () => {
    const route = buildLogsRoute(args);
    expect(route.path).toBe("/logs");
    expect({ ...route.query, query: undefined }).toEqual({
      stream_type: "logs",
      stream: "checkout_logs",
      from: "1000000",
      to: "2000000",
      sql_mode: "false",
      query: undefined,
      quick_mode: "false",
      show_histogram: "true",
      defined_schemas: "user_defined_schema",
      org_identifier: "acme",
    });
    expect(b64DecodeUnicode(route.query.query)).toBe(where);
  });

  it("opens traces on the search tab with the same filters", () => {
    const route = buildTracesRoute({ ...args, stream: "default" });
    expect(route.name).toBe("traces");
    expect({ ...route.query, query: undefined }).toEqual({
      stream: "default",
      from: "1000000",
      to: "2000000",
      query: undefined,
      tab: "traces",
      org_identifier: "acme",
    });
    expect(b64DecodeUnicode(route.query.query)).toBe(where);
  });

  it("orders traces query keys as the traces page does, so Back finds the same location", () => {
    const route = buildTracesRoute({ ...args, stream: "default" });
    // Insertion order of useTraces getUrlQueryParams() for an absolute range; trace_id is undefined there.
    const pushedByTraces = {
      stream: "default",
      from: 1000000,
      to: 2000000,
      query: route.query.query,
      org_identifier: "acme",
      trace_id: undefined,
      tab: "traces",
    };
    expect(stringifyQuery(route.query)).toBe(stringifyQuery(pushedByTraces as any));
  });

  it("skips a wildcard filter", () => {
    const route = buildLogsRoute({
      ...args,
      filters: { service_name: "checkout", pod: "_o2_all_" },
    });
    expect(b64DecodeUnicode(route.query.query)).toBe(`"service_name" = 'checkout'`);
  });
});
