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
import { toHistoryRows } from "./historyFeed";

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

describe("toHistoryRows (G6)", () => {
  it("is empty with nothing to list", () => {
    expect(toHistoryRows(gt, ZONE, [], [], NOW)).toEqual([]);
  });

  it("merges incidents and decisions newest first, each said in one line", () => {
    const rows = toHistoryRows(
      gt,
      ZONE,
      [incident("inc-1", "pay_api (logs) stopped sending data", at(16, 45), "resolved")],
      [
        decision({ id: "s1", decided_at: at(17) * 1000 }),
        decision({
          id: "f1",
          family: "alert_finding",
          decision_id: "alert_finding:f1",
          action: "apply",
          state: "undone",
          decided_at: at(9) * 1000,
          subject: undefined,
          change: { alert: { id: "a1", title: "payments-errors" }, fields: [] },
        }),
        decision({ id: "s2", action: "accept", decided_at: at(11) * 1000 }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual([
      "decision:suggestion:s1",
      "incident:inc-1",
      "decision:suggestion:s2",
      "decision:alert_finding:f1",
    ]);
    expect(rows.map((r) => String(r.text))).toEqual([
      "ops-lead@example.com dismissed Nothing watches checkout",
      "Opened an incident: pay_api (logs) stopped sending data",
      "ops-lead@example.com marked Nothing watches checkout as an intended report",
      "ops-lead@example.com changed payments-errors",
    ]);
    expect(String(rows[1].when)).toBe("4:45 PM");
    expect(rows[1].incidentId).toBe("inc-1");
    expect(rows[1].status?.value).toBe("resolved");
    expect(rows[3].undone).toBe(true);
    expect(rows[0].undone).toBe(false);
  });

  it("names an item it can't read the title of without an id", () => {
    const rows = toHistoryRows(gt, ZONE, [], [decision({ subject: undefined })], NOW);
    expect(String(rows[0].text)).toBe("ops-lead@example.com dismissed a suggestion");
  });
});
