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
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverage, AutoObserveSuggestion } from "@/services/autoobserve";
import { toCoverageSource, toRequests, toSuggestionRows } from "./liveAdapter";
import { detectorsOf } from "../fixtures";
import { KIND_LOOK } from "../v2/changes";

const DAY_US = 86_400_000_000;
// The snapshot that first missed coverage: 2026-10-30T02:30Z.
const LOST_AT_US = Date.UTC(2026, 9, 30, 2, 30) * 1000;
const SINCE_DAY_US = LOST_AT_US - (LOST_AT_US % DAY_US);

const EAST = { locale: "en-US", timeZone: "Asia/Kolkata" };
const WEST = { locale: "en-US", timeZone: "America/Los_Angeles" };

// The flattened SuggestionItem the suggestions route returns.
const suggestion = (over: Partial<AutoObserveSuggestion>): AutoObserveSuggestion => ({
  id: "s1",
  org: "acme",
  analyzer: "coverage",
  kind: "coverage_gap",
  subject: {
    kind: "service",
    key_dims: {
      service_name: "payments",
      k8s_cluster_name: "prod-eu",
      k8s_namespace_name: "billing",
    },
  },
  evidence: { service_name: "payments", severity: "high", traffic_per_hour: 4100, cells: {} },
  score: 4100,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  ...over,
});

const lost = (evidence: Record<string, unknown>) =>
  suggestion({
    kind: "coverage_lost",
    evidence: { service_name: "payments", severity: "high", lost: { errors: {} }, ...evidence },
  });

const headline = (s: AutoObserveSuggestion, zone = EAST) =>
  toRequests(gt, zone, [s])[0].copy?.headline;

describe("coverage_lost headline (OSS-7)", () => {
  it("dates the loss from lost_at in the viewer's timezone", () => {
    const s = lost({ lost_at: LOST_AT_US, since_day: SINCE_DAY_US });
    expect(headline(s, EAST)).toBe("payments lost its errors alert on Oct 30, 2026");
    expect(headline(s, WEST)).toBe("payments lost its errors alert on Oct 29, 2026");
  });

  it("falls back to since_day, a UTC day start, only when lost_at is absent", () => {
    const s = lost({ since_day: SINCE_DAY_US });
    expect(headline(s, WEST)).toBe("payments lost its errors alert on Oct 30, 2026");
    expect(headline(s, EAST)).toBe("payments lost its errors alert on Oct 30, 2026");
  });

  it("never ends the sentence on a bare 'on'", () => {
    expect(headline(lost({ lost_at: LOST_AT_US }))).not.toMatch(/on\s*$/);
  });
});

describe("severity tags (OSS-19)", () => {
  const tags = (severity: string) =>
    toRequests(gt, EAST, [suggestion({ evidence: { severity, cells: {} } })])[0].copy?.tags;

  it("shows High in amber and Medium in grey", () => {
    expect(tags("high")?.[0]).toEqual({ label: "High", variant: "warning-soft" });
    expect(tags("medium")?.[0]).toEqual({ label: "Medium", variant: "default-soft" });
  });

  it("never paints a coverage finding red", () => {
    for (const severity of ["high", "medium"])
      expect(tags(severity)?.map((tag) => tag.variant)).not.toContain("error-soft");
  });
});

describe("toSuggestionRows (the all-suggestions drawer)", () => {
  it("keeps the server's order and gives each row its place, kind and severity", () => {
    const rows = toSuggestionRows(gt, EAST, [
      suggestion({ id: "a" }),
      suggestion({
        id: "b",
        kind: "silent_coverage",
        subject: { kind: "alert", key_dims: { entity_id: "x" } },
        evidence: { monitor_name: "API error rate", classes: ["errors"], service_count: 3 },
      }),
      suggestion({ id: "a" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({
      where: "prod-eu / billing",
      kind: "Coverage gap",
      kindVariant: "amber-soft",
      severity: { label: "High", variant: "warning-soft" },
    });
    expect(rows[1]).toMatchObject({
      where: "—",
      kind: "Notifies no one",
      kindVariant: "amber-soft",
      severity: null,
    });
  });
});

describe("a service's location on cards and in tables", () => {
  const outside = (evidence: Record<string, unknown>) =>
    suggestion({
      subject: { kind: "service", key_dims: { service_name: "checkout" } },
      evidence: { service_name: "checkout", severity: "high", cells: {}, ...evidence },
    });
  const why = (s: AutoObserveSuggestion) => toRequests(gt, EAST, [s])[0].insight.meta;

  it("a card outside Kubernetes never prints dashes", () => {
    expect(why(outside({ traffic_per_hour: 4 }))).toBe("About 4 events an hour");
    expect(why(outside({}))).toBeNull();
    const located = (dims: Record<string, string>) =>
      why(
        suggestion({
          subject: { kind: "service", key_dims: { service_name: "checkout", ...dims } },
          evidence: { service_name: "checkout", traffic_per_hour: 4, cells: {} },
        }),
      );
    expect(located({ k8s_cluster_name: "prod", k8s_namespace_name: "payments" })).toBe(
      "prod / payments, about 4 events an hour",
    );
    expect(located({ k8s_cluster_name: "prod" })).toBe("prod, about 4 events an hour");
    expect(located({ k8s_namespace_name: "payments" })).toBe("payments, about 4 events an hour");
    const all = toRequests(gt, EAST, [outside({ traffic_per_hour: 4 }), outside({})]);
    expect(JSON.stringify(all)).not.toContain("—");
  });

  it("table cells keep the no-value dash", () => {
    const [row] = toSuggestionRows(gt, EAST, [outside({ traffic_per_hour: 4 })]);
    expect(row.where).toBe("—");
    const [one] = toSuggestionRows(gt, EAST, [
      suggestion({
        subject: {
          kind: "service",
          key_dims: { service_name: "checkout", k8s_cluster_name: "prod" },
        },
      }),
    ]);
    expect(one.where).toBe("prod");
    const coverage = {
      view: "strict",
      pass_at: null,
      refreshed_at: null,
      quality: null,
      classes: [],
      rows: [
        { service_name: "checkout", cluster: "", namespace: "", streams: [], cells: {} },
        { service_name: "orders", cluster: "prod", namespace: "", streams: [], cells: {} },
      ],
    } as unknown as AutoObserveCoverage;
    const source = toCoverageSource(
      gt,
      coverage,
      { status: "ready", retry: () => undefined },
      "en-US",
    );
    expect(source.rows.map((r) => r.where)).toEqual(["—", "prod"]);
  });
});

describe("rail order (one rank for rail and drawer)", () => {
  const ranked = [
    suggestion({ id: "gap" }),
    suggestion({
      id: "blind-medium",
      kind: "blind_guardrail",
      evidence: { monitor_name: "API errors", severity: "medium", reason: "no_data" },
    }),
    suggestion({
      id: "blind-high",
      kind: "blind_guardrail",
      evidence: { monitor_name: "Checkout", severity: "high", reason: "no_data" },
    }),
  ];

  it("keeps the server's sort=priority order, exactly as the drawer does", () => {
    const rail = toRequests(gt, EAST, ranked).map((r) => r.id);
    const drawer = toSuggestionRows(gt, EAST, ranked).map((r) => r.id);
    expect(rail).toEqual(["gap", "blind-medium", "blind-high"]);
    expect(rail).toEqual(drawer);
  });
});

describe("unknown suggestion kinds", () => {
  const odd = suggestion({ id: "x", kind: "discovery_partial" });

  it("never shows the raw kind key", () => {
    const [request] = toRequests(gt, EAST, [odd]);
    const [row] = toSuggestionRows(gt, EAST, [odd]);
    for (const text of [request.copy?.label, request.copy?.headline, row.kind, row.headline])
      expect(text).not.toContain("discovery_partial");
    expect(row.kind).toBe("Other");
    expect(request.copy?.headline).toBe("I found something this page can't show yet");
  });
});

describe("toCoverageSource", () => {
  const coverage = (over: Partial<AutoObserveCoverage>): AutoObserveCoverage => ({
    view: "strict",
    pass_at: null,
    refreshed_at: null,
    quality: null,
    classes: [],
    rows: [],
    ...over,
  });
  const retry = () => undefined;

  it("tells 'no pass in the last day' apart from 'a pass found no services'", () => {
    expect(
      toCoverageSource(gt, coverage({}), { status: "ready", retry }, "en-US").passMinutes,
    ).toBeNull();
    const passAt = (Date.now() - 5 * 60_000) * 1000;
    const found = toCoverageSource(
      gt,
      coverage({ pass_at: passAt }),
      { status: "ready", retry },
      "en-US",
    );
    expect(found.passMinutes).toBe(5);
    expect(found.rows).toHaveLength(0);
  });

  it("names every alert that falls short the same way, not only the first (T2-20)", () => {
    const ev = (name: string) => ({
      monitor_kind: "alert",
      monitor_id: name,
      monitor_name: name,
      predicate: "",
      last_data_at: null,
    });
    const source = toCoverageSource(
      gt,
      coverage({
        rows: [
          {
            service_name: "svc-y",
            cluster: null,
            namespace: null,
            streams: [],
            cells: {
              errors: { state: "none", evidence: [], counts: {} },
              latency: {
                state: "weak",
                evidence: [ev("ingress-slow-requests"), ev("ingress-upstream-blips")],
                counts: {},
              },
              absence: { state: "none", evidence: [], counts: {} },
            },
          },
        ] as never,
      }),
      { status: "ready", retry },
      "en-US",
    );
    expect(source.rows[0].checks?.latency.reason).toBe(
      "Latency: only ingress-slow-requests and ingress-upstream-blips, broad alerts, may notice a problem; they aren't scoped to this service",
    );
  });

  it("labels a service with the two live state words", () => {
    const cell = (state: string) => ({ state, evidence: [], counts: {} });
    const row = (name: string, errors: string) => ({
      service_name: name,
      cluster: "prod-eu",
      namespace: "billing",
      streams: [],
      cells: { errors: cell(errors), latency: cell("none"), absence: cell("none") },
    });
    const source = toCoverageSource(
      gt,
      coverage({ rows: [row("api", "covered"), row("web", "none")] as never }),
      { status: "ready", retry },
      "en-US",
    );
    const [api, web] = source.rows;
    expect(api.status).toMatchObject({ state: "watched", label: "Watched" });
    expect(web.status).toEqual({ state: "gap", label: "Coverage gap" });
    expect(source.totals).toMatchObject({ total: 2, gaps: 1, fullyWatched: 1, learning: 0 });
  });

  it("gives each service the engine's three checks, and its state agrees with them", () => {
    const cell = (state: string) => ({ state, evidence: [], counts: {} });
    const row = (name: string, cells: Record<string, string>) => ({
      service_name: name,
      cluster: "prod-eu",
      namespace: "billing",
      streams: [],
      cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, cell(v)])),
    });
    const source = toCoverageSource(
      gt,
      coverage({
        rows: [
          row("api", { errors: "covered", latency: "none", absence: "none" }),
          row("cart", { errors: "none", latency: "none", absence: "covered" }),
          row("db", { errors: "none", latency: "silent", saturation: "covered" }),
          row("web", { errors: "none", latency: "none", absence: "none" }),
        ] as never,
      }),
      { status: "ready", retry },
      "en-US",
    );
    for (const r of source.rows) {
      const checks = r.checks ?? {};
      expect(Object.keys(checks)).toEqual(["errors", "latency", "absence"]);
      const covered = Object.values(checks).some((c) => c.engine?.stateKey === "covered");
      expect(r.status?.state).toBe(covered ? "watched" : "gap");
    }
    const byName = Object.fromEntries(source.rows.map((r) => [r.service, r]));
    expect(byName.cart.status?.state).toBe("watched");
    expect(byName.db.status?.state).toBe("gap");
    expect(byName.db.checks?.latency.engine?.stateKey).toBe("silent");
    expect(byName.db.checks?.absence.engine?.stateKey).toBe("none");
  });

  it("counts the header's detectors over the three checks, as each row does", () => {
    const covered = (name: string) => ({
      state: "covered",
      evidence: [{ monitor_kind: "alert", monitor_id: name, monitor_name: name, predicate: "" }],
      counts: {},
    });
    const source = toCoverageSource(
      gt,
      coverage({
        rows: [
          {
            service_name: "api",
            cluster: null,
            namespace: null,
            streams: [],
            cells: { errors: covered("api-errors"), saturation: covered("api-cpu") },
          },
        ] as never,
      }),
      { status: "ready", retry },
      "en-US",
    );
    expect(source.totals.detectors).toBe(1);
  });

  it("counts each service's detectors as the distinct monitors the header counts", () => {
    const covered = (...ids: string[]) => ({
      state: "covered",
      evidence: ids.map((id) => ({
        monitor_kind: "alert",
        monitor_id: id,
        monitor_name: id,
        predicate: "",
      })),
      counts: {},
    });
    const service = (name: string, cells: Record<string, unknown>) => ({
      service_name: name,
      cluster: null,
      namespace: null,
      streams: [],
      cells,
    });
    const source = toCoverageSource(
      gt,
      coverage({
        rows: [
          service("checkout", { errors: covered("m1", "m2"), saturation: covered("cpu") }),
          service("cart", { errors: covered("m3"), latency: covered("m3") }),
        ] as never,
      }),
      { status: "ready", retry },
      "en-US",
    );
    expect(source.totals.detectors).toBe(3);
    expect(source.rows.map(detectorsOf)).toEqual([2, 1]);
  });

  it("reads Last checked with the page's relative time, never a raw minute count", () => {
    const row = { service_name: "api", cluster: null, namespace: null, streams: [], cells: {} };
    const at = (minutes: number) =>
      toCoverageSource(
        gt,
        coverage({ pass_at: (Date.now() - minutes * 60_000) * 1000, rows: [row] as never }),
        { status: "ready", retry },
        "en-US",
      ).rows[0].lastScanned;
    expect(at(0)).toBe("just now");
    expect(at(125)).toBe("2 hours ago");
    expect(at(1439)).toBe("23 hours ago");
  });

  it("carries the failure and the stale times through", () => {
    const source = toCoverageSource(
      gt,
      undefined,
      {
        status: "error",
        retry,
        failure: "denied",
        stale: null,
      },
      "en-US",
    );
    expect(source).toMatchObject({ status: "error", failure: "denied", rows: [], stale: null });
    expect(source.totals.total).toBe(0);
  });
});

describe("toCoverageSource service names", () => {
  const cell = { state: "none", evidence: [], counts: {} };
  const svc = (name: string, cluster: string, namespace = "ns") => ({
    service_id: `${name}:${cluster}:${namespace}`,
    service_name: name,
    cluster,
    namespace,
    streams: [],
    cells: { errors: cell, latency: cell, absence: cell },
  });
  const names = (rows: unknown[]) =>
    toCoverageSource(
      gt,
      {
        view: "strict",
        pass_at: null,
        refreshed_at: null,
        quality: null,
        classes: [],
        rows,
      } as unknown as AutoObserveCoverage,
      { status: "ready", retry: () => undefined },
      "en-US",
    ).rows.map((r) => r.service);

  it("keeps a service really named like a generated label apart from the one it reads like", () => {
    expect(
      names([svc("api", "prod", "ns-a"), svc("api", "prod", "ns-b"), svc("api · ns-a", "x", "y")]),
    ).toEqual(["api · prod · ns-a", "api · ns-b", "api · ns-a"]);
  });

  it("numbers services that share a name, cluster and namespace", () => {
    expect(names([svc("api", "prod"), svc("api", "prod"), svc("web", "prod")])).toEqual([
      "api · prod · ns #1",
      "api · prod · ns #2",
      "web",
    ]);
  });

  it("never numbers a label onto the name another service really has", () => {
    const labels = names([
      svc("api", "prod"),
      svc("api", "prod", "other"),
      svc("api · ns", "elsewhere", "x"),
      svc("api · prod · ns #1", "elsewhere", "x"),
    ]);
    expect(new Set(labels).size).toBe(4);
    expect(labels[3]).toBe("api · prod · ns #1");
  });

  // Demo bug 7 (F94): labels read "svc-a · ns-b" or "no namespace", never "(—/—)".
  it("tells the same name apart by namespace first", () => {
    expect(names([svc("api", "prod", "ns-a"), svc("api", "prod", "ns-b")])).toEqual([
      "api · ns-a",
      "api · ns-b",
    ]);
  });

  it("adds the cluster only when the namespace is shared too", () => {
    expect(names([svc("api", "prod"), svc("api", "dev")])).toEqual([
      "api · prod · ns",
      "api · dev · ns",
    ]);
  });

  it("names a missing namespace or cluster in words", () => {
    const none = null as unknown as string;
    expect(names([svc("api", none, none), svc("api", "prod", "ns")])).toEqual([
      "api · no namespace",
      "api · ns",
    ]);
    expect(names([svc("api", none, "ns"), svc("api", "prod", "ns")])).toEqual([
      "api · no cluster · ns",
      "api · prod · ns",
    ]);
    expect(names([svc("api", none, none), svc("api", "", "")])).toEqual([
      "api · no cluster · no namespace #1",
      "api · no cluster · no namespace #2",
    ]);
  });

  it("keeps a lone service's bare name", () => {
    expect(names([svc("api", "prod")])).toEqual(["api"]);
  });

  it("gives 50 services sharing names a unique label each, with no dash or bracket", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      svc(`svc-${i % 4}`, ["prod", "dev", "", "stage"][i % 3], ["ns-a", "", "ns-b"][(i % 5) % 3]),
    );
    const labels = names(rows);
    expect(new Set(labels).size).toBe(50);
    for (const label of labels) expect(label).not.toMatch(/[—()/]/);
  });
});

describe("silent_coverage: Notifies no one (demo bug 4)", () => {
  const ID = "alert-7f3a";
  const NAMES = Array.from({ length: 12 }, (_, i) => `svc-${String.fromCharCode(97 + i)}`);
  const DESTS = Array.from({ length: 12 }, (_, i) => (i ? `pager-${i}` : "ops-pager"));
  const silent = (evidence: Record<string, unknown>) =>
    suggestion({
      id: "s-silent",
      kind: "silent_coverage",
      subject: { kind: "alert", key_dims: { entity_id: ID } },
      evidence: { monitor_name: "svc-y-errors", classes: ["errors"], ...evidence },
    });
  // ENT sends at most 10 names and the full count beside them.
  const withServices = (n: number) =>
    silent({ services: NAMES.slice(0, Math.min(n, 10)), service_count: n });
  const withDests = (n: number) =>
    silent({
      services: ["svc-y"],
      service_count: 1,
      undeliverable: DESTS.slice(0, Math.min(n, 10)),
      undeliverable_count: n,
    });
  const card = (s: AutoObserveSuggestion) => toRequests(gt, EAST, [s])[0].copy!;
  const row = (s: AutoObserveSuggestion) => toSuggestionRows(gt, EAST, [s])[0];

  it("is the coverage amber on the card and in the drawer, with its own bell, not red", () => {
    const s = withServices(1);
    expect(card(s).label).toBe("Notifies no one");
    expect(card(s).look).toBe("notify");
    expect(KIND_LOOK[card(s).look].icon).toBe("notifications");
    expect(KIND_LOOK[card(s).look].badge).toContain("text-badge-amber-soft-text");
    expect(KIND_LOOK[card(s).look].accent).toBe("bg-badge-amber-soft-text");
    expect(row(s)).toMatchObject({ kind: "Notifies no one", kindVariant: "amber-soft" });
  });

  it.each([
    [0, "svc-y-errors would notice a service stopping, but it notifies no one."],
    [1, "svc-y-errors would notice svc-a stopping, but it notifies no one."],
    [3, "svc-y-errors would notice svc-a, svc-b, and svc-c stopping, but it notifies no one."],
    [
      12,
      "svc-y-errors would notice svc-a, svc-b, svc-c, and 9 more stopping, but it notifies no one.",
    ],
  ])("with %i services says why and what next", (n, why) => {
    const s = withServices(n);
    expect(card(s).why).toBe(`${why} Give it a destination.`);
    expect(row(s).note).toBe(card(s).why);
  });

  it.each([
    [
      1,
      "svc-y-errors can't reach ops-pager",
      "ops-pager takes tickets, not alerts. Add a webhook or email next to it; ops-pager stays.",
    ],
    [
      3,
      "svc-y-errors can't reach ops-pager and 2 more",
      "ops-pager and 2 more take tickets, not alerts. Add a webhook or email next to them; ops-pager and 2 more stay.",
    ],
    [
      12,
      "svc-y-errors can't reach ops-pager and 11 more",
      "ops-pager and 11 more take tickets, not alerts. Add a webhook or email next to them; ops-pager and 11 more stay.",
    ],
  ])("with %i undeliverable destinations names the first and counts the rest", (n, head, why) => {
    const s = withDests(n);
    expect(card(s).headline).toBe(head);
    expect(card(s).why).toBe(why);
    expect(row(s).headline).toBe(head);
    expect(row(s).note).toBe(why);
    expect(why.match(/tickets/g)).toHaveLength(1);
  });

  it("with no destination names falls back to the plain silent wording", () => {
    const s = silent({
      services: ["svc-a"],
      service_count: 1,
      undeliverable: [],
      undeliverable_count: 0,
    });
    expect(card(s).headline).toBe("svc-y-errors watches errors on 1 service but notifies no one");
    expect(card(s).why).toContain("Give it a destination.");
  });

  it("shows no internal key or id", () => {
    for (const s of [withServices(0), withServices(12), withDests(1), withDests(12)]) {
      const text = [card(s).label, card(s).headline, card(s).why, row(s).note, row(s).kind].join(
        " ",
      );
      expect(text).not.toMatch(/autoobserveLive|silent_coverage|undeliverable|_count|alert-7f3a/);
    }
  });
});
