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

import { afterEach, describe, expect, it } from "vitest";
import config from "@/aws-exports";
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveIncidentItem, AutoObserveIncidentList } from "@/services/autoobserve";
import type { Incident, RcaSummary } from "@/services/incidents";
import { rcaCellModel } from "@/utils/incidents/rcaCell";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import {
  analysisLine,
  sharedAnalysis,
  analysisLink,
  anyLive,
  failedDetail,
  findingLogs,
  findingSentence,
  incidentLink,
  newFindingsText,
  openedText,
  moreText,
  pagingNote,
  statusLabel,
} from "./incidentsCopy";
import { liveFailureOf, liveNotice, refreshFailedText, type LiveFailure } from "./liveCopy";

const FIXTURE = fixture as unknown as AutoObserveIncidentList;
const item = (i: number) => FIXTURE.items[i];

const withRun = (
  i: number,
  run: Partial<AutoObserveIncidentItem["investigation"]>,
): AutoObserveIncidentItem => ({ ...item(i), investigation: { ...item(i).investigation, ...run } });

describe("findingSentence", () => {
  it("the finding sentence uses the server title's words and never a kind", () => {
    for (const i of [0, 1, 2]) expect(findingSentence(gt, item(i))).toBe(item(i).incident.title);
    expect(findingSentence(gt, item(5))).toBe(item(5).incident.title);
    const gap = { ...item(0), finding: { ...item(0).finding, kind: "stream_gap" } };
    expect(findingSentence(gt, gap)).toBe(item(0).incident.title);
    const nameless = { ...item(0), finding: { ...item(0).finding, stream_name: null } };
    expect(findingSentence(gt, nameless)).toBe(item(0).incident.title);
    for (const it of [...FIXTURE.items, gap])
      expect(findingSentence(gt, it)).not.toContain("stream_");
  });
});

describe("analysisLine", () => {
  it("each run state reads as the incident list reads it", () => {
    expect(analysisLine(gt, item(0), true)).toMatchObject({
      label: "Investigating",
      tone: "muted",
      spinner: true,
      hasRun: true,
      detail: "",
    });
    const failed = analysisLine(gt, item(1), true);
    expect(failed).toMatchObject({ label: "Failed", tone: "err", spinner: false, hasRun: true });
    expect(failed.detail).toBe("The analysis stopped before it finished. View it for details.");
    expect(failed.detail).not.toContain("agent unreachable");
    expect(analysisLine(gt, item(2), true)).toMatchObject({
      label: "Root cause identified",
      tone: "ok",
      hasRun: true,
    });
    const blocked = withRun(0, {
      state: "waiting_input",
      summary: { ...item(0).investigation.summary!, detail: "Needs change history" },
    });
    expect(analysisLine(gt, blocked, true)).toMatchObject({
      label: "Blocked",
      tone: "warn-strong",
      detail: "Needs change history",
      hasRun: true,
    });
    expect(analysisLine(gt, withRun(1, { state: "cancelled" }), true)).toMatchObject({
      label: "Cancelled",
      tone: "err",
      detail: "",
      hasRun: true,
    });
    expect(analysisLine(gt, withRun(2, { state: "completed", outcome: null }), true)).toMatchObject(
      { label: "Analyzed", tone: "ok", hasRun: true },
    );
  });

  it("a completed blocked run names what it needs, as the list does", () => {
    const blocked = withRun(2, {
      state: "completed",
      outcome: "blocked",
      summary: { ...item(2).investigation.summary!, detail: "Needs change history" },
    });
    expect(analysisLine(gt, blocked, true)).toMatchObject({
      label: "Blocked",
      tone: "warn-strong",
      detail: "Needs change history",
      hasRun: true,
    });
    const bare = withRun(2, { state: "completed", outcome: "blocked" });
    expect(analysisLine(gt, bare, true).detail).toBe("");
    expect(analysisLine(gt, item(2), true).detail).toBe("");
  });

  it("a run that did not start says why in words", () => {
    const lines = [
      [analysisLine(gt, item(3), true), "RCA off", "No AI SRE for P2"],
      [
        analysisLine(gt, item(4), false),
        "RCA disabled",
        "AI analysis is turned off for this deployment.",
      ],
      [
        analysisLine(gt, item(4), true),
        "Not analyzed",
        "No analysis has started. Open the incident to start one.",
      ],
      [
        analysisLine(gt, withRun(4, { not_run_reason: "budget_x" }), true),
        "RCA off",
        "Automatic analysis did not run for this incident.",
      ],
    ] as const;
    for (const [line, label, detail] of lines) {
      expect(line).toMatchObject({ label, detail, hasRun: false, spinner: false, tone: "muted" });
      expect(`${line.label} ${line.detail}`).not.toMatch(/l0_off|budget_x/);
    }
  });

  it("each stored not-run reason reads in plain words", () => {
    const reasons = [
      ["rca_disabled", "Not analyzed", "muted", "AI analysis was off when this incident opened."],
      [
        "ai_unavailable",
        "Not analyzed",
        "muted",
        "AI analysis wasn't available when this incident opened.",
      ],
      [
        "quota_exceeded",
        "Not analyzed",
        "warn",
        "The organization had reached its AI analysis limit.",
      ],
      [
        "cooling_down",
        "Not analyzed",
        "muted",
        "An analysis had just run, so a new one did not start.",
      ],
      ["start_failed", "Failed", "err", "The analysis couldn't start."],
    ] as const;
    for (const [reason, label, tone, detail] of reasons) {
      for (const rcaEnabled of [true, false]) {
        const line = analysisLine(gt, withRun(4, { not_run_reason: reason }), rcaEnabled);
        expect(line).toMatchObject({ label, tone, detail, hasRun: false, spinner: false });
        expect(`${line.label} ${line.detail}`).not.toMatch(
          /rca_disabled|ai_unavailable|quota_exceeded|cooling_down|start_failed/,
        );
      }
    }
  });

  it("labels match rcaCellModel for the same run", () => {
    for (const i of [0, 2]) {
      const run = item(i).investigation;
      const rca = {
        run_id: run.run_id,
        state: run.state,
        outcome: run.outcome,
        stale: false,
        started_at: 0,
        updated_at: 0,
        confidence: null,
        summary: run.summary,
      } as unknown as RcaSummary;
      const incident: Pick<Incident, "rca" | "rca_off_reason" | "severity"> = {
        rca,
        severity: item(i).incident.severity,
      };
      expect(analysisLine(gt, item(i), true).label).toBe(
        rcaCellModel(incident, { rcaEnabled: true, now: 0 }).label,
      );
    }
    const blocked = withRun(0, { state: "waiting_input" });
    const rca = { ...blocked.investigation, stale: false, started_at: 0, updated_at: 0 };
    expect(analysisLine(gt, blocked, true).label).toBe(
      rcaCellModel(
        { rca: rca as unknown as RcaSummary, severity: "P2" },
        { rcaEnabled: true, now: 0 },
      ).label,
    );
  });
});

describe("links", () => {
  it("the links are the incident page and its Analysis tab", () => {
    expect(incidentLink("demo-org", "inc-0002")).toEqual({
      name: "incidentDetail",
      params: { id: "inc-0002" },
      query: { org_identifier: "demo-org" },
    });
    expect(analysisLink("demo-org", "inc-0002")).toEqual({
      name: "incidentDetail",
      params: { id: "inc-0002" },
      query: { org_identifier: "demo-org", tab: "incidentAnalysis" },
    });
  });
});

describe("incidents notices", () => {
  const http = (status: number) => ({ response: { status } });

  it("incidents notices follow the live severity rules", () => {
    const look = (f: LiveFailure) => liveNotice(gt, "incidents", f);
    expect(liveFailureOf(http(403))).toBe("denied");
    expect(look("denied")).toMatchObject({ severity: "error", retry: false, details: false });
    expect(look("denied").title).toBe("You don't have permission to see paged findings");
    expect(look("off")).toMatchObject({ severity: "neutral", retry: false });
    expect(look("off").title).toBe("AutoObserve isn't turned on");
    expect(look("unavailable")).toMatchObject({ severity: "error", retry: true, details: false });
    expect(look("failed")).toMatchObject({ severity: "error", retry: true, details: true });
    expect(look("failed").title).toBe("Couldn't load paged findings");
    for (const f of ["denied", "off", "unavailable", "failed"] as const) {
      expect(look(f).title).not.toMatch(/^autoobserveLive\./);
      expect(look(f).description).not.toMatch(/^autoobserveLive\./);
    }
    const stale = { failedAt: Date.UTC(2026, 10, 4, 9, 5), dataAt: Date.UTC(2026, 10, 4, 9, 4) };
    expect(refreshFailedText(gt, "en-GB", "UTC", "incidents", stale, stale.failedAt)).toBe(
      "Refresh failed at 09:05 · showing paged findings from 09:04",
    );
  });
});

describe("failedDetail", () => {
  it("a failed load's details name only the status and the time", () => {
    const at = Date.UTC(2026, 10, 4, 9, 5);
    expect(failedDetail(gt, "en-GB", "UTC", 500, at, at)).toBe(
      "The request failed with status 500 at 09:05.",
    );
    expect(failedDetail(gt, "en-GB", "UTC", undefined, at, at)).toBe(
      "The request got no response at 09:05.",
    );
    expect(failedDetail(gt, "en-GB", "UTC", "dial rca-agent.internal:9000", at, at)).toBe(
      "The request got no response at 09:05.",
    );
  });
});

describe("row text", () => {
  it("names the status, the incident's age and the counts in words", () => {
    expect(statusLabel(gt, "open")).toBe("Open");
    expect(statusLabel(gt, "acknowledged")).toBe("Acknowledged");
    expect(statusLabel(gt, "resolved")).toBe("Resolved");
    const now = item(0).incident.created_at / 1000 + 12 * 60_000;
    expect(openedText(gt, "en-US", item(0), now)).toBe("Incident opened 12 minutes ago");
    expect(pagingNote(gt)).toBe(
      "Paging is off for this organization, so AutoObserve opens no incidents.",
    );
    expect(newFindingsText(gt, "en-US", 1)).toBe("1 new finding");
    expect(newFindingsText(gt, "en-US", 3)).toBe("3 new findings");
    expect(moreText(gt, "en-US")).toBe("Showing the 3 newest");
  });

  it("polls only while a listed run is live", () => {
    expect(anyLive(FIXTURE)).toBe(true);
    expect(anyLive({ ...FIXTURE, items: FIXTURE.items.slice(1) })).toBe(false);
    expect(anyLive({ ...FIXTURE, items: [withRun(1, { state: "waiting_input" })] })).toBe(true);
    expect(anyLive(undefined)).toBe(false);
  });
});

describe("sharedAnalysis", () => {
  const off = (reason: string | null, id = "x") =>
    analysisLine(
      gt,
      {
        ...item(4),
        incident: { ...item(4).incident, id },
        investigation: {
          run_id: null,
          state: null,
          outcome: null,
          summary: null,
          not_run_reason: reason,
        },
      } as AutoObserveIncidentItem,
      true,
    );

  it("says nothing for no rows or one row", () => {
    expect(sharedAnalysis(gt, [])).toBeNull();
    expect(sharedAnalysis(gt, [off("rca_disabled")])).toBeNull();
  });

  it("states a reason shared by every row once, in the plural", () => {
    const three = ["a", "b", "c"].map((id) => off("rca_disabled", id));
    expect(String(sharedAnalysis(gt, three)?.text)).toBe(
      "AI analysis was off when these incidents opened.",
    );
    const many = Array.from({ length: 12 }, (_, i) => off("ai_unavailable", `m${i}`));
    expect(String(sharedAnalysis(gt, many)?.text)).toBe(
      "AI analysis wasn't available when these incidents opened.",
    );
  });

  it("says nothing when no two rows share a reason or a reason has no shared form", () => {
    expect(sharedAnalysis(gt, [off("rca_disabled"), off(null)])).toBeNull();
    const blocked = withRun(0, {
      state: "waiting_input",
      summary: { ...item(0).investigation.summary!, detail: "Needs change history" },
    });
    const line = analysisLine(gt, blocked, true);
    expect(sharedAnalysis(gt, [line, line])).toBeNull();
    const running = analysisLine(gt, item(0), true);
    expect(sharedAnalysis(gt, [running, running])).toBeNull();
  });

  it("on mixed states says the most common reason once, naming its state, and leaves the rest on their rows (T1-16)", () => {
    const running = analysisLine(gt, item(0), true);
    const lines = [off("rca_disabled", "a"), running, off("rca_disabled", "b"), off(null, "c")];
    lines.push(off("rca_disabled", "d"));
    const shared = sharedAnalysis(gt, lines);
    expect(String(shared?.text)).toBe(
      "Not analyzed: AI analysis was off when these incidents opened.",
    );
    expect(lines.map((l) => shared?.covers(l))).toEqual([true, false, true, false, true]);
  });
});

describe("findingLogs on a group (T1-17)", () => {
  const HOUR_US = 3_600_000_000;
  const originalBuild = config.isEnterprise;
  afterEach(() => {
    config.isEnterprise = originalBuild;
  });

  const member = (name: string | null, type: string | null, at: number) => ({
    id: `m-${name}`,
    title: `${name} stopped`,
    stream_type: type,
    stream_name: name,
    first_seen_at: at,
    recovered_at: null,
  });

  it("opens every member stream of the lead's type, from an hour before the first stop", () => {
    config.isEnterprise = "true";
    const lead = item(0);
    const at = lead.finding.first_seen_at;
    const group: AutoObserveIncidentItem = {
      ...lead,
      members: [
        member(lead.finding.stream_name, "logs", at),
        member("cart", "logs", at - 60_000_000),
        member("payments", "logs", at + 60_000_000),
        member("checkout-traces", "traces", at - 120_000_000),
        member(null, null, at - 180_000_000),
      ],
    };
    const route = findingLogs(group, 1_800_000_000_000) as { query: Record<string, string> };
    expect(route.query.stream).toBe(`${lead.finding.stream_name},cart,payments`);
    expect(route.query.from).toBe(String(at - 60_000_000 - HOUR_US));
  });

  it("a single finding still opens its one stream", () => {
    config.isEnterprise = "true";
    const route = findingLogs(item(0), 1_800_000_000_000) as { query: Record<string, string> };
    expect(route.query.stream).toBe(item(0).finding.stream_name);
    expect(route.query.from).toBe(String(item(0).finding.first_seen_at - HOUR_US));
  });
});
