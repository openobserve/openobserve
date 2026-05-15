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

/**
 * Grouping pipeline benchmarks.
 *
 * Measures ONLY the time added by semantic grouping, not field loading.
 * Each size is tested twice: once with grouping disabled (baseline) and
 * once with grouping enabled, so the delta is the true grouping cost.
 *
 * Run with:
 *   npx vitest bench src/utils/fieldCategories.bench.ts --reporter=verbose
 */

import { describe, bench } from "vitest";
import type { FieldAlias } from "@/services/service_streams";
import {
  buildSemanticIndex,
  discoverPrefixes,
  resolveFieldGroup,
  getGroupLabel,
  groupSortOrder,
  CATEGORY,
  type SemanticIndex,
} from "@/utils/fieldCategories";

// ---------------------------------------------------------------------------
// Fixture generators
// ---------------------------------------------------------------------------

/** Realistic namespaces that appear in telemetry streams. */
const NAMESPACES = [
  "k8s", "http", "db", "body", "geo", "log", "aws", "gcp", "azure",
  "host", "process", "otel", "trace", "error", "service", "net",
  "container", "app", "grpc", "jvm",
];

const DATA_TYPES = ["Utf8", "Int64", "Float64", "Boolean"];

/** Generate n synthetic field schema objects. */
function makeFields(n: number): Array<{ name: string; type: string }> {
  const fields: Array<{ name: string; type: string }> = [];
  for (let i = 0; i < n; i++) {
    const ns = NAMESPACES[i % NAMESPACES.length];
    const type = DATA_TYPES[i % DATA_TYPES.length];
    fields.push({ name: `${ns}_field_${i}`, type });
  }
  return fields;
}

/** Minimal semantic aliases that mirror a real org config. */
function makeAliases(): FieldAlias[] {
  return NAMESPACES.map((ns, i) => ({
    id: `alias_${ns}`,
    display: ns.charAt(0).toUpperCase() + ns.slice(1),
    fields: [`${ns}_service`, `${ns}_name`, `${ns}_id`],
    group: ns,
  }));
}

// ---------------------------------------------------------------------------
// Baseline: flat field assembly with NO grouping
// ---------------------------------------------------------------------------

function flatAssembly(fields: Array<{ name: string; type: string }>): any[] {
  return fields.map((f) => ({
    name: f.name,
    ftsKey: false,
    isSchemaField: true,
    group: null,
    showValues: true,
    isInterestingField: false,
    dataType: f.type,
  }));
}

// ---------------------------------------------------------------------------
// shouldGroup mirrors the production gate in useStreamFields.ts:
//   group only when UDS is active OR field count ≤ UDS limit (or no limit set)
// ---------------------------------------------------------------------------

function shouldGroup(
  fieldCount: number,
  semanticIndex: SemanticIndex | null,
  udsActive: boolean,
  udsFieldLimit: number,
): boolean {
  if (!semanticIndex) return false;
  if (udsActive) return true;
  // When no UDS limit defined (0), always group; otherwise only when within limit
  return udsFieldLimit === 0 || fieldCount <= udsFieldLimit;
}

// ---------------------------------------------------------------------------
// Full grouping pipeline: discoverPrefixes → resolveFieldGroup → groupBuckets
// ---------------------------------------------------------------------------

function groupedAssembly(
  fields: Array<{ name: string; type: string }>,
  semanticIndex: SemanticIndex,
): any[] {
  // Step 1: discover dynamic prefix groups from the field set
  const dynamicPrefixes = discoverPrefixes(fields.map((f) => f.name));

  // Step 2: build flat field objects with resolved group keys
  const fieldObjs = fields.map((f) => ({
    name: f.name,
    ftsKey: false,
    isSchemaField: true,
    group: resolveFieldGroup(f.name, f.type, semanticIndex, dynamicPrefixes),
    showValues: true,
    isInterestingField: false,
    dataType: f.type,
  }));

  // Step 3: bucket by group key
  const groupBuckets = new Map<string, any[]>();
  for (const f of fieldObjs) {
    const g = f.group ?? CATEGORY.OTHER;
    if (!groupBuckets.has(g)) groupBuckets.set(g, []);
    groupBuckets.get(g)!.push(f);
  }

  // Step 4: sort groups
  const sortedGroups = Array.from(groupBuckets.keys()).sort(
    (a, b) => groupSortOrder(a, semanticIndex) - groupSortOrder(b, semanticIndex),
  );

  // Step 5: inject label rows
  const result: any[] = [];
  for (const groupKey of sortedGroups) {
    const gFields = groupBuckets.get(groupKey)!;
    result.push(
      {
        name: getGroupLabel(groupKey, semanticIndex),
        label: true,
        group: groupKey,
      },
      ...gFields,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pre-built shared fixtures (built once outside bench loops)
// ---------------------------------------------------------------------------

const aliases = makeAliases();
const semanticIndex = buildSemanticIndex(aliases);

const fields20k  = makeFields(20_000);
const fields30k  = makeFields(30_000);
const fields50k  = makeFields(50_000);
const fields100k = makeFields(100_000);

// ---------------------------------------------------------------------------
// Benchmarks — one describe block per field count, three scenarios each:
//   1. baseline          — no grouping at all
//   2. UDS active        — shouldGroup=true regardless of count (always groups)
//   3. no UDS, no limit  — shouldGroup=true (udsFieldLimit=0 means always group)
//   4. no UDS, limit=500 — shouldGroup=false when count > limit (skips grouping)
// ---------------------------------------------------------------------------

function runWithGate(
  fields: Array<{ name: string; type: string }>,
  udsActive: boolean,
  udsFieldLimit: number,
): any[] {
  if (!shouldGroup(fields.length, semanticIndex, udsActive, udsFieldLimit)) {
    return flatAssembly(fields);
  }
  return groupedAssembly(fields, semanticIndex);
}

describe("grouping pipeline — 20k fields", () => {
  bench("baseline (no grouping)", () => { flatAssembly(fields20k); });
  bench("UDS active (always groups)", () => { runWithGate(fields20k, true, 0); });
  bench("no UDS, no limit (always groups)", () => { runWithGate(fields20k, false, 0); });
  bench("no UDS, limit=500 (skips grouping)", () => { runWithGate(fields20k, false, 500); });
});

describe("grouping pipeline — 30k fields", () => {
  bench("baseline (no grouping)", () => { flatAssembly(fields30k); });
  bench("UDS active (always groups)", () => { runWithGate(fields30k, true, 0); });
  bench("no UDS, no limit (always groups)", () => { runWithGate(fields30k, false, 0); });
  bench("no UDS, limit=500 (skips grouping)", () => { runWithGate(fields30k, false, 500); });
});

describe("grouping pipeline — 50k fields", () => {
  bench("baseline (no grouping)", () => { flatAssembly(fields50k); });
  bench("UDS active (always groups)", () => { runWithGate(fields50k, true, 0); });
  bench("no UDS, no limit (always groups)", () => { runWithGate(fields50k, false, 0); });
  bench("no UDS, limit=500 (skips grouping)", () => { runWithGate(fields50k, false, 500); });
});

describe("grouping pipeline — 100k fields", () => {
  bench("baseline (no grouping)", () => { flatAssembly(fields100k); });
  bench("UDS active (always groups)", () => { runWithGate(fields100k, true, 0); });
  bench("no UDS, no limit (always groups)", () => { runWithGate(fields100k, false, 0); });
  bench("no UDS, limit=500 (skips grouping)", () => { runWithGate(fields100k, false, 500); });
});

// ---------------------------------------------------------------------------
// Individual stage breakdown (50k) — isolates where time is spent
// ---------------------------------------------------------------------------

describe("stage breakdown — 50k fields", () => {
  const names50k = fields50k.map((f) => f.name);

  bench("stage 1: discoverPrefixes only", () => {
    discoverPrefixes(names50k);
  });

  bench("stage 2: resolveFieldGroup only (50k calls)", () => {
    const dp = discoverPrefixes(names50k);
    for (const f of fields50k) {
      resolveFieldGroup(f.name, f.type, semanticIndex, dp);
    }
  });

  bench("stage 3: groupBuckets + sort + label injection only", () => {
    const dp = discoverPrefixes(names50k);
    const fieldObjs = fields50k.map((f) => ({
      name: f.name,
      group: resolveFieldGroup(f.name, f.type, semanticIndex, dp),
    }));
    const buckets = new Map<string, any[]>();
    for (const f of fieldObjs) {
      if (!buckets.has(f.group)) buckets.set(f.group, []);
      buckets.get(f.group)!.push(f);
    }
    Array.from(buckets.keys())
      .sort((a, b) => groupSortOrder(a, semanticIndex) - groupSortOrder(b, semanticIndex))
      .forEach((key) => {
        buckets.get(key)!; // simulate iteration
      });
  });
});
