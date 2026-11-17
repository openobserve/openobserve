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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/locales";
import config from "@/aws-exports";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverageRow, AutoObserveSuggestion } from "@/services/autoobserve";
import { toRequests, toSuggestionRows } from "../live/liveAdapter";
import { serviceKeyOf, useRecentlyCreated } from "./bulk/useRecentlyCreated";

const NOW_MS = Date.UTC(2026, 10, 11, 7, 0);
const zone = { locale: "en-US", timeZone: "UTC" };
const ORG = "demo-org";
const recently = useRecentlyCreated();

const NONE_CELLS = {
  errors: { state: "none", evidence: [], counts: {} },
  latency: { state: "none", evidence: [], counts: {} },
  absence: { state: "none", evidence: [], counts: {} },
};

const gap = (i: number, org = ORG): AutoObserveSuggestion => ({
  id: `gap-${i}`,
  org,
  analyzer: "coverage",
  kind: "coverage_gap",
  subject: { kind: "service", key_dims: { entity_id: `svc-${i}`, service_name: `svc-${i}` } },
  evidence: { service_name: `svc-${i}`, cells: NONE_CELLS, traffic_per_hour: 10 },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const gapRow = (i: number): AutoObserveCoverageRow => ({
  service_id: `svc-${i}`,
  service_name: `svc-${i}`,
  cluster: null,
  namespace: null,
  streams: [{ type: "logs", name: `logs_${i}` }],
  traffic_per_hour: 10,
  cells: NONE_CELLS as AutoObserveCoverageRow["cells"],
});

const addedFor = (i: number, kinds: ("errors" | "no_data")[], org = ORG) =>
  kinds.forEach((k) => recently.add(serviceKeyOf(org, `svc-${i}`, null, null), k));

const rail = (count: number, org = ORG) => {
  const gaps = Array.from({ length: count }, (_, i) => gap(i, org));
  const rows = gaps.map((_, i) => gapRow(i));
  return toRequests(gt, zone, gaps, NOW_MS, { rows, allGaps: { suggestions: gaps, total: count } });
};

const bulkRows = (
  cta: { target: { type: string; request?: { rows: { key: string }[] } } } | null,
) => (cta?.target.type === "bulk" ? cta.target.request!.rows.map((r) => r.key) : []);

let enterprise: string;

beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = enterprise;
  recently.clearOnPass(ORG, Number.MAX_SAFE_INTEGER);
  recently.clearOnPass("other-org", Number.MAX_SAFE_INTEGER);
});

describe("the home Coverage gap card knows what was just added", () => {
  it("offers the same list again right after Add without this (the duplicate bug)", () => {
    const before = rail(20)[0].insight;
    expect(bulkRows(before.cta)).toHaveLength(40);
  });

  it("drops a service whose alerts were just added from the count, the names and the list", () => {
    addedFor(0, ["errors", "no_data"]);
    const parts = rail(20)[0].insight;
    expect(parts.headline).toBe("Nothing watches 19 services");
    expect(parts.why).not.toContain("svc-0,");
    expect(bulkRows(parts.cta)).toHaveLength(38);
    expect(bulkRows(parts.cta).some((k) => k.startsWith("svc-0:"))).toBe(false);
    expect(parts.note).toBe(
      "Opens a list of 38 alerts AutoObserve filled in. Nothing is saved until you click Add alerts.",
    );
  });

  it("still offers the draft the user left out, and counts the service as watched", () => {
    addedFor(0, ["no_data"]);
    const parts = rail(20)[0].insight;
    expect(parts.headline).toBe("Nothing watches 19 services");
    expect(bulkRows(parts.cta)).toContain("svc-0:errors");
    expect(bulkRows(parts.cta)).not.toContain("svc-0:no_data");
  });

  it("shows the added state, with no Review button, once the whole group was added", () => {
    for (let i = 0; i < 20; i++) addedFor(i, ["errors", "no_data"]);
    const parts = rail(20)[0].insight;
    expect(parts.cta).toBeNull();
    expect(parts.chip.label).toBe("Added");
    expect(parts.chip.variant).toBe("default-soft");
    expect(parts.headline).toBe("Added alerts for 20 services");
    expect(parts.why).toBe("svc-0, svc-1, svc-2, and 17 more.");
    expect(parts.note).toBe(
      "Added. AutoObserve counts them at its next check, within about 5 minutes.",
    );
  });

  it("keys the memory by org, so another org's add changes nothing here", () => {
    for (let i = 0; i < 20; i++) addedFor(i, ["errors", "no_data"], "other-org");
    const parts = rail(20)[0].insight;
    expect(parts.headline).toBe("Nothing watches 20 services");
    expect(bulkRows(parts.cta)).toHaveLength(40);
  });

  it("offers everything again once the memory expires", () => {
    const key = serviceKeyOf(ORG, "svc-0", null, null);
    recently.add(key, "errors", NOW_MS - 31 * 60_000);
    recently.add(key, "no_data", NOW_MS - 31 * 60_000);
    expect(bulkRows(rail(20)[0].insight.cta)).toHaveLength(40);
  });
});

describe("one gap card on the rail and in All suggestions", () => {
  it("replaces Add with the added line once every draft of the service was added", () => {
    addedFor(0, ["errors", "no_data"]);
    const [first] = rail(2);
    expect(first.insight.cta).toBeNull();
    expect(first.insight.chip.label).toBe("Added");
    expect(first.insight.note).toBe(
      "Added. AutoObserve counts them at its next check, within about 5 minutes.",
    );
    const rows = toSuggestionRows(gt, zone, [gap(0)], NOW_MS, { rows: [gapRow(0)] });
    expect(rows[0].insight.cta).toBeNull();
    expect(rows[0].note).toBe(
      "Added. AutoObserve counts them at its next check, within about 5 minutes.",
    );
  });

  it("keeps offering the draft that was not added", () => {
    addedFor(0, ["errors"]);
    const [first] = rail(2);
    expect(first.insight.cta?.target.type).toBe("create_alert");
    expect(first.insight.chip.label).toBe("Coverage gap");
  });
});
