// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { containersOf, filterLines, lineLevel, logsSql, parseLogHits } from "./k8sPodLogs";

const hits = [
  {
    _timestamp: 3000,
    body: "listening on :8080",
    k8s_container_name: "app",
    k8s_container_restart_count: 1,
  },
  { _timestamp: 1000, log: "starting", container_name: "app", k8s_container_restart_count: 0 },
  {
    _timestamp: 2000,
    message: "ERROR boom",
    k8s_container_name: "sidecar",
    k8s_container_restart_count: 1,
  },
];

describe("logsSql", () => {
  it("selects newest first from the quoted stream", () => {
    expect(logsSql("default", "a='b'")).toBe(
      `SELECT * FROM "default" WHERE a='b' ORDER BY _timestamp DESC`,
    );
  });
});

describe("parseLogHits", () => {
  const lines = parseLogHits(hits);

  it("orders oldest first", () => {
    expect(lines.map((l) => l.ts)).toEqual([1000, 2000, 3000]);
  });

  it("reads the text and container from whichever field the collector used", () => {
    expect(lines.map((l) => l.text)).toEqual(["starting", "ERROR boom", "listening on :8080"]);
    expect(lines.map((l) => l.container)).toEqual(["app", "sidecar", "app"]);
  });

  it("stringifies a structured body", () => {
    expect(parseLogHits([{ _timestamp: 1, body: { a: 1 } }])[0].text).toBe('{"a":1}');
  });
});

describe("filterLines", () => {
  const lines = parseLogHits(hits);
  const base = { query: "", container: null, previous: false };

  it("shows the current instance by default", () => {
    expect(filterLines(lines, base).map((l) => l.ts)).toEqual([2000, 3000]);
  });

  it("shows the instance before the latest restart as previous", () => {
    expect(filterLines(lines, { ...base, previous: true }).map((l) => l.ts)).toEqual([1000]);
  });

  it("tracks restarts per container, so a sidecar that never restarted stays current", () => {
    const multi = parseLogHits([
      { _timestamp: 1, body: "app old", k8s_container_name: "app", k8s_container_restart_count: 0 },
      {
        _timestamp: 2,
        body: "side",
        k8s_container_name: "sidecar",
        k8s_container_restart_count: 0,
      },
      { _timestamp: 3, body: "app new", k8s_container_name: "app", k8s_container_restart_count: 2 },
    ]);
    expect(filterLines(multi, base).map((l) => l.text)).toEqual(["side", "app new"]);
    expect(filterLines(multi, { ...base, previous: true }).map((l) => l.text)).toEqual(["app old"]);
  });

  it("filters by container and by case-insensitive text", () => {
    expect(filterLines(lines, { ...base, container: "sidecar" })).toHaveLength(1);
    expect(filterLines(lines, { ...base, query: "LISTEN" })).toHaveLength(1);
  });
});

describe("containersOf", () => {
  it("lists distinct containers sorted", () => {
    expect(containersOf(parseLogHits(hits))).toEqual(["app", "sidecar"]);
  });
});

describe("lineLevel", () => {
  it("flags errors and warnings", () => {
    expect(lineLevel("level=error msg=x")).toBe("error");
    expect(lineLevel("WARN slow")).toBe("warning");
    expect(lineLevel("all good")).toBeNull();
  });

  it.each([
    "msg=done error=<nil>",
    "msg=done err=nil",
    "error=null",
    "error=none",
    'error=""',
    '{"error":"","ok":true}',
    '{"error":null}',
  ])("does not flag a line that reports no error: %s", (text) => {
    expect(lineLevel(text)).toBeNull();
  });

  it("still flags a real error next to an empty one", () => {
    expect(lineLevel("error=<nil> then error=timeout")).toBe("error");
  });
});
