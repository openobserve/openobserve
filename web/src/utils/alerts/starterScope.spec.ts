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

import type { StarterScope } from "@/components/create-starter/createStarter.types";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { applyScope, buildScopeOptions, entryInScope, scopePrefill } from "./starterScope";

const prefill = (over: Partial<AlertPrefill>): AlertPrefill => ({
  version: 1,
  source: "library",
  sourceLabel: "x",
  streamType: "logs",
  streamName: "app",
  queryType: "sql",
  warnings: [],
  ...over,
});

const svc = (dimensions: Record<string, string>): StarterScope => ({
  kind: "service",
  service: "checkout",
  dimensions,
});

const ONE = svc({ svc_field: "checkout" });

describe("scopePrefill", () => {
  it.each([
    {
      name: "SQL without a WHERE gains one before GROUP BY",
      input: prefill({ sql: "SELECT count(*) AS n FROM app GROUP BY host" }),
      check: (p: AlertPrefill) =>
        expect(p.sql).toMatch(/WHERE "svc_field" = 'checkout' GROUP BY host$/),
    },
    {
      name: "SQL with a WHERE keeps it and ANDs the scope",
      input: prefill({ sql: "SELECT * FROM app WHERE level = 'error'" }),
      check: (p: AlertPrefill) =>
        expect(p.sql).toMatch(/WHERE \(level = 'error'\) AND "svc_field" = 'checkout'$/),
    },
    {
      name: "every PromQL selector gains the matcher; label lists stay",
      input: prefill({
        queryType: "promql",
        promql: 'sum by (pod) (rate(a_total{ns="x"}[5m])) / sum by (pod) (b_total) > 3',
      }),
      check: (p: AlertPrefill) => {
        expect(p.promql).toContain('a_total{ns="x", svc_field="checkout"}[5m]');
        expect(p.promql).toContain('b_total{svc_field="checkout"}');
        expect(p.promql).toContain("by (pod)");
      },
    },
    {
      name: "filter conditions gain an AND condition",
      input: prefill({
        queryType: "custom",
        conditions: { filterType: "group", logicalOperator: "AND", groupId: "g", conditions: [] },
      }),
      check: (p: AlertPrefill) =>
        expect(p.conditions?.conditions).toEqual([
          expect.objectContaining({ column: "svc_field", operator: "=", value: "checkout" }),
        ]),
    },
  ])("$name", ({ input, check }) => {
    const out = scopePrefill(input, ONE);
    expect(out.reason).toBeNull();
    check(out.prefill);
  });

  it.each([
    {
      name: "every service",
      scope: { kind: "all" } as StarterScope,
      input: prefill({ sql: "SELECT * FROM app" }),
      reason: null,
    },
    {
      name: "the stream it already reads",
      scope: { kind: "stream", streamType: "logs", streamName: "app" } as StarterScope,
      input: prefill({ sql: "SELECT * FROM app" }),
      reason: null,
    },
    {
      name: "another stream",
      scope: { kind: "stream", streamType: "logs", streamName: "other" } as StarterScope,
      input: prefill({ sql: "SELECT * FROM app" }),
      reason: "streamDiffers",
    },
    {
      name: "SQL with a join",
      scope: ONE,
      input: prefill({ sql: "SELECT * FROM app JOIN b ON a.x = b.x" }),
      reason: "queryShape",
    },
    {
      name: "a schema without the field",
      scope: ONE,
      input: prefill({ sql: "SELECT * FROM app" }),
      reason: "noField",
      fields: new Set(["other"]),
    },
  ])("leaves the prefill as is for $name", ({ scope, input, reason, fields }) => {
    const out = scopePrefill(input, scope, { fields });
    expect(out.prefill).toEqual(input);
    expect(out.reason).toBe(reason);
  });

  it("swaps a field the stream lacks for its alias the stream has", () => {
    const out = scopePrefill(prefill({ sql: "SELECT * FROM app" }), ONE, {
      fields: new Set(["svc_alias"]),
      groups: [{ id: "svc", display: "Service", fields: ["svc_field", "svc_alias"] }],
    });
    expect(out.prefill.sql).toContain(`"svc_alias" = 'checkout'`);
    expect(applyScope(prefill({ sql: "SELECT * FROM app" }), ONE).sql).toContain("svc_field");
  });
});

describe("buildScopeOptions", () => {
  const rows = [
    {
      service_name: "checkout",
      disambiguation: { ns: "shop" },
      all_dimensions: { service: "checkout", ns: "shop" },
      field_name_mapping: { service: "svc_field", ns: "ns_field" },
      logs_streams: ["app"],
      metrics_streams: ["cpu"],
    },
    {
      service_name: "cart",
      disambiguation: { ns: "shop" },
      all_dimensions: { service: "cart", ns: "shop" },
      logs_streams: ["cart_logs"],
    },
    { service_name: "app", named_after_stream: true, logs_streams: ["app"] },
  ];
  const groups = [
    { id: "service", display: "Service", fields: ["svc_field"] },
    { id: "ns", display: "Namespace", fields: ["ns_field"] },
  ];
  const identity = {
    sets: [{ id: "k8s", label: "K8s", distinguish_by: ["ns"] }],
    tracked_alias_ids: [],
  };

  it("lists services, then each identity dimension's values, with field names from config", () => {
    const { services, dimensions } = buildScopeOptions(rows, identity, groups);
    expect(services.map((o) => o.label)).toEqual(["cart", "checkout"]);
    expect(services[1].scope).toEqual(svc({ svc_field: "checkout", ns_field: "shop" }));
    expect(dimensions).toEqual([
      expect.objectContaining({
        id: "ns",
        label: "Namespace",
        options: [expect.objectContaining({ label: "shop" })],
      }),
    ]);
    const shop = dimensions[0].options[0];
    const entry = (stream: string, stream_type = "logs") => ({
      stream,
      stream_type,
      required_streams: [stream],
    });
    expect(entryInScope(entry("cart_logs"), shop.scope, shop)).toBe(true);
    expect(entryInScope(entry("cpu", "logs"), shop.scope, shop)).toBe(false);
    expect(entryInScope(entry("cpu", "metrics"), shop.scope, shop)).toBe(true);
  });
});
