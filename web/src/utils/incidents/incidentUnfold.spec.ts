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
import type { IncidentAlert, IncidentTopology } from "@/services/incidents";
import {
  alertLiveState,
  incidentFiringCounts,
  incidentLiveSummary,
  liveRowsOf,
  incidentLiveWords,
  incidentUnfold,
  maxOf,
  minOf,
  type IncidentAlertRow,
  type IncidentUnfoldInput,
} from "./incidentUnfold";
import { rcaFiringScope } from "@/components/alerts/rca/rcaLight";

const T0 = Date.UTC(2026, 10, 11, 15, 15, 0) * 1000;
const min = (m: number) => T0 + m * 60_000_000;

const firing = (alertId: string, at: number, name = alertId): IncidentAlert => ({
  incident_id: "inc",
  alert_id: alertId,
  alert_name: name,
  alert_fired_at: at,
  correlation_reason: "service_discovery",
  created_at: at,
});

const node = (alertId: string, service: string) => ({
  alert_id: alertId,
  alert_name: alertId,
  service_name: service,
  alert_count: 1,
  first_fired_at: T0,
  last_fired_at: T0,
});

const input = (over: Partial<IncidentUnfoldInput> = {}): IncidentUnfoldInput => ({
  status: "open",
  firstAlertAt: T0,
  triggers: [],
  alerts: [],
  topology: null,
  now: min(30),
  ...over,
});

const alertCards = (over: Partial<IncidentUnfoldInput>) =>
  incidentUnfold(input(over), gt).cards.filter((c) => c.kind === "alert");

const panelOf = (over: Partial<IncidentUnfoldInput>, id = "a") =>
  incidentUnfold(input(over), gt).alerts[`alert-${id}`];

// The backend's topology: one edge per node, from its immediate predecessor in firing order.
const chainEdges = (count: number, dependencyInto: number[] = []) =>
  Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    from_node_index: i,
    to_node_index: i + 1,
    edge_type: dependencyInto.includes(i + 1) ? "service_dependency" : "temporal",
  }));

describe("incidentUnfold", () => {
  // The backend does not cap trigger rows; spreading this many into Math.max throws RangeError.
  const many = Array.from({ length: 200_000 }, (_, i) => firing("a", T0 + i * 1_000_000));
  it.each([
    ["maxOf", () => maxOf(many.map((f) => f.alert_fired_at)), T0 + 199_999_000_000],
    ["minOf", () => minOf(many.map((f) => f.alert_fired_at)), T0],
    ["longestGap", () => panelOf({ triggers: many, now: T0 + 2e11 }).longestGap, 1_000_000],
    ["rcaFiringScope", () => rcaFiringScope(many)?.lastAt, T0 + 199_999_000_000],
  ])("%s handles 200,000 firings", (_name, run, expected) => {
    expect(run()).toBe(expected);
  });

  it("makes one card per alert, never one per firing", () => {
    const triggers = [
      firing("a", min(0)),
      firing("a", min(5)),
      firing("a", min(9)),
      firing("b", min(2)),
    ];
    const cards = alertCards({ triggers });
    expect(cards.map((c) => c.id)).toEqual(["alert-a", "alert-b"]);
    expect(cards[0].count).toBe(3);
    expect(`${cards[0].at} → ${cards[0].until}`).toBe("15:15 → 15:24");
    expect(cards[1].count).toBeUndefined();
    expect(cards[1].detail).toBe("Fired once");
  });

  it("lanes alerts by service, falling back to the stream of the alert with that id", () => {
    const triggers = [firing("a", min(0)), firing("b", min(1)), firing("c", min(2), "b")];
    const topology: IncidentTopology = {
      nodes: [node("a", "checkout"), node("b", "")],
      edges: [],
      related_incident_ids: [],
    };
    const cards = alertCards({
      triggers,
      topology,
      alerts: [
        { id: "b", name: "b", stream_name: "vpc_flow" },
        { id: "c", name: "b", stream_name: "staging" },
      ],
    });
    expect(cards.map((c) => c.lane)).toEqual(["checkout", "vpc_flow · stream", "staging · stream"]);
  });

  it("treats a service the topology could not name as no service", () => {
    const topology: IncidentTopology = {
      nodes: [node("a", "unknown")],
      edges: [],
      related_incident_ids: [],
    };
    const cards = alertCards({
      triggers: [firing("a", min(0))],
      topology,
      alerts: [{ id: "a", name: "a", stream_name: "vpc_flow" }],
    });
    expect(cards[0].lane).toBe("vpc_flow · stream");
  });

  it("names a service's lane by its display name, keyed services sharing one name sharing a lane", () => {
    const topology: IncidentTopology = {
      nodes: [
        { ...node("a", "o2-ingester"), display_name: "ingester" },
        { ...node("b", "ingester-v2"), display_name: "ingester" },
        node("c", "checkout"),
      ],
      edges: [],
      related_incident_ids: [],
    };
    const cards = alertCards({
      triggers: [firing("a", min(0)), firing("b", min(1)), firing("c", min(2))],
      topology,
    });
    expect(cards.map((c) => c.lane)).toEqual(["ingester", "ingester", "checkout"]);
  });

  it("gives every alert the alert tone, amber only while the alert list says it fires now", () => {
    const triggers = [firing("a", min(0)), firing("b", min(20)), firing("c", min(1))];
    const alertRows = [
      { alert_id: "b", last_satisfied_at: min(28), trigger_condition: { frequency: 5 } },
      { alert_id: "c", last_satisfied_at: min(1), trigger_condition: { frequency: 5 } },
    ];
    const [a, c, b] = alertCards({ triggers, alertRows, now: min(30) });
    expect([a.tone, c.tone, b.tone]).toEqual(["info", "info", "warning"]);
    expect(a.tag).toBe("alerts.incidents.unfold.firstToFire");
    expect(b.live).toMatchObject({ label: "Firing now", tone: "warning" });
    expect(c.live?.label).toBe("Quiet now");
    expect(alertCards({ triggers: [firing("a", min(0))] })[0].tag).toBeUndefined();
  });

  it("shows no live state on a resolved incident's cards, where only Likely cause keeps its red", () => {
    const triggers = [firing("a", min(0)), firing("b", min(20)), firing("c", min(21))];
    const row = { last_satisfied_at: min(28), trigger_condition: { frequency: 5 } };
    const alertRows = [
      { alert_id: "a", ...row },
      { alert_id: "b", ...row },
      { alert_id: "c", ...row, last_outcome: "error" },
    ];
    const cards = alertCards({
      triggers,
      alertRows,
      status: "resolved",
      resolvedAt: min(29),
      causeAlertId: "a",
    });
    expect(cards.map((c) => c.live)).toEqual([undefined, undefined, undefined]);
    expect(cards.map((c) => c.tone)).toEqual(["danger", "info", "info"]);
  });

  it("marks Likely cause only on the alert the analysis's root cause names", () => {
    const triggers = [firing("a", min(0)), firing("b", min(2))];
    const [a, b] = alertCards({ triggers, causeAlertId: "b" });
    expect(b.tone).toBe("danger");
    expect(b.tag).toBe("autoobserve.unfold.likelyCause");
    expect(a.tone).toBe("info");
    expect(a.tag).toBe("alerts.incidents.unfold.firstToFire");
    const [first] = alertCards({ triggers, causeAlertId: "a" });
    expect(first.tone).toBe("danger");
    expect(first.tag).toBe("autoobserve.unfold.likelyCause");
  });

  it("switches to the long-running mode once the incident is open 2 h or more", () => {
    const triggers = [firing("a", min(0)), firing("a", min(3)), firing("a", min(6))];
    const short = incidentUnfold(input({ triggers, now: min(119) }), gt);
    expect(short.cards[0].strip).toBeUndefined();

    const long = incidentUnfold(
      input({ triggers: [...triggers, firing("b", min(9))], now: min(120) }),
      gt,
    );
    expect(long.cards[0].strip?.length).toBe(8);
    expect(long.cards[1].strip).toBeUndefined();

    const resolved = incidentUnfold(
      input({ triggers, status: "resolved", resolvedAt: min(150), now: min(600) }),
      gt,
    );
    expect(resolved.cards[0].strip).toBeDefined();
  });

  it("dates every time not on today, a range across midnight included", () => {
    const triggers = [
      firing("a", min(0)),
      firing("b", min(8 * 60 + 5)),
      firing("b", min(9 * 60 + 9)),
      firing("c", min(10)),
      firing("c", min(3 * 24 * 60)),
    ];
    const now = min(9 * 60 + 30);
    const [a, , b] = alertCards({ triggers, now });
    expect(a.at).toBe("Nov 11, 15:15");
    expect(`${b.at} → ${b.until}`).toBe("Nov 11, 23:20 → 00:24");
    const later = alertCards({ triggers, now: min(4 * 24 * 60) });
    expect(`${later[1].at} → ${later[1].until}`).toBe("Nov 11, 15:25 → Nov 14");
    expect(panelOf({ triggers, now }, "b").times).toEqual(["Nov 11, 23:20", "00:24"]);
  });

  it("ends a closed incident's strips at its last firing, not at the resolve", () => {
    const triggers = [firing("a", min(0)), firing("a", min(150))];
    const { cards } = incidentUnfold(
      input({ triggers, status: "resolved", resolvedAt: min(5 * 24 * 60), now: min(6 * 24 * 60) }),
      gt,
    );
    expect(cards[0].strip?.length).toBe(10);
    expect(cards[0].strip?.reduce((sum, n) => sum + n, 0)).toBe(2);
  });

  it("summarises firings with locale number formatting", () => {
    const triggers = Array.from({ length: 1200 }, (_, i) => firing(`a${i % 2}`, min(i)));
    const unfold = incidentUnfold(input({ triggers, now: min(1300), locale: "en-US" }), gt);
    expect(unfold.firings).toBe("1,200");
    expect(unfold.alertCount).toBe(2);
    expect(incidentUnfold(input({ triggers, now: min(1300), locale: "de-DE" }), gt).firings).toBe(
      "1.200",
    );
  });

  it("counts one firing per evaluation, however many trigger rows it wrote", () => {
    const thrice = (id: string, at: number) => [firing(id, at), firing(id, at), firing(id, at)];
    const triggers = [...thrice("a", min(0)), ...thrice("b", min(20)), ...thrice("b", min(25))];
    const unfold = incidentUnfold(input({ triggers, now: min(30) }), gt);
    const b = unfold.cards.find((c) => c.id === "alert-b")!;
    expect(b.count).toBe(2);
    expect(unfold.alerts["alert-b"].times).toHaveLength(2);
    expect(unfold.alerts["alert-b"].medianInterval).toBe(5 * 60_000_000);
    expect(unfold.firingCount).toBe(3);

    const many = Array.from({ length: 50 }, (_, i) => thrice("c", min(i * 3))).flat();
    const long = incidentUnfold(input({ triggers: many, now: min(150) }), gt);
    expect(long.cards[0].count).toBe(50);
    expect(long.alerts["alert-c"].medianInterval).toBe(3 * 60_000_000);
    expect(long.alerts["alert-c"].longestGap).toBe(3 * 60_000_000);
  });

  it("breaks a first-fired tie by the topology's node order, as the backend does", () => {
    const triggers = [firing("a", T0), firing("b", T0)];
    const topology: IncidentTopology = {
      nodes: [node("b", "web"), node("a", "api")],
      edges: chainEdges(2),
      related_incident_ids: [],
    };
    const [first, second] = alertCards({ triggers, topology });
    expect(first.id).toBe("alert-b");
    expect(first.tag).toBe("alerts.incidents.unfold.firstToFire");
    expect(second.id).toBe("alert-a");
    expect(second.after).toBe("alert-b");
  });

  it("shows every time in the app's configured time zone, not the browser's", () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const triggers = Array.from({ length: 9 }, (_, i) => firing("a", min(i * 2)));
      const timezone = "Asia/Kolkata";
      const few = alertCards({ triggers: triggers.slice(0, 2), timezone });
      expect(`${few[0].at} → ${few[0].until}`).toBe("20:45 → 20:47");
      expect(panelOf({ triggers: triggers.slice(0, 2), timezone }).times?.[0]).toBe("20:45");

      const many = panelOf({ triggers, now: min(30), timezone });
      expect(many.histogram?.ticks[0]).toBe("20:45");
      expect(many.histogram?.caption).toContain("Nov 11, 20:45");

      const { cards } = incidentUnfold(
        input({ triggers: triggers.slice(0, 2), timezone, acknowledgedAt: min(3) }),
        gt,
      );
      expect(cards.find((c) => c.id === "team-acknowledged")?.at).toBe("20:48");
      expect(cards.find((c) => c.id === "team-open")?.detail).toBe("Open since 20:45");
    } finally {
      process.env.TZ = zone;
    }
  });

  it("widens the histogram's buckets so a long incident keeps at most 192 of them", () => {
    const triggers = Array.from({ length: 9 }, (_, i) => firing("a", min(i * 2)));
    const histogramFor = (minutes: number) => panelOf({ triggers, now: min(minutes) }).histogram!;
    expect(histogramFor(48 * 60).points).toHaveLength(192);
    expect(histogramFor(48 * 60).caption).toMatch(/^Firings per 15 minutes, /);
    expect(histogramFor(3 * 24 * 60).points).toHaveLength(144);
    expect(histogramFor(3 * 24 * 60).caption).toMatch(/^Firings per 30 minutes, /);
    expect(histogramFor(7 * 24 * 60).caption).toMatch(/^Firings per hour, /);
    expect(histogramFor(10 * 24 * 60).points).toHaveLength(80);
    expect(histogramFor(10 * 24 * 60).caption).toMatch(/^Firings per 3 hours, /);
    expect(histogramFor(400 * 24 * 60).caption).toMatch(/^Firings per day, /);
  });

  it("labels a histogram that spans days by date alone", () => {
    const triggers = Array.from({ length: 9 }, (_, i) => firing("a", min(i * 2 * 24 * 60)));
    const resolvedAt = min(16 * 24 * 60);
    const { histogram } = panelOf({ triggers, status: "resolved", resolvedAt });
    expect(histogram?.ticks).toEqual(["Nov 11", "Nov 27"]);
    expect(histogram?.caption).toBe("Firings per 3 hours, Nov 11, 15:15 to Nov 27, 15:15");
  });

  describe("Your team lane", () => {
    const triggers = [firing("a", min(0)), firing("b", min(4))];

    it("shows the incident still open, linked from the last alert", () => {
      const team = incidentUnfold(input({ triggers, now: min(30) }), gt).cards.filter(
        (c) => c.lane === null,
      );
      expect(team.map((c) => c.outcome)).toEqual(["open"]);
      expect(team[0].title).toBe("Still open");
      expect(team[0].detail).toBe("Not acknowledged yet");
      expect(team[0].after).toBe("alert-b");
    });

    it("shows who acknowledged and when it resolved, each after the alert before it", () => {
      const team = incidentUnfold(
        input({
          triggers,
          status: "resolved",
          acknowledgedAt: min(2),
          acknowledgedBy: "priya@example.com",
          resolvedAt: min(20),
          events: [],
        }),
        gt,
      ).cards.filter((c) => c.lane === null);
      expect(team.map((c) => c.outcome)).toEqual(["acknowledged", "resolved"]);
      expect(team[0].at).toBe("15:17");
      expect(team[0].detail).toBe("by priya");
      expect(team[0].after).toBe("alert-a");
      expect(team[1].tone).toBe("success");
      expect(team[1].after).toBe("alert-b");
      expect(team[1].detail).toBe("No user recorded");
    });

    it("links an acknowledgement to the alert before it to the second, not the minute", () => {
      const cards = incidentUnfold(
        input({
          triggers: [firing("a", min(0)), firing("b", min(1) + 50_000_000)],
          status: "acknowledged",
          acknowledgedAt: min(1) + 5_000_000,
          now: min(2),
        }),
        gt,
      ).cards;
      const ack = cards.findIndex((c) => c.id === "team-acknowledged");
      expect(cards[ack].after).toBe("alert-a");
      expect(ack).toBeLessThan(cards.findIndex((c) => c.id === "alert-b"));
    });

    it("takes who acknowledged and who resolved from the incident events", () => {
      const events = [
        { timestamp: min(1), type: "Created" },
        { timestamp: min(3), type: "Acknowledged", data: { user_id: "sam@example.com" } },
        { timestamp: min(25), type: "Resolved", data: { user_id: "lee@example.com" } },
      ];
      const team = incidentUnfold(
        input({ triggers, status: "resolved", resolvedAt: min(25), events }),
        gt,
      ).cards.filter((c) => c.lane === null);
      expect(team.map((c) => [c.outcome, c.at, c.detail])).toEqual([
        ["acknowledged", "15:18", "by sam"],
        ["resolved", "15:40", "by lee"],
      ]);
    });

    it("says no user is recorded when an event names nobody", () => {
      const events = [
        { timestamp: min(3), type: "Acknowledged", data: { user_id: null } },
        { timestamp: min(25), type: "Resolved", data: { user_id: null } },
      ];
      const team = incidentUnfold(
        input({ triggers, status: "resolved", resolvedAt: min(25), events }),
        gt,
      ).cards.filter((c) => c.lane === null);
      expect(team.map((c) => c.detail)).toEqual(["No user recorded", "No user recorded"]);
    });
  });

  describe("folding many alerts", () => {
    const lanes = ["s1", "s2", "s3"];
    const manyTriggers = (perLane: number) =>
      lanes.flatMap((lane, l) =>
        Array.from({ length: perLane }, (_, i) => firing(`${lane}-${i}`, min(l * 30 + i))),
      );
    const topologyFor = (perLane: number): IncidentTopology => ({
      nodes: lanes.flatMap((lane) =>
        Array.from({ length: perLane }, (_, i) => node(`${lane}-${i}`, lane)),
      ),
      edges: [],
      related_incident_ids: [],
    });

    it("above 12, keeps each lane's first 2 alerts and folds the rest into one card", () => {
      expect(alertCards({ triggers: manyTriggers(4), topology: topologyFor(4) })).toHaveLength(12);
      const { cards } = incidentUnfold(
        input({ triggers: manyTriggers(5), topology: topologyFor(5), now: min(100) }),
        gt,
      );
      const s1 = cards.filter((c) => c.lane === "s1");
      expect(s1.map((c) => c.kind)).toEqual(["alert", "alert", "fold"]);
      expect(s1[2].title).toBe("+3 more alerts");
      expect(s1[2].expandLabel).toBeUndefined();
      expect(s1[2].folded?.map((f) => f.id)).toEqual(["alert-s1-2", "alert-s1-3", "alert-s1-4"]);
      expect(s1[2].after).toBe("alert-s1-1");
      expect(s1[2].detail).toBe("s1-2, s1-3, and s1-4");
    });

    it("names the first 5 folded alerts and counts the rest", () => {
      const { cards } = incidentUnfold(
        input({ triggers: manyTriggers(10), topology: topologyFor(10), now: min(100) }),
        gt,
      );
      expect(cards.find((c) => c.id === "fold-s1")?.detail).toBe(
        "s1-2, s1-3, s1-4, s1-5, s1-6, and 3 more",
      );
    });

    it("keeps the backend's chain of links whole when lanes fold", () => {
      const topology = { ...topologyFor(5), edges: chainEdges(15) };
      const { cards } = incidentUnfold(
        input({ triggers: manyTriggers(5), topology, now: min(100) }),
        gt,
      );
      const ids = new Set(cards.map((c) => c.id));
      expect(cards.filter((c) => c.after).every((c) => ids.has(c.after!))).toBe(true);
      // s2's first alert followed s1's last, which now sits inside s1's fold card.
      expect(cards.find((c) => c.id === "alert-s2-0")?.after).toBe("fold-s1");
      expect(cards.find((c) => c.id === "alert-s1-1")?.after).toBe("alert-s1-0");
    });

    it("puts a fold before a same-minute card that links from it", () => {
      const topology = topologyFor(5);
      topology.nodes.push(node("x-0", "x"));
      topology.edges = [{ from_node_index: 2, to_node_index: 15, edge_type: "temporal" }];
      const triggers = [...manyTriggers(5), firing("x-0", min(2))];
      const { cards } = incidentUnfold(input({ triggers, topology, now: min(100) }), gt);
      const ids = cards.map((c) => c.id);
      expect(cards.find((c) => c.id === "alert-x-0")?.after).toBe("fold-s1");
      expect(ids.indexOf("fold-s1")).toBeLessThan(ids.indexOf("alert-x-0"));
    });

    it("never folds a single extra alert, and keeps an expanded lane whole", () => {
      const triggers = [
        ...manyTriggers(5),
        firing("lone-0", min(200)),
        firing("lone-1", min(201)),
        firing("lone-2", min(202)),
      ];
      const topology = topologyFor(5);
      topology.nodes.push(node("lone-0", "lone"), node("lone-1", "lone"), node("lone-2", "lone"));
      const { cards } = incidentUnfold(
        input({ triggers, topology, now: min(300), expandedLanes: ["s2"] }),
        gt,
      );
      expect(cards.filter((c) => c.lane === "lone").map((c) => c.kind)).toEqual([
        "alert",
        "alert",
        "alert",
      ]);
      expect(cards.filter((c) => c.lane === "s2").every((c) => c.kind === "alert")).toBe(true);
    });
  });

  it("links each alert from its predecessor, dashed for a service dependency", () => {
    const triggers = [firing("a", min(0)), firing("b", min(1)), firing("c", min(3))];
    const topology: IncidentTopology = {
      nodes: [node("a", "db"), node("b", "web"), node("c", "api")],
      edges: chainEdges(3, [2]),
      related_incident_ids: [],
    };
    const cards = alertCards({ triggers, topology });
    const b = cards.find((card) => card.id === "alert-b");
    const c = cards.find((card) => card.id === "alert-c");
    expect(b?.after).toBe("alert-a");
    expect(b?.dependency).toBe(false);
    expect(c?.after).toBe("alert-b");
    expect(c?.dependency).toBe(true);
  });

  describe("many services", () => {
    const services = Array.from({ length: 40 }, (_, i) => `svc${String(i).padStart(2, "0")}`);
    const triggers = services.map((s, i) => firing(s, min(i)));
    const topology: IncidentTopology = {
      nodes: services.map((s) => node(s, s)),
      edges: chainEdges(40),
      related_incident_ids: [],
    };
    const serviceLanes = (cards: { lane: string | null }[]) => [
      ...new Set(cards.filter((c) => c.lane !== null).map((c) => c.lane)),
    ];

    it("above 8 lanes, keeps the 7 that fired first and folds the rest into one lane", () => {
      const eight = incidentUnfold(
        input({ triggers: triggers.slice(0, 8), topology, now: min(60) }),
        gt,
      );
      expect(serviceLanes(eight.cards)).toEqual(services.slice(0, 8));
      const { cards } = incidentUnfold(input({ triggers, topology, now: min(60) }), gt);
      const lanes = serviceLanes(cards);
      expect(lanes).toHaveLength(8);
      expect(lanes.slice(0, 7)).toEqual(services.slice(0, 7));
      expect(lanes[7]).toBe("+33 more services");
      const more = cards.filter((c) => c.lane === lanes[7]);
      expect(more).toHaveLength(1);
      expect(more[0].kind).toBe("fold");
      expect(more[0].title).toBe("+33 more services");
      expect(more[0].expandLabel).toBe("Show every service");
      expect(more[0].after).toBe("alert-svc06");
      expect(more[0].folded?.map((f) => f.title)).toEqual(services.slice(7));
      expect(cards[0].tag).toBe("alerts.incidents.unfold.firstToFire");
    });

    it("shows every service once its lane is expanded, and keeps it so as services join", () => {
      const folded = incidentUnfold(input({ triggers, topology, now: min(60) }), gt);
      const key = folded.cards.find((c) => c.kind === "fold")?.expandKey;
      expect(key).toBeTruthy();
      const expandedLanes = [key!];
      const { cards } = incidentUnfold(
        input({ triggers, topology, now: min(60), expandedLanes }),
        gt,
      );
      expect(serviceLanes(cards)).toHaveLength(40);

      const joined = {
        ...topology,
        nodes: [...topology.nodes, node("svc40", "svc40")],
      };
      const more = incidentUnfold(
        input({
          triggers: [...triggers, firing("svc40", min(41))],
          topology: joined,
          now: min(60),
          expandedLanes,
        }),
        gt,
      );
      expect(serviceLanes(more.cards)).toHaveLength(41);
    });
  });

  describe("each alert's live state", () => {
    const row = (over: Partial<IncidentAlertRow> = {}): IncidentAlertRow => ({
      alert_id: "a",
      enabled: true,
      last_satisfied_at: min(20),
      trigger_condition: { frequency: 5, frequency_type: "minutes", silence: 10 },
      ...over,
    });

    it.each([
      ["within 2 checks plus the silence", row(), min(40), "firing"],
      ["past that window", row(), min(41), "quiet"],
      ["a normal check after the firing", row({ last_outcome: "normal" }), min(21), "quiet"],
      ["a check that errored", row({ last_outcome: "error" }), min(21), "error"],
      ["disabled", row({ enabled: false }), min(21), "disabled"],
      ["never fired", row({ last_satisfied_at: null }), min(30), "quiet"],
      ["a pending check", row({ last_outcome: "pending" }), min(21), "quiet"],
      ["a skipped check", row({ last_outcome: "skipped" }), min(21), "quiet"],
      ["a firing check, however old", row({ last_outcome: "firing" }), min(90), "firing"],
      ["an open firing with an old check", row({ firing_started_at: min(1) }), min(90), "firing"],
      [
        "an errored check while groups fire",
        row({ last_outcome: "error", groups_firing: 2 }),
        min(21),
        "firing",
      ],
      [
        "a cron schedule, every 30 min",
        row({
          trigger_condition: { frequency: 1, frequency_type: "cron", cron: "0 */30 * * * *" },
        }),
        min(75),
        "firing",
      ],
    ])("reads the alert now from one rule: %s", (_case, alert, now, state) => {
      expect(alertLiveState(alert, now).state).toBe(state);
    });

    it("counts the incident's alerts by state; a missing one is unknown, an unread list tells nothing", () => {
      const rows = [
        row(),
        row({ alert_id: "b", last_satisfied_at: min(2) }),
        row({ alert_id: "d", last_outcome: "error" }),
      ];
      const live = incidentLiveSummary(["a", "b", "c", "d"], rows, min(30), min(4));
      expect(live).toEqual({ firing: 1, quiet: 1, unknown: 2, total: 4, lastFiring: min(4) });
      expect(incidentLiveWords(gt, live!, "en-US")?.label).toBe("1 of 4 alerts firing now");
      const quiet = incidentLiveSummary(["b", "c"], rows, min(30));
      expect(incidentLiveWords(gt, quiet!, "en-US")?.label).toBe("1 of 2 alerts quiet now");
      const unknown = incidentLiveSummary(["c"], rows, min(30));
      expect(unknown && incidentLiveWords(gt, unknown, "en-US")).toBeNull();
      expect(incidentLiveSummary([], rows, min(30))).toBeNull();
      const unread = liveRowsOf({
        list: [row({ last_satisfied_at: undefined })],
        status_unavailable: true,
      });
      expect(incidentLiveSummary(["a"], unread, min(30))).toBeNull();
      expect(liveRowsOf({ list: rows })).toBe(rows);
      const many = { firing: 1200, quiet: 0, unknown: 0, total: 1500 };
      expect(incidentLiveWords(gt, many, "de-DE")?.label).toBe("1.200 of 1.500 alerts firing now");
    });
  });

  it("counts distinct firings and alerts for the header", () => {
    const triggers = [
      firing("a", min(0)),
      firing("a", min(0)),
      firing("a", min(5)),
      firing("b", min(1)),
    ];
    expect(incidentFiringCounts(triggers)).toEqual({ firings: 3, alerts: 2 });
    expect(incidentFiringCounts([])).toEqual({ firings: 0, alerts: 0 });
  });

  it("gives the side panel each alert's firings, chips up to 8 or a pattern above, and how it joined", () => {
    const many = Array.from({ length: 9 }, (_, i) => firing("a", min(i * 2 + (i === 8 ? 10 : 0))));
    const once = { ...firing("b", min(1)), correlation_reason: "alert_id" as const };
    const { alerts } = incidentUnfold(input({ triggers: [...many, once] }), gt);
    expect(alerts["alert-a"]).toMatchObject({
      alertId: "a",
      name: "a",
      count: 9,
      first: min(0),
      last: min(26),
      medianInterval: 2 * 60_000_000,
      longestGap: 12 * 60_000_000,
      groupedBy: "Same service",
    });
    expect(alerts["alert-a"].times).toBeUndefined();
    expect(alerts["alert-a"].histogram?.points.length).toBeGreaterThan(0);
    const eight = panelOf({ triggers: many.slice(0, 8) });
    expect(eight.times).toHaveLength(8);
    expect(eight.times?.[1]).toBe("15:17");
    expect(eight.histogram).toBeUndefined();
    expect(alerts["alert-b"]).toMatchObject({ count: 1, groupedBy: "Same alert" });
    expect(alerts["alert-b"].medianInterval).toBeUndefined();
  });
});
