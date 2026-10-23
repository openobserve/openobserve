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
import enUS from "@/locales/languages/en-US.json";
import {
  RUN_REASON_KEYS,
  bodySizeParts,
  firstFailedStep,
  hasStoredRunData,
  matchesRunSearch,
  matchesTriggerFilter,
  runReasonOf,
  shortRunId,
  triggerFilterSource,
} from "./runStatus";

const lookup = (key: string): unknown =>
  key.split(".").reduce<any>((node, part) => (node == null ? undefined : node[part]), enUS);

const facts = (over: Record<string, unknown> = {}) => ({
  credential_prefix: "o2wh_4fK9",
  caller_ip: "203.0.113.24",
  idempotency_key: "deploy-d-4821",
  content_type: "application/json",
  body_bytes: 68,
  status: "failed" as const,
  error: null,
  ...over,
});

describe("runReasonOf", () => {
  it("names expired runs from the stored status", () => {
    expect(runReasonOf({ status: "expired", error: null })).toBe("expired");
  });

  it("reads the ledger code on a failed run, not the stream text", () => {
    expect(
      runReasonOf({
        status: "failed",
        error: "some node errored",
        http_request: facts({ error: "worker_lost" }),
      }),
    ).toBe("worker_lost");
    expect(runReasonOf({ status: "failed", error: "workflow_disabled" })).toBe("workflow_disabled");
    expect(runReasonOf({ status: "failed", error: "run_timeout" })).toBe("run_timeout");
  });

  it("has no reason for an ordinary step failure or a non-failed run", () => {
    expect(runReasonOf({ status: "failed", error: "FunctionNode JS error" })).toBeNull();
    expect(runReasonOf({ status: "succeeded", error: "worker_lost" })).toBeNull();
    expect(runReasonOf(null)).toBeNull();
  });

  it("every reason line has an en-US string", () => {
    for (const key of Object.values(RUN_REASON_KEYS)) expect(typeof lookup(key)).toBe("string");
  });
});

describe("hasStoredRunData", () => {
  it("is false for runs that never executed or never finished", () => {
    for (const status of ["queued", "running", "expired"] as const)
      expect(hasStoredRunData({ status, error: null })).toBe(false);
    expect(hasStoredRunData({ status: "failed", error: "worker_lost" })).toBe(false);
    expect(hasStoredRunData({ status: "failed", error: "workflow_disabled" })).toBe(false);
  });

  it("is true for finished runs", () => {
    expect(hasStoredRunData({ status: "succeeded", error: null })).toBe(true);
    expect(hasStoredRunData({ status: "failed", error: "boom" })).toBe(true);
    expect(hasStoredRunData(undefined)).toBe(true);
  });
});

describe("trigger filter", () => {
  const http = { event_type: "Webhook" };
  const alert = { event_type: "AlertFired" };
  const retry = { event_type: "Retry" };

  it("maps a kind to the source its runs carry", () => {
    expect(triggerFilterSource("alert_fired")).toBe("alert_fired");
    expect(triggerFilterSource("incident_event")).toBe("incident_event");
    expect(triggerFilterSource("something_new")).toBeNull();
    expect(triggerFilterSource(undefined)).toBeNull();
  });

  it("HTTP request matches Webhook runs only; a retry of one stays under all triggers", () => {
    expect(matchesTriggerFilter(http, "http_request")).toBe(true);
    expect(matchesTriggerFilter(alert, "http_request")).toBe(false);
    expect(matchesTriggerFilter(retry, "http_request")).toBe(false);
    expect(matchesTriggerFilter(retry, "all")).toBe(true);
  });

  it("a kind filter matches that kind's runs", () => {
    expect(matchesTriggerFilter(alert, "alert_fired")).toBe(true);
    expect(matchesTriggerFilter({ event_type: "AlertResolved" }, "alert_fired")).toBe(true);
    expect(matchesTriggerFilter(http, "alert_fired")).toBe(false);
  });
});

describe("matchesRunSearch", () => {
  const row = { run_id: "0193f2c4-7a1e", http_request: facts() };

  it("matches a run id prefix or an idempotency key, case-insensitively", () => {
    expect(matchesRunSearch(row, "0193F2")).toBe(true);
    expect(matchesRunSearch(row, "deploy-d-48")).toBe(true);
    expect(matchesRunSearch(row, "7a1e")).toBe(false);
    expect(matchesRunSearch(row, "")).toBe(true);
    expect(matchesRunSearch({ run_id: "x" }, "deploy")).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("shortRunId keeps the first 8 characters", () => {
    expect(shortRunId("0193f2c4-7a1e-7b3d")).toBe("0193f2c4");
    expect(shortRunId("")).toBe("");
  });

  it("bodySizeParts uses bytes under 1 KiB and KiB above", () => {
    expect(bodySizeParts(68)).toEqual({ key: "workflow.http.bodySizeBytes", size: "68" });
    expect(bodySizeParts(1536)).toEqual({ key: "workflow.http.bodySizeKiB", size: "1.5" });
    expect(typeof lookup("workflow.http.bodySizeBytes")).toBe("string");
    expect(typeof lookup("workflow.http.bodySizeKiB")).toBe("string");
  });

  it("firstFailedStep follows the step order, not the error map order", () => {
    const errors = { dest: { error_count: 1 }, fn: { error_count: 1 } };
    expect(firstFailedStep(errors, ["trig", "fn", "dest"])).toBe("fn");
    expect(firstFailedStep({}, ["trig"])).toBeNull();
    expect(firstFailedStep(null, ["trig"])).toBeNull();
  });
});
