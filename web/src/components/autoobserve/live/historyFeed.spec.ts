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
import type { AutoObserveIncidentItem, AutoObserveIncidentList } from "@/services/autoobserve";
import type { DecisionView } from "@/services/autoobserveDecisions";
import incidents from "./__fixtures__/autoobserveIncidents.json";
import { historyDays, toHistoryRows } from "./historyFeed";

const ZONE = { locale: "en-US", timeZone: "UTC" };
const NOW = Date.UTC(2026, 10, 10, 18, 0);
const at = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);

const incident = (
  id: string,
  title: string,
  ms: number,
  status = "open",
): AutoObserveIncidentItem => {
  const base = (incidents as unknown as AutoObserveIncidentList).items[0];
  return {
    ...base,
    incident: { ...base.incident, id, title, created_at: ms * 1000, status },
  } as AutoObserveIncidentItem;
};

const decision = (over: Partial<DecisionView>): DecisionView => ({
  decision_id: `suggestion:${over.id ?? "s1"}`,
  family: "suggestion",
  id: "s1",
  action: "dismiss",
  state: "active",
  reason: "not_needed",
  note: null,
  has_note: false,
  actor: "ops-lead@example.com",
  source: "ui",
  decided_at: at(12) * 1000,
  until: null,
  revision: 1,
  subject: { title: "Nothing watches checkout", folder: null, team: null },
  ...over,
});

describe("toHistoryRows", () => {
  it("is empty with nothing to list", () => {
    expect(toHistoryRows(gt, ZONE, [], [], undefined, NOW)).toEqual([]);
  });

  it("tells each entry as a narrative, newest first, with the reader as You", () => {
    const paged = {
      ...incident("inc-1", "pay_api (logs) stopped sending data", at(16, 45), "resolved"),
      page: { outcome: "paged", team_id: "t1", team_name: "Payments" },
    } as AutoObserveIncidentItem;
    const rows = toHistoryRows(
      gt,
      ZONE,
      [paged],
      [
        decision({ id: "s1", decided_at: at(17) * 1000, reason: "planned_work" }),
        decision({
          id: "f1",
          family: "alert_finding",
          decision_id: "alert_finding:f1",
          action: "apply",
          state: "undone",
          actor: "me@example.com",
          decided_at: at(9) * 1000,
          undone_at: at(10) * 1000,
          undone_by: "me@example.com",
          subject: undefined,
          change: { alert: { id: "a1", title: "payments-errors" }, fields: [] },
        }),
        decision({ id: "s2", action: "accept", decided_at: at(11) * 1000 }),
      ],
      "me@example.com",
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual([
      "decision:suggestion:s1",
      "incident:inc-1",
      "decision:suggestion:s2",
      "decision:alert_finding:f1",
    ]);
    expect(String(rows[0].text)).toContain("ops-lead@example.com");
    expect(String(rows[0].reason)).toContain("Planned work");
    expect(String(rows[1].text)).toContain("Payments");
    expect(String(rows[3].text)).toMatch(/^You .*payments-errors/);
    expect(rows[1].incidentId).toBe("inc-1");
    expect(rows[1].byPerson).toBe(false);
    expect(String(rows[3].undone)).toMatch(/\byou\b/);
    expect(rows[3].changeId).toBe("alert_finding:f1");
    expect(rows[0].undone).toBeNull();
  });

  it("an undo the server folded into the entry reads as the undo", () => {
    const rows = toHistoryRows(
      gt,
      ZONE,
      [],
      [decision({ action: "apply", state: "undone", undone_at: null, subject: undefined })],
      undefined,
      NOW,
    );
    expect(String(rows[0].text)).toMatch(/\bundid\b/);
    expect(rows[0].undone).toBeNull();
  });

  it("an incident nobody was paged for does not claim a page", () => {
    const rows = toHistoryRows(gt, ZONE, [incident("i", "x stopped", at(8))], [], undefined, NOW);
    expect(String(rows[0].text)).not.toMatch(/paged/);
  });

  it("groups entries by the reader's day, named as Activity names it", () => {
    const rows = toHistoryRows(
      gt,
      ZONE,
      [incident("today", "a", at(8)), incident("before", "b", at(8) - 86_400_000)],
      [],
      undefined,
      NOW,
    );
    expect(historyDays(gt, ZONE, rows, NOW).map((d) => d.rows.map((r) => r.id))).toEqual([
      ["incident:today"],
      ["incident:before"],
    ]);
  });
});
