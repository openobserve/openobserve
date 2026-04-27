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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveLogsStream,
  restoreLogsStream,
  saveTracesStream,
  restoreTracesStream,
  saveMetricsStream,
  restoreMetricsStream,
} from "./streamPersist";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOGS_KEY = (org: string) => `oo_selected_stream_logs_${org}`;
const TRACES_KEY = (org: string) => `oo_selected_stream_traces_${org}`;
const METRICS_KEY = (org: string) => `oo_selected_stream_metrics_${org}`;

// ---------------------------------------------------------------------------
// saveLogsStream / restoreLogsStream
// ---------------------------------------------------------------------------

describe("saveLogsStream / restoreLogsStream", () => {
  it("should save and restore a single stream", () => {
    saveLogsStream("org1", ["stream-a"]);
    expect(restoreLogsStream("org1")).toEqual(["stream-a"]);
  });

  it("should save and restore multiple streams", () => {
    saveLogsStream("org1", ["stream-a", "stream-b", "stream-c"]);
    expect(restoreLogsStream("org1")).toEqual([
      "stream-a",
      "stream-b",
      "stream-c",
    ]);
  });

  it("should return an empty array when nothing has been saved", () => {
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should NOT save when orgId is an empty string", () => {
    saveLogsStream("", ["stream-a"]);
    expect(localStorage.getItem(LOGS_KEY(""))).toBeNull();
  });

  it("should NOT save when the streams array is empty", () => {
    saveLogsStream("org1", []);
    expect(localStorage.getItem(LOGS_KEY("org1"))).toBeNull();
  });

  it("should return an empty array when stored value is invalid JSON", () => {
    localStorage.setItem(LOGS_KEY("org1"), "not-valid-json{{");
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should return an empty array when stored value is a JSON object (not array)", () => {
    localStorage.setItem(LOGS_KEY("org1"), JSON.stringify({ a: 1 }));
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should return an empty array when stored value is a JSON string (not array)", () => {
    localStorage.setItem(LOGS_KEY("org1"), JSON.stringify("stream-a"));
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should return an empty array when stored value is a JSON number", () => {
    localStorage.setItem(LOGS_KEY("org1"), JSON.stringify(42));
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should return an empty array when stored value is null (literal)", () => {
    localStorage.setItem(LOGS_KEY("org1"), "null");
    expect(restoreLogsStream("org1")).toEqual([]);
  });

  it("should scope storage per orgId — different orgs do not interfere", () => {
    saveLogsStream("org1", ["stream-alpha"]);
    saveLogsStream("org2", ["stream-beta"]);
    expect(restoreLogsStream("org1")).toEqual(["stream-alpha"]);
    expect(restoreLogsStream("org2")).toEqual(["stream-beta"]);
  });

  it("should overwrite previously saved streams for the same org", () => {
    saveLogsStream("org1", ["stream-a"]);
    saveLogsStream("org1", ["stream-b", "stream-c"]);
    expect(restoreLogsStream("org1")).toEqual(["stream-b", "stream-c"]);
  });

  it("should not read another org's key when the target org has no entry", () => {
    saveLogsStream("org1", ["stream-a"]);
    expect(restoreLogsStream("org2")).toEqual([]);
  });

  it("should preserve stream names that contain special characters", () => {
    const special = ["my-stream_v2", "ns/logs", "org:team:prod"];
    saveLogsStream("org1", special);
    expect(restoreLogsStream("org1")).toEqual(special);
  });
});

// ---------------------------------------------------------------------------
// saveTracesStream / restoreTracesStream
// ---------------------------------------------------------------------------

describe("saveTracesStream / restoreTracesStream", () => {
  it("should save and restore a stream name", () => {
    saveTracesStream("org1", "default");
    expect(restoreTracesStream("org1")).toBe("default");
  });

  it("should return an empty string when nothing has been saved", () => {
    expect(restoreTracesStream("org1")).toBe("");
  });

  it("should NOT save when orgId is empty", () => {
    saveTracesStream("", "default");
    expect(localStorage.getItem(TRACES_KEY(""))).toBeNull();
  });

  it("should NOT save when stream name is empty", () => {
    saveTracesStream("org1", "");
    expect(localStorage.getItem(TRACES_KEY("org1"))).toBeNull();
  });

  it("should scope storage per orgId — different orgs do not interfere", () => {
    saveTracesStream("org1", "stream-a");
    saveTracesStream("org2", "stream-b");
    expect(restoreTracesStream("org1")).toBe("stream-a");
    expect(restoreTracesStream("org2")).toBe("stream-b");
  });

  it("should overwrite a previously saved stream for the same org", () => {
    saveTracesStream("org1", "stream-a");
    saveTracesStream("org1", "stream-b");
    expect(restoreTracesStream("org1")).toBe("stream-b");
  });

  it("should not read another org's key when the target org has no entry", () => {
    saveTracesStream("org1", "stream-a");
    expect(restoreTracesStream("org2")).toBe("");
  });

  it("should preserve stream names with special characters", () => {
    saveTracesStream("org1", "my-traces_v2/prod");
    expect(restoreTracesStream("org1")).toBe("my-traces_v2/prod");
  });
});

// ---------------------------------------------------------------------------
// saveMetricsStream / restoreMetricsStream
// ---------------------------------------------------------------------------

describe("saveMetricsStream / restoreMetricsStream", () => {
  it("should save and restore a metric stream name", () => {
    saveMetricsStream("org1", "my-metric");
    expect(restoreMetricsStream("org1")).toBe("my-metric");
  });

  it("should return an empty string when nothing has been saved", () => {
    expect(restoreMetricsStream("org1")).toBe("");
  });

  it("should NOT save when orgId is empty", () => {
    saveMetricsStream("", "my-metric");
    expect(localStorage.getItem(METRICS_KEY(""))).toBeNull();
  });

  it("should NOT save when stream name is empty", () => {
    saveMetricsStream("org1", "");
    expect(localStorage.getItem(METRICS_KEY("org1"))).toBeNull();
  });

  it("should scope storage per orgId — different orgs do not interfere", () => {
    saveMetricsStream("org1", "metric-a");
    saveMetricsStream("org2", "metric-b");
    expect(restoreMetricsStream("org1")).toBe("metric-a");
    expect(restoreMetricsStream("org2")).toBe("metric-b");
  });

  it("should overwrite a previously saved stream for the same org", () => {
    saveMetricsStream("org1", "metric-a");
    saveMetricsStream("org1", "metric-b");
    expect(restoreMetricsStream("org1")).toBe("metric-b");
  });

  it("should not read another org's key when the target org has no entry", () => {
    saveMetricsStream("org1", "metric-a");
    expect(restoreMetricsStream("org2")).toBe("");
  });

  it("should preserve metric stream names with special characters", () => {
    saveMetricsStream("org1", "http_requests_total{env=prod}");
    expect(restoreMetricsStream("org1")).toBe(
      "http_requests_total{env=prod}",
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-domain isolation: logs / traces / metrics keys must not collide
// ---------------------------------------------------------------------------

describe("cross-domain key isolation", () => {
  it("should use distinct localStorage keys for logs, traces, and metrics on the same org", () => {
    saveLogsStream("org1", ["logs-stream"]);
    saveTracesStream("org1", "traces-stream");
    saveMetricsStream("org1", "metrics-stream");

    expect(restoreLogsStream("org1")).toEqual(["logs-stream"]);
    expect(restoreTracesStream("org1")).toBe("traces-stream");
    expect(restoreMetricsStream("org1")).toBe("metrics-stream");

    // Verify no cross-contamination
    expect(localStorage.getItem(LOGS_KEY("org1"))).not.toBeNull();
    expect(localStorage.getItem(TRACES_KEY("org1"))).not.toBeNull();
    expect(localStorage.getItem(METRICS_KEY("org1"))).not.toBeNull();
    expect(localStorage.getItem(LOGS_KEY("org1"))).not.toBe(
      localStorage.getItem(TRACES_KEY("org1")),
    );
  });

  it("clearing one domain's key should not affect other domains", () => {
    saveLogsStream("org1", ["logs-stream"]);
    saveTracesStream("org1", "traces-stream");
    saveMetricsStream("org1", "metrics-stream");

    localStorage.removeItem(LOGS_KEY("org1"));

    expect(restoreLogsStream("org1")).toEqual([]);
    expect(restoreTracesStream("org1")).toBe("traces-stream");
    expect(restoreMetricsStream("org1")).toBe("metrics-stream");
  });
});
