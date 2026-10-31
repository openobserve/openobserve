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
import type { LogsSignature, RunReason } from "@/composables/useLogs/useAutoRun";
import type { QueryHistoryEntry } from "@/services/query_history";
import { b64DecodeUnicode } from "@/utils/formatters";
import {
  buildLogsRecord,
  isRecordedLogsRun,
  isUntouchedLogsQuery,
  LOGS_REAPPLY_TYPE,
  logsRouteQuery,
  logsRunResult,
  logsReapplyRequest,
  requestLogsReapply,
} from "./logs";

const signature = (overrides: Partial<LogsSignature> = {}): LogsSignature => ({
  query: "level = 'error'",
  sqlMode: false,
  streams: ["k8s_logs"],
  streamType: "logs",
  time: { type: "relative", period: "15m" },
  transform: null,
  quickMode: true,
  quickModeFields: [],
  regions: [],
  clusters: [],
  effectiveSortOrder: "desc",
  definedSchemas: "user_defined_schema",
  ...overrides,
});

describe("which Logs runs record", () => {
  it.each<RunReason>([
    "run",
    "explicit",
    "run-anyway",
    "filter",
    "stream",
    "function",
    "time",
    "time-typed",
    "zoom",
    "narrow",
    "saved-view",
  ])("records a %s run", (reason) => {
    expect(isRecordedLogsRun([reason])).toBe(true);
  });

  it.each<RunReason>([
    "refresh",
    "pagination",
    "page-size",
    "sort",
    "histogram",
    "tab",
    "patterns",
    "landing",
    "url",
    "activation",
    "visualize-restore",
  ])("never records a %s run", (reason) => {
    expect(isRecordedLogsRun([reason])).toBe(false);
  });

  it("records a refresh tick coalesced with a filter click", () => {
    expect(isRecordedLogsRun(["refresh", "filter"])).toBe(true);
  });

  it("skips the untouched SQL template on a stream or time change, but not on Run", () => {
    const template = { query: 'SELECT * FROM "k8s_logs"', sqlMode: true };
    expect(isRecordedLogsRun(["stream"], template)).toBe(false);
    expect(isRecordedLogsRun(["time", "filter"], template)).toBe(false);
    expect(isRecordedLogsRun(["run"], template)).toBe(true);
    expect(isRecordedLogsRun(["stream", "explicit"], template)).toBe(true);
    expect(isRecordedLogsRun(["refresh"], template)).toBe(false);
    const edited = { query: 'SELECT * FROM "k8s_logs" WHERE a = 1', sqlMode: true };
    expect(isRecordedLogsRun(["stream"], edited)).toBe(true);
  });

  it("maps a settled run: failure, cancel, partial", () => {
    expect(logsRunResult({ partial: false, error: null })).toEqual({ status: "ok" });
    expect(logsRunResult({ partial: true, error: null })).toEqual({ status: "ok", warning: "" });
    expect(logsRunResult({ partial: false, error: { code: 20009 } })).toBeNull();
    expect(logsRunResult({ partial: false, error: { code: 20001, message: "bad" } })).toEqual({
      status: "error",
      error: "bad",
    });
  });
});

describe("the Logs record", () => {
  it("keys the run by streams, mode, query and VRL, and keeps the page state", () => {
    const body = buildLogsRecord({
      signature: signature({ transform: ".a = 1" }),
      startUs: 100,
      endUs: 200,
      columns: ["msg", "level"],
      result: { status: "ok" },
    });
    expect(body).toMatchObject({
      source: "logs",
      query: "level = 'error'",
      query_key: '[["k8s_logs"],"logs","filter","level = \'error\'",".a = 1"]',
      streams: ["k8s_logs"],
      status: "ok",
      context: {
        time: { type: "relative", period: "15m", start_time: 100, end_time: 200 },
        page: {
          stream_type: "logs",
          stream: "k8s_logs",
          sql_mode: "false",
          fn_editor: "true",
        },
      },
    });
    expect(b64DecodeUnicode(body!.context.page!.functionContent)).toBe(".a = 1");
    expect(body!.context.page!.columns).toBeTruthy();
  });

  it("stores the error of a failed run and keeps no columns in SQL mode", () => {
    const body = buildLogsRecord({
      signature: signature({ sqlMode: true, query: 'SELECT * FROM "x" WHERE' }),
      startUs: 1,
      endUs: 2,
      columns: ["msg"],
      result: { status: "error", error: "syntax error" },
    });
    expect(body?.status).toBe("error");
    expect(body?.context.error).toBe("syntax error");
    expect(body?.context.page?.columns).toBeUndefined();
  });

  it("records nothing for an empty query", () => {
    const body = buildLogsRecord({
      signature: signature({ query: "  " }),
      startUs: 1,
      endUs: 2,
      columns: [],
      result: { status: "ok" },
    });
    expect(body).toBeNull();
  });
});

describe("restoring a Logs row", () => {
  const entry: QueryHistoryEntry = {
    id: "e",
    source: "logs",
    query: "level = 'error'",
    query_key: "k",
    streams: ["k8s_logs"],
    context: {
      page: { stream: "k8s_logs", stream_type: "logs", sql_mode: "false" },
      time: { type: "relative", period: "1h", start_time: 1000, end_time: 2000 },
    },
    status: "ok",
    starred: false,
    run_count: 1,
    created_at: 1,
    updated_at: 2,
  };

  it("re-runs now over the relative period", () => {
    const query = logsRouteQuery(entry, "now", "org1", true);
    expect(query).toMatchObject({
      stream: "k8s_logs",
      org_identifier: "org1",
      period: "1h",
      type: LOGS_REAPPLY_TYPE,
    });
    expect(query.from).toBeUndefined();
    expect(b64DecodeUnicode(query.query)).toBe("level = 'error'");
  });

  it("re-runs at original time over the absolute window, and a link carries no re-apply type", () => {
    const query = logsRouteQuery(entry, "original", "org1", false);
    expect(query).toMatchObject({ from: "1000", to: "2000" });
    expect(query.period).toBeUndefined();
    expect(query.type).toBeUndefined();
  });

  it("makes every restore a new request that carries its own run flag", () => {
    const before = logsReapplyRequest.value.seq;
    requestLogsReapply(true);
    expect(logsReapplyRequest.value).toEqual({ seq: before + 1, run: true });
    requestLogsReapply(false);
    expect(logsReapplyRequest.value).toEqual({ seq: before + 2, run: false });
  });

  it("treats an empty editor and the untouched SQL template as empty", () => {
    expect(isUntouchedLogsQuery("", false)).toBe(true);
    expect(isUntouchedLogsQuery('SELECT * FROM "k8s_logs"', true)).toBe(true);
    expect(isUntouchedLogsQuery('SELECT * FROM "k8s_logs" WHERE a = 1', true)).toBe(false);
    expect(isUntouchedLogsQuery("level = 'error'", false)).toBe(false);
  });
});
