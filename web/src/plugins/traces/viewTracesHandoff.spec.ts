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
import { buildViewTracesFilter, normalizeViewTracesPayload } from "./viewTracesHandoff";

/**
 * These cases were previously asserted against Index.vue's in-page
 * `handleServiceGraphViewTraces` / `handleServicesCatalogViewTraces`. The filter
 * building is shared by the embedded Service Graph and Services Catalog tabs.
 */
describe("buildViewTracesFilter", () => {
  it("builds a service_name filter for a plain service", () => {
    expect(buildViewTracesFilter({ serviceName: "svc" })).toBe("service_name = 'svc'");
  });

  it("uses infer_service_name when a serviceType is present", () => {
    expect(buildViewTracesFilter({ serviceName: "db", serviceType: "database" })).toBe(
      "infer_service_name = 'db'",
    );
  });

  it("escapes single quotes in the service name", () => {
    // escapeSingleQuotes uses SQL-style escaping: ' → ''
    expect(buildViewTracesFilter({ serviceName: "it's" })).toBe("service_name = 'it''s'");
  });

  it("includes operationName when provided", () => {
    const q = buildViewTracesFilter({ serviceName: "svc", operationName: "POST /ingest" });
    expect(q).toContain("AND operation_name = 'POST /ingest'");
  });

  it("includes nodeName when provided", () => {
    const q = buildViewTracesFilter({ serviceName: "svc", nodeName: "node-2" });
    expect(q).toContain("AND service_k8s_node_name = 'node-2'");
  });

  it("includes podName when provided", () => {
    const q = buildViewTracesFilter({ serviceName: "svc", podName: "pod-xyz" });
    expect(q).toContain("AND service_k8s_pod_name = 'pod-xyz'");
  });

  it("appends span_status = 'ERROR' when errorsOnly is true", () => {
    const q = buildViewTracesFilter({ serviceName: "svc", errorsOnly: true });
    expect(q).toContain("AND span_status = 'ERROR'");
  });

  it("includes duration bounds only when greater than zero", () => {
    const withBounds = buildViewTracesFilter({
      serviceName: "svc",
      minDurationMicros: 1000,
      maxDurationMicros: 9000,
    });
    expect(withBounds).toContain("AND duration >= 1000");
    expect(withBounds).toContain("AND duration <= 9000");

    const zeroed = buildViewTracesFilter({
      serviceName: "svc",
      minDurationMicros: 0,
      maxDurationMicros: 0,
    });
    expect(zeroed).not.toContain("duration >=");
    expect(zeroed).not.toContain("duration <=");
  });

  it("combines all optional filter fields when all are provided", () => {
    const q = buildViewTracesFilter({
      serviceName: "svc",
      operationName: "POST /ingest",
      nodeName: "node-2",
      podName: "pod-xyz",
      errorsOnly: true,
      minDurationMicros: 1000,
      maxDurationMicros: 9000,
    });
    expect(q).toContain("service_name = 'svc'");
    expect(q).toContain("AND operation_name = 'POST /ingest'");
    expect(q).toContain("AND service_k8s_node_name = 'node-2'");
    expect(q).toContain("AND service_k8s_pod_name = 'pod-xyz'");
    expect(q).toContain("AND span_status = 'ERROR'");
    expect(q).toContain("AND duration >= 1000");
    expect(q).toContain("AND duration <= 9000");
  });

  it("omits optional fields when they are not provided", () => {
    const q = buildViewTracesFilter({ serviceName: "svc" });
    expect(q).toBe("service_name = 'svc'");
  });

  it("appends a single-field resourceFilter", () => {
    const q = buildViewTracesFilter({
      serviceName: "svc",
      resourceFilter: { field: "service_k8s_namespace_name", value: "prod" },
    });
    expect(q).toContain("AND service_k8s_namespace_name = 'prod'");
  });

  it("appends a multi-field resourceFilter as an OR fallback chain", () => {
    const q = buildViewTracesFilter({
      serviceName: "svc",
      resourceFilter: { fields: ["a", "b"], value: "v" },
    });
    expect(q).toContain("AND (a = 'v' OR b = 'v')");
  });

  it("escapes single quotes in the resourceFilter value", () => {
    const q = buildViewTracesFilter({
      serviceName: "svc",
      resourceFilter: { field: "f", value: "it's" },
    });
    expect(q).toContain("AND f = 'it''s'");
  });

  it("returns an empty filter when no service is named", () => {
    expect(buildViewTracesFilter({})).toBe("");
    expect(buildViewTracesFilter({ errorsOnly: true })).toBe("");
  });
});

describe("normalizeViewTracesPayload", () => {
  it("wraps a bare service-name string (catalog legacy path)", () => {
    expect(normalizeViewTracesPayload("svc")).toEqual({ serviceName: "svc", mode: "traces" });
  });

  it("passes an object payload through untouched", () => {
    const payload = { serviceName: "svc", mode: "spans" };
    expect(normalizeViewTracesPayload(payload)).toBe(payload);
  });
});
