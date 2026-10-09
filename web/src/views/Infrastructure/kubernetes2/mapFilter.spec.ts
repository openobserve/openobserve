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
import { raw } from "@/types/i18n";
import { labelledInventory, observed } from "./__fixtures__/mapInventory";
import type { PodRow } from "./kubernetesModel";
import {
  applyFilter,
  filterOptions,
  groupLabelOptions,
  isNoiseKey,
  labelIndex,
  splitTerm,
} from "./mapFilter";
import type { MapRow } from "./mapFill";

// Catches a quadratic blow-up (seconds), not machine speed: CI runs this slower, under coverage.
const OPTIONS_BUDGET_MS = 250;

const row = (name: string, labels: Record<string, string> | null): MapRow =>
  ({
    key: `c/ns/${name}`,
    kind: "pod",
    cluster: "c",
    namespace: "ns",
    name,
    warnings: [],
    object: labels ? observed(labels) : null,
  }) as unknown as PodRow;

const ROWS = [
  row("a", { app: "a", tier: "db" }),
  row("b", { app: "b", tier: "web" }),
  row("c", { app: "c", tier: "db" }),
  row("d", null),
  row("e", { tier: "db" }),
];

const names = (rows: MapRow[]) => rows.map((r) => r.name);

const HEADER = raw("Labels");

describe("mapFilter matching (AC 77)", () => {
  it("ORs terms on the same key", () => {
    expect(names(applyFilter(ROWS, ["app:a", "app:b"]))).toEqual(["a", "b"]);
  });

  it("ANDs terms on different keys", () => {
    expect(names(applyFilter(ROWS, ["app:a", "app:b", "tier:db"]))).toEqual(["a"]);
  });

  it("never matches a row whose labels were not observed or lack the key", () => {
    expect(names(applyFilter(ROWS, ["tier:db"]))).toEqual(["a", "c", "e"]);
    expect(names(applyFilter(ROWS, ["app:a", "app:b", "app:c"]))).not.toContain("e");
    expect(names(applyFilter([row("x", null)], ["app:x"]))).toEqual([]);
  });

  it("returns the input unchanged for an empty filter", () => {
    expect(applyFilter(ROWS, [])).toBe(ROWS);
  });

  it("splits a term on its first colon", () => {
    expect(splitTerm("kubernetes.io/hostname:ip-10-0-11-39.ec2.internal")).toEqual([
      "kubernetes.io/hostname",
      "ip-10-0-11-39.ec2.internal",
    ]);
  });
});

describe("mapFilter options (AC 78)", () => {
  const pods = () => labelledInventory().pods;
  const values = (options: any[]) => options.filter((o) => o.parentValue != null);
  const keysOf = (options: any[]) =>
    options.filter((o) => o.expandable).map((o) => String(o.label));

  it("offers label keys only, never a built-in field", () => {
    const keys = keysOf(filterOptions(labelIndex(pods()), HEADER));
    expect(keys.length).toBeGreaterThan(0);
    for (const builtin of ["workload", "status", "qos", "condition", "node", "role"])
      expect(keys).not.toContain(builtin);
    expect(keys[0]).toBe("app.kubernetes.io/name");
  });

  it("drops keys without values and empty-string values, from the filter and Group by", () => {
    const rows = [row("a", { tier: "", app: "x" }), row("b", { blank: "" })];
    const index = labelIndex(rows);
    expect(index.keys.map((k) => k.key)).toEqual(["app"]);
    expect(keysOf(filterOptions(index, HEADER))).toEqual(["app"]);
    expect(groupLabelOptions(index).map((o) => o.value)).toEqual(["label.app"]);
  });

  it("offers per-row-unique keys, and excludes exactly the noise denylist from both pickers", () => {
    const index = labelIndex(pods());
    const filterKeys = keysOf(filterOptions(index, HEADER));
    const groupKeys = groupLabelOptions(index).map((o) => String(o.value).slice("label.".length));
    expect(filterKeys).toContain("statefulset.kubernetes.io/pod-name");
    expect(groupKeys).toEqual(filterKeys);
    const noise = [
      "pod-template-hash",
      "controller-revision-hash",
      "pod-template-generation",
      "batch.kubernetes.io/controller-uid",
      "job-name",
      "batch.kubernetes.io/job-name",
    ];
    const seen = new Set(
      pods().flatMap((p) => Object.keys((p.object?.metadata as any)?.labels ?? {})),
    );
    for (const key of noise) {
      expect(seen.has(key)).toBe(true);
      expect(isNoiseKey(key)).toBe(true);
      expect(filterKeys).not.toContain(key);
      expect(groupKeys).not.toContain(key);
    }
    expect(isNoiseKey("example.com/job-name-prefix")).toBe(false);
  });

  it("labels each value <key>: <value> · <count>, the count being the rows carrying it", () => {
    const opts = values(filterOptions(labelIndex(pods()), HEADER));
    const gateway = opts.find((o) => o.value === "app.kubernetes.io/name:api-gateway");
    expect(String(gateway.label)).toBe("app.kubernetes.io/name: api-gateway · 2");
    for (const o of opts) {
      const [key, value] = splitTerm(String(o.value));
      const count = pods().filter((p) => (p.object?.metadata as any)?.labels?.[key] === value);
      expect(String(o.label)).toBe(`${key}: ${value} · ${count.length}`);
      expect(String(o.label).toLowerCase()).toContain(key.toLowerCase());
    }
  });

  it("finds a key's values when the search names the key", () => {
    const opts = values(filterOptions(labelIndex(pods()), HEADER));
    const hits = opts.filter((o) => String(o.label).toLowerCase().includes("app.kubernetes"));
    expect(hits.length).toBe(
      opts.filter((o) => String(o.value).startsWith("app.kubernetes.io/name:")).length,
    );
  });

  it("keeps the same value under two keys apart", () => {
    const opts = values(filterOptions(labelIndex([row("a", { a: "x", b: "x" })]), HEADER));
    expect(opts.map((o) => [o.value, String(o.label)])).toEqual([
      ["a:x", "a: x · 1"],
      ["b:x", "b: x · 1"],
    ]);
  });

  it("orders keys by coverage then name, and values by count then name", () => {
    const rows = [
      row("1", { z: "q", y: "b" }),
      row("2", { z: "p", y: "a" }),
      row("3", { z: "p", x: "c" }),
      row("4", { z: "r" }),
    ];
    const opts = filterOptions(labelIndex(rows), HEADER);
    expect(keysOf(opts)).toEqual(["z", "y", "x"]);
    expect(values(opts).map((o) => o.value)).toEqual(["z:p", "z:q", "z:r", "y:a", "y:b", "x:c"]);
    expect(opts[0]).toMatchObject({ header: true, label: HEADER });
    expect(opts.find((o) => o.value === "z:q")!.parentValue).toBe(
      opts.find((o) => o.expandable && String(o.label) === "z")!.value,
    );
  });

  it("counts coverage over the rows given, observed or not", () => {
    const index = labelIndex(pods());
    expect([index.observed, index.total]).toEqual([39, 41]);
  });
});

describe("mapFilter scale (AC 99)", () => {
  it("builds the filter and Group by options for 5,000 pods × 6 labels without a blow-up", () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row(`p${i}`, {
        build: `b${i % 2000}`,
        app: `app-${i % 300}`,
        tier: ["web", "db", "cache"][i % 3],
        zone: `z${i % 3}`,
        team: `t${i % 12}`,
        env: i % 2 ? "prod" : "staging",
      }),
    );
    labelIndex(rows.slice(0, 50));
    const start = performance.now();
    const index = labelIndex(rows);
    filterOptions(index, HEADER);
    groupLabelOptions(index);
    expect(performance.now() - start).toBeLessThanOrEqual(OPTIONS_BUDGET_MS);
    expect(index.keys.find((k) => k.key === "build")!.values).toHaveLength(2000);
  });
});
