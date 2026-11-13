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
import "@/locales";
import config from "@/aws-exports";
import { gt, raw } from "@/types/i18n";
import type { CoverageCell, CoverageRow } from "../fixtures";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { cantBuildKinds, cellInsight, gapInsight, serviceRoute, tracesRoute } from "./coverageCta";
import { serviceKeyOf, useRecentlyCreated } from "./bulk/useRecentlyCreated";
import type { CoverageCell as Cell } from "../fixtures";

const gapCell = (stateKey: "none" | "silent" = "none", monitor?: string): CoverageCell => ({
  state: "gap",
  reason: raw("Absence: no monitor watches this"),
  engine: {
    state: raw(stateKey),
    stateKey,
    monitors: monitor
      ? [
          {
            id: "a-9",
            name: monitor,
            kind: raw("Alert"),
            kindKey: "alert",
            state: raw("Silent"),
            stateKey: "silent",
            predicate: "",
          },
        ]
      : [],
  },
});

const row = (streams: { type: string; name: string }[]): CoverageRow =>
  ({
    service: "svc-ingest-c",
    stream: "ingest_c",
    cells: {},
    checks: { errors: gapCell(), latency: gapCell(), absence: gapCell() },
    identity: {
      serviceId: "svc-ingest-c",
      serviceName: "svc-ingest-c",
      cluster: null,
      namespace: null,
      streams,
    },
  }) as unknown as CoverageRow;

const LOGS = { type: "logs", name: "ingest_c" };
const TRACES = { type: "traces", name: "default" };
const METRICS = { type: "metrics", name: "container_memory_working_set_bytes" };

let enterprise: string;
beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});
afterEach(() => {
  config.isEnterprise = enterprise;
});

const covered = (): Cell => ({
  ...gapCell(),
  state: "watched",
  engine: { ...gapCell().engine!, stateKey: "covered" },
});

describe("Signals watched gap line (flagged surface 2)", () => {
  it("drafts the errors, latency and no-data alerts in one review list, and Ask AI (F1)", () => {
    const parts = gapInsight(gt, "en-US", row([LOGS, TRACES]));
    expect(parts?.cta?.label).toBe("Review and add alerts");
    const target = parts?.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => [r.kind, r.scope.stream.name])).toEqual([
      ["errors", "ingest_c"],
      ["latency", "default"],
      ["no_data", "ingest_c"],
    ]);
    expect(parts?.ai?.subject).toBe("svc-ingest-c");
  });

  it("counts only the alerts it can build once the stream's fields are read (T2-11)", async () => {
    const svc = row([LOGS]);
    svc.checks!.latency = covered();
    const fields = vi.fn(async () => ({ names: ["service_name", "body"], types: {} }));
    const cant = await cantBuildKinds("demo-org", svc, fields);
    expect([...cant]).toEqual(["errors"]);
    const parts = gapInsight(gt, "en-US", svc, [], "demo-org", cant);
    expect(parts?.cta?.label).toBe("Add alert");
    expect(parts?.cta?.note).toBe(
      "Opens the alert form filled in. Nothing is saved until you save.",
    );
  });

  it("keeps every draft when the fields can't be read, so the review says why", async () => {
    const svc = row([LOGS]);
    expect([...(await cantBuildKinds("demo-org", svc, async () => null))]).toEqual([]);
  });

  it("offers one Add alert when only the no-data alert is missing", () => {
    const only = row([LOGS, TRACES]);
    only.checks!.errors = covered();
    only.checks!.latency = covered();
    const parts = gapInsight(gt, "en-US", only);
    expect(parts?.cta?.label).toBe("Add alert");
    expect(parts?.cta?.target.type).toBe("create_alert");
  });

  it("offers nothing without the service's streams", () => {
    expect(gapInsight(gt, "en-US", row([]))?.cta ?? null).toBeNull();
  });
});

describe("Just added, until the next check counts it (COVERAGE-AFTER-ADD)", () => {
  const recently = useRecentlyCreated();
  const key = serviceKeyOf("demo-org", "svc-ingest-c", null, null);
  afterEach(() => {
    recently.clearOnPass("demo-org", Number.MAX_SAFE_INTEGER);
    recently.clearOnPass("other-org", Number.MAX_SAFE_INTEGER);
  });

  it("never offers an alert this page just added again", () => {
    recently.add(key, "errors");
    recently.add(key, "no_data");
    const parts = gapInsight(gt, "en-US", row([LOGS, TRACES]), [], "demo-org");
    const target = parts?.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => r.kind)).toEqual(["latency"]);
  });

  it("offers nothing once every gap was just added", () => {
    for (const kind of ["errors", "latency", "no_data"] as const) recently.add(key, kind);
    expect(gapInsight(gt, "en-US", row([LOGS, TRACES]), [], "demo-org")?.cta ?? null).toBeNull();
  });

  it("says a just-added check is counted at the next check, with no second Add", () => {
    recently.add(key, "no_data");
    const r = row([LOGS, TRACES]);
    const parts = cellInsight(gt, "en-US", r, "absence", r.checks!.absence, "demo-org");
    expect(parts?.why).toBe(
      "Added. AutoObserve counts it at its next check, within about 5 minutes.",
    );
    expect(parts?.cta).toBeNull();
  });

  it("another org's add does not hide this org's gap", () => {
    recently.add(serviceKeyOf("other-org", "svc-ingest-c", null, null), "errors");
    const target = gapInsight(gt, "en-US", row([LOGS, TRACES]), [], "demo-org")?.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => r.kind)).toEqual(["errors", "latency", "no_data"]);
  });
});

describe("Signals chart details", () => {
  it("words the Requests chart as stopping, not 'Absence', and adds a no-data alert", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS]), "absence", gapCell());
    expect(parts?.why).toBe("Nothing alerts if svc-ingest-c stops sending.");
    expect(parts?.next).toBe(
      "Add a no-data alert: it fires when svc-ingest-c sends nothing for 15 minutes.",
    );
    expect(`${parts?.why} ${parts?.next}`).not.toMatch(/Absence|monitor/);
    expect(parts?.cta?.label).toBe("Add alert");
    const target = parts?.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    expect(target.prefill.sql).toContain("HAVING count(*) = 0");
  });

  it("asks for traces when latency can't be measured", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS]), "latency", gapCell());
    expect(parts?.why).toBe("Latency is charted from traces. svc-ingest-c sends none.");
    expect(parts?.cta?.label).toBe("Set up data");
  });

  it("drafts a latency alert from the service's traces, measuring its usual p95 on click (F1)", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS, TRACES]), "latency", gapCell());
    expect(parts?.cta?.label).toBe("Add alert");
    const target = parts?.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    const measure = target.draft?.measure?.({
      ...target.draft.scope,
      schema: ["service_name", "duration"],
    });
    expect(measure).toMatchObject({ kind: "latency", stream: TRACES });
    expect(measure?.sql).toContain("approx_percentile_cont");
  });

  it("opens the one-row review list for errors on a logs stream (F10)", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS, TRACES]), "errors", gapCell());
    expect(parts?.cta?.label).toBe("Add alert");
    const target = parts?.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows).toHaveLength(1);
    expect(target.request.rows[0]).toMatchObject({
      kind: "errors",
      scope: { stream: LOGS },
      usually: null,
    });
  });

  it("drafts errors on traces in the Add alert dialog, measuring the usual count on click (F1)", () => {
    const parts = cellInsight(gt, "en-US", row([TRACES]), "errors", gapCell());
    const target = parts?.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    const measure = target.draft?.measure?.({
      ...target.draft.scope,
      schema: ["service_name", "span_status"],
    });
    expect(measure).toMatchObject({ kind: "errors", stream: TRACES });
    expect(measure?.sql).toContain(`"span_status" = 'ERROR'`);
  });

  it("sends a silent alert to its editor to choose who gets notified", () => {
    const parts = cellInsight(
      gt,
      "en-US",
      row([LOGS]),
      "absence",
      gapCell("silent", "ingress-volume-detector"),
    );
    expect(parts?.why).toBe(
      "ingress-volume-detector watches whether svc-ingest-c stops sending, but it notifies no one.",
    );
    expect(parts?.cta?.label).toBe("Choose who gets notified");
    expect(parts?.cta?.target).toEqual({
      type: "destinations",
      alertId: "a-9",
      alertName: "ingress-volume-detector",
      destinations: [],
    });
  });
});

describe("Why matches the summary for an alert that falls short (T2-5, T2-6)", () => {
  const stated = (stateKey: "weak" | "blind" | "silent", ...names: string[]): CoverageCell => ({
    state: "gap",
    reason: raw(""),
    engine: {
      state: raw(stateKey),
      stateKey,
      monitors: names.map((name) => ({
        id: name,
        name,
        kind: raw("Alert"),
        kindKey: "alert",
        state: raw(stateKey),
        stateKey,
        predicate: "",
      })),
    },
  });

  it("a blind errors alert is named, never 'No alert watches'", () => {
    const parts = cellInsight(
      gt,
      "en-US",
      row([LOGS]),
      "errors",
      stated("blind", "traces-route-errors"),
    );
    expect(parts?.why).toBe(
      "traces-route-errors watches svc-ingest-c's errors, but it can't see this service's data.",
    );
  });

  it("two weak latency alerts are both named", () => {
    const parts = cellInsight(
      gt,
      "en-US",
      row([LOGS, TRACES]),
      "latency",
      stated("weak", "ingress-slow-requests", "ingress-upstream-blips"),
    );
    expect(parts?.why).toBe(
      "Only ingress-slow-requests and ingress-upstream-blips, broad alerts, watch svc-ingest-c's latency, and they aren't scoped to this service.",
    );
    expect(parts?.cta?.label).toBe("Add alert");
  });

  it("a silent errors alert is called an errors alert, not a stopping one", () => {
    const parts = cellInsight(
      gt,
      "en-US",
      row([LOGS]),
      "errors",
      stated("silent", "sec-twin-normal"),
    );
    expect(parts?.why).toBe(
      "sec-twin-normal watches svc-ingest-c's errors, but it notifies no one.",
    );
  });
});

describe("Other checks (flagged surface 3)", () => {
  it("adds a memory alert from the service's metrics", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS, METRICS]), "saturation", gapCell());
    expect(parts?.why).toBe(
      "No alert watches memory or CPU for svc-ingest-c. Container memory arrives in container_memory_working_set_bytes.",
    );
    expect(parts?.next).toBe("Add a memory alert at 90% of its limit.");
    expect(parts?.cta?.label).toBe("Add alert");
    const target = parts?.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    expect(target.prefill.queryType).toBe("promql");
  });

  it("says saturation can't be watched without metrics and offers Set up data", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS]), "saturation", gapCell());
    expect(parts?.why).toBe(
      "No CPU or memory data arrives for svc-ingest-c, so this can't be watched yet.",
    );
    expect(parts?.cta?.label).toBe("Set up data");
  });

  it("adds a synthetic check prefilled for the service", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS]), "external_probe", gapCell());
    expect(parts?.cta?.label).toBe("Add synthetic check");
    const target = parts?.cta?.target;
    if (target?.type !== "synthetic") throw new Error("expected synthetic");
    expect(target.prefill).toMatchObject({ name: "svc-ingest-c health", type: "http" });
    expect(target.prefill.url).toBe("");
    expect(target.prefill.locations).toEqual([]);
  });

  it("fills the synthetic check's URL and public locations from what the drawer read", () => {
    const location = (id: string, kind: "public" | "private") => ({
      id,
      kind,
      label: raw(id),
      region: "eu-west",
      provider: "o2",
      status: "online" as const,
    });
    const parts = cellInsight(gt, "en-US", row([LOGS]), "external_probe", gapCell(), "demo-org", {
      address: { url: "https://shop.example.com/health", from: "traces" },
      locations: [location("pub-1", "public"), location("pub-2", "public")],
    });
    const target = parts?.cta?.target;
    if (target?.type !== "synthetic") throw new Error("expected synthetic");
    expect(target.prefill.url).toBe("https://shop.example.com/health");
    expect(target.prefill.locations).toEqual(["pub-1", "pub-2"]);
  });

  it("adds a restarts alert on the service's restart events", () => {
    const events = { type: "logs", name: "k8s_events" };
    const parts = cellInsight(gt, "en-US", row([LOGS, events]), "workload_health", gapCell());
    expect(parts?.why).toBe("No alert watches restarts of svc-ingest-c.");
    expect(parts?.cta?.label).toBe("Add alert");
  });

  it("without restart events, says so and offers to set the data up, not a pod alert (T2-23)", () => {
    const parts = cellInsight(gt, "en-US", row([LOGS]), "workload_health", gapCell());
    expect(parts?.why).toBe(
      "No restart events arrive for svc-ingest-c, so its restarts can't be watched yet.",
    );
    expect(parts?.next).toBeNull();
    expect(parts?.cta?.label).toBe("Set up data");
  });

  it("names a cluster to set up only for a service that has one (T2-23)", () => {
    const none = cellInsight(gt, "en-US", row([LOGS]), "saturation", gapCell());
    expect(none?.cta?.note).toBeNull();
    const placed = row([LOGS]);
    placed.identity!.cluster = "cluster-k";
    const some = cellInsight(gt, "en-US", placed, "saturation", gapCell());
    expect(some?.cta?.note).toBe("Opens Kubernetes setup for its cluster.");
  });
});

describe("drawer header", () => {
  it("opens Traces filtered to the service, on its traces stream", () => {
    const to = tracesRoute(row([LOGS, TRACES]), "demo-org", 1_000_000) as {
      name: string;
      query: Record<string, string>;
    };
    expect(to.name).toBe("traces");
    expect(to.query.stream).toBe("default");
    expect(b64DecodeUnicode(to.query.query)).toContain("service_name");
    expect(b64DecodeUnicode(to.query.query)).toContain("svc-ingest-c");
  });
});

describe("Open the service where its data is (T2-7)", () => {
  type To = { name?: string; path?: string; query: Record<string, string> };
  it("opens Traces on the same scope the charts read, namespace included", () => {
    const to = serviceRoute(row([TRACES]), "demo-org", 1_000_000, {
      traces: { service_name: "svc-a", service_k8s_namespace_name: "ns-b" },
    }) as To;
    expect(to.name).toBe("traces");
    const where = b64DecodeUnicode(to.query.query) ?? "";
    expect(where).toContain("svc-a");
    expect(where).toContain("ns-b");
  });

  it("opens Logs for a service that sends only logs", () => {
    const to = serviceRoute(row([LOGS]), "demo-org", 1_000_000, {
      logs: { service_name: "svc-ingest-e" },
    }) as To;
    expect(to.path).toBe("/logs");
    expect(to.query.stream).toBe("ingest_c");
    expect(b64DecodeUnicode(to.query.query)).toContain("svc-ingest-e");
  });
});
