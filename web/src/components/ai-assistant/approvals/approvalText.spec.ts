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

import { approvalOf } from "@/composables/assistant/reducer";
import { raw, type TranslateFn } from "@/types/i18n";

import { approvalDiffRows, pauseUntil, readableCard } from "./approvalText";

const WORDS: Record<string, string> = { "common.yes": "Yes", "common.no": "No" };
const t = ((key: string, params?: { count?: number }) =>
  raw(
    key === "assistant.approval.minutes" ? `${params?.count} minutes` : (WORDS[key] ?? key),
  )) as unknown as TranslateFn;

describe("readableCard", () => {
  it("keeps a real name that equals the object's own id", () => {
    const card = {
      tool: "DeleteStream",
      targets: [{ type: "stream", id: "app_logs", name: "app_logs" }],
      args: { stream_name: "app_logs", stream_id: "app_logs" },
    };
    expect(readableCard(card)).toBe(card);
  });

  it("renames a target named after the tool or another object's id", () => {
    const create = readableCard({
      tool: "CreateDashboard",
      targets: [{ type: "dashboard", name: "CreateDashboard" }],
      args: { request_body: { title: "QA" } },
    });
    const panel = readableCard({
      tool: "AddPanel",
      targets: [{ type: "panel", id: "d1", name: "d1" }],
      args: { dashboard_id: "d1", request_body: { panel: { title: "Errors" } } },
    });
    expect(create.targets[0]).toEqual({ type: "dashboard", name: "QA" });
    expect(panel.targets[0]).toEqual({ type: "panel", name: "Errors" });
  });
});

describe("approvalDiffRows", () => {
  it("reads a nested alert change as one labelled row per changed setting, never as a JSON block", () => {
    const trigger = {
      period: 5,
      operator: ">=",
      threshold: 1,
      frequency: 1,
      frequency_type: "minutes",
      silence: 0,
    };
    const card = approvalOf({
      type: "confirmation_required",
      tool: "UpdateAlert",
      kind: "update",
      targets: [{ type: "alert", id: "a1", name: "checkout" }],
      before: { trigger_condition: trigger, description: "old" },
      after: { trigger_condition: { ...trigger, period: 10, threshold: 3 }, description: "old" },
    });
    const rows = approvalDiffRows(t, card).map((row) => [
      String(row.field),
      String(row.before),
      String(row.value),
    ]);
    expect(rows).toEqual([
      ["Period", "5", "10"],
      ["Threshold", "1", "3"],
    ]);
  });

  it("marks an update's old side unknown when the card's before is empty or lacks a field", () => {
    const update = (before: Record<string, unknown>) =>
      approvalOf({
        type: "confirmation_required",
        tool: "UpdateDashboard",
        kind: "update",
        targets: [{ type: "dashboard", id: "d1", name: "Ops" }],
        before,
        after: { title: "Ops v2", description: "" },
      });
    const sides = (before: Record<string, unknown>) =>
      approvalDiffRows(t, update(before)).map((row) => [String(row.field), String(row.before)]);
    expect(sides({})).toEqual([
      ["Title", "assistant.approval.currentUnknown"],
      ["Description", "assistant.approval.currentUnknown"],
    ]);
    expect(sides({ title: "Ops" })).toEqual([
      ["Title", "Ops"],
      ["Description", "assistant.approval.currentUnknown"],
    ]);
    const rows = approvalDiffRows(t, update({ title: "Ops" }));
    expect(rows.map((row) => !!row.beforeUnknown)).toEqual([false, true]);
  });

  it("leaves a pause card's duration to its Until line and words its flags", () => {
    const card = approvalOf({
      type: "confirmation_required",
      tool: "MuteAlert",
      kind: "update",
      targets: [{ type: "alert", id: "a1", name: "checkout" }],
      args: { alert_id: "a1", minutes: 30, all_groups: true, until_clear: false },
    });
    const rows = approvalDiffRows(t, card).map((row) => `${row.field}=${row.value}`);
    expect(rows).toEqual(["All groups=Yes", "Until clear=No"]);
  });

  it("N3: reads a bulk mute's times, duration and targets in words, never as raw numbers or JSON", () => {
    // The body o2-ai sends for CreateDowntime: µs start, seconds duration, alert ids.
    const body = {
      name: "Bulk mute",
      starts_at: 1794226306391000,
      duration_secs: 1200,
      targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["3LrpA", "3LrpB"] }],
    };
    const card = approvalOf({
      type: "confirmation_required",
      tool: "CreateDowntime",
      kind: "create",
      targets: [
        { type: "alert", id: "3LrpA", name: "latency_high" },
        { type: "alert", id: "3LrpB", name: "update_target" },
      ],
      after: body,
      args: { request_body: body },
    });
    const rows = Object.fromEntries(
      approvalDiffRows(t, card).map((row) => [String(row.field), String(row.value)]),
    );
    expect(rows["Duration"]).toBe("20 minutes");
    expect(rows["Targets"]).toBe("latency_high, update_target");
    // A start older than today carries its weekday or date before the clock time.
    expect(rows["Starts at"]).toMatch(/\b\d{1,2}:\d{2}$/);
    expect(Object.values(rows).join(" ")).not.toMatch(/1794226306391000|\{|\[/);
  });
});

describe("approvalDiffRows: a dashboard create", () => {
  const body = {
    title: "polish-approval-check",
    description: "Error log count in app_logs",
    tabs: [
      {
        tabId: "tab-1",
        name: "Overview",
        panels: [
          {
            id: "Panel_0",
            type: "line",
            title: "Error Log Count (app_logs)",
            queries: [{ query: "SELECT count(*) FROM app_logs", customQuery: true }],
            layout: { x: 0, y: 0, w: 192, h: 15, i: 0 },
          },
          { id: "Panel_1", type: "table", title: "Top services", queries: [] },
        ],
      },
    ],
  };
  const card = approvalOf({
    type: "confirmation_required",
    tool: "CreateDashboard",
    kind: "create",
    targets: [{ type: "dashboard", name: "CreateDashboard" }],
    after: body,
    args: { request_body: body },
  });

  it("names its tabs and panels as rows and keeps each panel query readable, never as one JSON block", () => {
    const rows = approvalDiffRows(t, card).map((row) => [String(row.field), String(row.value)]);
    expect(rows).toEqual([
      ["Title", "polish-approval-check"],
      ["Description", "Error log count in app_logs"],
      ["Tabs", "Overview"],
      ["Panels", "Error Log Count (app_logs) · line, Top services · table"],
      ["Query", "Error Log Count (app_logs): SELECT count(*) FROM app_logs"],
    ]);
  });

  it("words a deep setting with no name as its own fields, never as JSON", () => {
    const deep = approvalOf({
      type: "confirmation_required",
      tool: "UpdateAlert",
      kind: "create",
      targets: [{ type: "alert", name: "x" }],
      after: { a: { b: { c: { limit: 5, unit: "minutes" } } }, items: [{ x: 1 }, { x: 2 }] },
    });
    const values = approvalDiffRows(t, deep).map((row) => String(row.value));
    expect(values).toEqual(["limit: 5, unit: minutes", "x: 1; x: 2"]);
  });
});

describe("B-approvals-rca-P3-1: a gathered pause card", () => {
  // o2-ai's gathered card (handoff-FX-BE pass 2 §1): the shared `after`, no card-level `before`.
  const GATHERED = approvalOf({
    type: "confirmation_required",
    id: "apr_1",
    tool: "MuteAlert",
    kind: "update",
    operation: "MuteAlert",
    targets: [
      { type: "alert", id: "a1", name: "lat", after: { minutes: 30, all_groups: true } },
      { type: "alert", id: "a2", name: "5xx", after: { minutes: 30, all_groups: true } },
    ],
    after: { minutes: 30, all_groups: true, until_clear: false, reason: "Paused for deploy" },
    args: {
      calls: [
        { alert_id: "a1", minutes: 30 },
        { alert_id: "a2", minutes: 30 },
      ],
    },
  });

  it("draws its rows with no old side, never 'Current value unknown'", () => {
    const rows = approvalDiffRows(t, GATHERED);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.before).toBeNull();
    expect(rows.map((row) => String(row.field))).not.toContain("Minutes");
  });

  it("reads its Until from the shared change or its first call", () => {
    expect(pauseUntil(GATHERED, 1_000)).toBe(1_000 + 30 * 60_000);
    expect(pauseUntil({ ...GATHERED, after: undefined }, 1_000)).toBe(1_000 + 30 * 60_000);
    expect(pauseUntil({ args: {}, after: undefined }, 1_000)).toBeNull();
  });
});
