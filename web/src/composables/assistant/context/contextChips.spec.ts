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

import { PAGE_CONTEXTS } from "../__fixtures__/pageContexts";
import {
  CONTEXT_FIELDS,
  MAX_ATTACHED_BYTES,
  WHITELIST_FIELDS,
  byteSize,
  chipSecondaryOf,
  chipStateOf,
  contextChipFor,
  ghostChipsOf,
  pageChipsOf,
  seesRowsOf,
  shortLabelFor,
  timeChipOf,
  timeWindowOf,
  truncateChip,
  wireDataOf,
  wireTimeRange,
} from "./contextChips";
import type { ContextChip, PageContext } from "./types";

// `ai:src/server/context/o2ai_context.py:37-87`, read on 2026-10-16.
const AGENT_READS = [
  "org_id",
  "organization_identifier",
  "currentPage",
  "selectedStreams",
  "streamType",
  "timeRange",
  "currentSQLQuery",
  "currentVRLQuery",
  "dashboardId",
  "panelId",
  "alertId",
  "pipelineId",
  "request_timestamp",
  "user_timezone",
];

const window = { from: 1_000, to: 901_000, period: "15m", source: "page" as const };

function row(data: Record<string, unknown>): ContextChip {
  return {
    id: "r1",
    kind: "log_row",
    label: raw("Log row · cart · 13:57"),
    data,
    sizeBytes: byteSize(data),
    provenance: "door",
    sent: "serialized",
  };
}

describe("the context table", () => {
  it("marks exactly the agent whitelist as sent, everything else not read", () => {
    expect([...WHITELIST_FIELDS].sort()).toEqual([...AGENT_READS].sort());
    for (const tableRow of CONTEXT_FIELDS) {
      const read = tableRow.fields.every((field) => AGENT_READS.includes(field));
      expect([tableRow.fields.join(","), tableRow.sent]).toEqual([
        tableRow.fields.join(","),
        read ? "whitelist" : "not_read",
      ]);
    }
  });

  it("covers every whitelist field with a row", () => {
    const covered = CONTEXT_FIELDS.flatMap((tableRow) => tableRow.fields);
    for (const field of AGENT_READS) expect(covered).toContain(field);
  });

  it("makes no tray chip for org, page or timezone, and no chip from an empty value", () => {
    expect(contextChipFor("organization_identifier", "acme")).toBeNull();
    expect(contextChipFor("currentPage", "logs")).toBeNull();
    expect(contextChipFor("currentSQLQuery", "")).toBeNull();
    expect(contextChipFor("selectedStreams", [])).toBeNull();
  });
});

describe("page chips", () => {
  it("labels by what differs, first, and never by a JSON prefix (CT-01 AC 1)", () => {
    const chips = pageChipsOf(PAGE_CONTEXTS.logs);
    expect(chips.map((chip) => chip.label)).toEqual(["Stream · default", "SQL · default"]);
    expect(chips[0]).toMatchObject({ kind: "stream", secondary: "logs", sent: "whitelist" });
    expect(chips.some((chip) => /[{[]/.test(chip.label))).toBe(false);
  });

  it("shows the trace query as not read yet, with an honest secondary (CT-01 AC 6)", () => {
    const query = pageChipsOf(PAGE_CONTEXTS.traces).find((chip) => chip.kind === "query")!;
    expect(query).toMatchObject({ label: "Trace query", sent: "not_read" });
    expect(chipStateOf(query)).toBe("not_read");
    expect(chipSecondaryOf(query)).toBe("not read yet");
  });

  it("names the alert and the pipeline, and the incident as not read", () => {
    expect(pageChipsOf(PAGE_CONTEXTS.alerts).map((c) => c.label)).toContain(
      "Alert · checkout-latency",
    );
    expect(pageChipsOf(PAGE_CONTEXTS.pipelines).map((c) => c.label)).toContain(
      "Pipeline · ingest-k8s",
    );
    const incident = pageChipsOf(PAGE_CONTEXTS.incidents)[0];
    expect(incident).toMatchObject({ label: "Incident · Checkout 5xx", sent: "not_read" });
  });

  it("drops a removed field and offers it back as a ghost (CT-01 AC 7)", () => {
    const chips = pageChipsOf(PAGE_CONTEXTS.logs, ["selectedStreams"]);
    expect(chips.map((chip) => chip.kind)).toEqual(["query"]);
    const ghosts = ghostChipsOf(PAGE_CONTEXTS.logs, ["selectedStreams"]);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ id: "ghost:selectedStreams", label: "Stream · default" });
    expect(chipStateOf(ghosts[0], { ghost: true })).toBe("ghost");
  });
});

describe("phone short labels (F12)", () => {
  const shortOf = (page: keyof typeof PAGE_CONTEXTS | PageContext) =>
    pageChipsOf(typeof page === "string" ? PAGE_CONTEXTS[page] : page).map((chip) => [
      chip.kind,
      chip.short ?? null,
    ]);

  it("shows the name alone for every named kind, and nothing for kinds without one", () => {
    expect(shortOf("logs")).toEqual([
      ["stream", "default"],
      ["query", "default"],
    ]);
    expect(shortOf("traces")).toEqual([
      ["stream", "default"],
      ["query", null],
    ]);
    expect(shortOf("alerts")).toContainEqual(["alert", "checkout-latency"]);
    expect(shortOf("pipelines")).toContainEqual(["pipeline_node", "ingest-k8s"]);
    expect(shortOf("incidents")).toContainEqual(["incident", "Checkout 5xx"]);
    expect(
      shortOf({
        currentPage: "Dashboards",
        dashboardId: "7231",
        dashboardName: "Checkout",
        panelId: "p9",
        panelName: "Latency p99",
        organization_identifier: "acme-prod",
      }),
    ).toEqual([["panel", "Latency p99"]]);
  });

  it("never shows an id or a field value, and always text inside the label", () => {
    expect(shortOf("dashboards")).toEqual([["panel", null]]);
    const forbidden = [
      'SELECT * FROM "default"',
      "service_name='cart'",
      "7231",
      "a-17",
      "p-4",
      "INC-142",
    ];
    for (const page of Object.values(PAGE_CONTEXTS))
      for (const chip of pageChipsOf(page)) {
        if (!chip.short) continue;
        expect(forbidden).not.toContain(chip.short);
        expect(chip.label).toContain(chip.short);
      }
  });

  it("gives the short form only to kinds whose label is Kind · name", () => {
    expect(shortLabelFor("stream", "default")).toBe("default");
    for (const kind of ["time", "log_row", "cell", "image", "report"] as const)
      expect(shortLabelFor(kind, "x")).toBeUndefined();
    expect(shortLabelFor("alert", null)).toBeUndefined();
  });
});

describe("the time chip", () => {
  it("reads the page's relative range as last 15 min with secondary page (CT-01 AC 1)", () => {
    const window = timeWindowOf(PAGE_CONTEXTS.logs, null);
    expect(window).toMatchObject({ period: "15m", source: "page" });
    const chip = timeChipOf(window, "acme-prod");
    expect(chip).toMatchObject({ id: "page:timeRange", kind: "time", label: "Time · last 15 min" });
    expect(chip.secondary).toBe("page");
  });

  it("falls back to the default 15 min on a page without a picker (CT-01 AC 2)", () => {
    const window = timeWindowOf(PAGE_CONTEXTS.default, null, 10_000_000);
    expect(window).toEqual({
      from: 10_000_000 - 900_000,
      to: 10_000_000,
      period: "15m",
      source: "default",
    });
    expect(timeChipOf(window, "acme-prod").label).toBe("Time · last 15 min · default");
  });

  it("shows an absolute range with minute precision, never 15m (CT-01 AC 3)", () => {
    const from = Date.UTC(2026, 9, 16, 8, 13);
    const page = {
      currentPage: "logs",
      timeRange: { type: "absolute", startTime: from * 1000, endTime: (from + 900_000) * 1000 },
    };
    const label = timeChipOf(timeWindowOf(page, null), "acme-prod").label;
    expect(label).toMatch(/^Time · \d\d:\d\d–\d\d:\d\d /);
    expect(label).not.toContain("15m");
  });

  it("is custom once the user picks a window, and the page picker is not involved (CT-01 AC 4)", () => {
    const window = timeWindowOf(PAGE_CONTEXTS.logs, { from: 0, to: 1, period: "1h" }, 3_600_000);
    const chip = timeChipOf(window, "acme-prod");
    expect(chip).toMatchObject({ label: "Time · last 1 h", secondary: "custom" });
    expect(chipStateOf(chip)).toBe("custom");
    expect(wireTimeRange(window)).toEqual({
      type: "relative",
      relativeTimePeriod: "1h",
      startTime: 0,
      endTime: 3_600_000_000,
    });
  });
});

describe("what the assistant sees", () => {
  it("lists Logs' sent rows and its not-read rows (CT-04 AC 1)", () => {
    const rows = seesRowsOf(PAGE_CONTEXTS.logs, { window, timezone: "Asia/Kolkata" });
    const sent = rows.filter((r) => r.group === "sent").map((r) => [r.label, r.value]);
    expect(sent).toEqual([
      ["Organization", "acme-prod"],
      ["Page", "logs"],
      ["Time range", "last 15 min"],
      ["Streams", "default (logs)"],
      ["SQL", "1 line"],
      ["Current time", "When you send"],
      ["Timezone", "Asia/Kolkata"],
    ]);
    const notRead = rows.filter((r) => r.group === "not_read").map((r) => r.label);
    expect(notRead).toEqual(expect.arrayContaining(["Quick mode", "Interesting fields"]));
  });

  it("puts the trace query under not read (CT-04 AC 2)", () => {
    const rows = seesRowsOf(PAGE_CONTEXTS.traces, { window, timezone: "UTC" });
    expect(rows.find((r) => r.label === "Trace query")?.group).toBe("not_read");
  });

  it("lists no routing internals and never agent_type", () => {
    const labels = seesRowsOf(PAGE_CONTEXTS.default, { window, timezone: "UTC" }).map((r) => r.id);
    expect(labels).not.toContain("routeParams");
    const incident = seesRowsOf(PAGE_CONTEXTS.incidents, { window, timezone: "UTC" }).map(
      (r) => r.id,
    );
    expect(incident).not.toContain("agent_type");
  });
});

describe("caps", () => {
  it("cuts a 40 KB row to 32 KB, longest values first, and names the cut fields (CT-02 AC 8)", () => {
    const chip = row({ message: "x".repeat(40 * 1024), level: "error", _o2_id: "7" });
    const cut = truncateChip(chip);
    expect(cut.sizeBytes).toBeLessThanOrEqual(MAX_ATTACHED_BYTES);
    expect(cut.truncated).toEqual(["message"]);
    expect((cut.data as Record<string, string>).level).toBe("error");
    expect(chipStateOf(cut)).toBe("truncated");
    expect(chipSecondaryOf(cut)).toBe("truncated to 32 KB");
  });

  it("leaves a row under the cap untouched", () => {
    const chip = row({ message: "short" });
    expect(truncateChip(chip)).toBe(chip);
  });

  it("drops internal fields from the wire unless the trim is off (CT-03 AC 2)", () => {
    const chip = row({ message: "m", _o2_id: "7", _original: "{}" });
    expect(wireDataOf(chip)).toEqual({ message: "m" });
    expect(wireDataOf({ ...chip, includeInternal: true })).toEqual({
      message: "m",
      _o2_id: "7",
      _original: "{}",
    });
  });
});
