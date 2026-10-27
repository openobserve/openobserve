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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contextUsedKeys, isDroppableFrame, isFrame, isUnknownFrame, parseFrame } from "./frames";

const FIXTURES = join(__dirname, "__fixtures__", "frames");

const fixtures = readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({
    file,
    fixture: JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as {
      _source: string;
      frame: { type: string };
    },
  }));

describe("parseFrame", () => {
  it("has one fixture per frame type of 00 §5.2", () => {
    expect(fixtures.map(({ file }) => file.replace(/\.json$/, "")).sort()).toEqual(
      [
        "cancelled",
        "compacting",
        "complete",
        "confirmation_required",
        "confirmation_resolved",
        "error",
        "findings",
        "message",
        "message_delta",
        "navigation_action",
        "permission_denied",
        "query",
        "resource_changed",
        "retrying",
        "status",
        "step",
        "sync",
        "sync_state",
        "title",
        "tool_call",
        "tool_result",
        "turn_started",
        "usage",
      ].sort(),
    );
  });

  it.each(fixtures)("parses $file to its own type and names its producer", ({ file, fixture }) => {
    expect(fixture._source).toBeTruthy();
    const frame = parseFrame(JSON.stringify(fixture.frame));
    expect(frame.type).toBe(file.replace(/\.json$/, ""));
    expect(frame).toEqual(fixture.frame);
  });

  it("keeps fields the schema does not name", () => {
    const frame = parseFrame('{"type":"status","message":"x","seq":7}');
    expect(frame).toEqual({ type: "status", message: "x", seq: 7 });
  });

  it("returns unknown for a malformed line instead of throwing", () => {
    expect(parseFrame("data: {oops")).toEqual({ type: "unknown", raw: "data: {oops" });
    expect(parseFrame("42")).toEqual({ type: "unknown", raw: "42" });
  });

  it("returns unknown for an unknown type", () => {
    const frame = parseFrame('{"type":"reasoning_delta","content":"x"}');
    expect(isUnknownFrame(frame)).toBe(true);
  });

  it("returns unknown for a known type with the wrong shape", () => {
    expect(isUnknownFrame(parseFrame('{"type":"title"}'))).toBe(true);
    expect(isUnknownFrame(parseFrame('{"type":"retrying","attempt":"one"}'))).toBe(true);
  });
});

describe("WP-23 frame shapes (o2-ai PR #167)", () => {
  it("keeps a tool_result whose summary is an object (SearchSQL) or a sentence", () => {
    const object = parseFrame(
      '{"type":"tool_result","tool":"SearchSQL","call_id":"c1","summary":{"count":4,"took":38}}',
    );
    expect(isFrame(object, "tool_result") && object.summary).toEqual({ count: 4, took: 38 });
    const text = parseFrame('{"type":"tool_result","tool":"x","summary":"4 rows"}');
    expect(isFrame(text, "tool_result") && text.summary).toBe("4 rows");
  });

  it.each([
    [
      "step",
      '{"type":"step","id":"c1","call_id":"c1","kind":"query","label":"SearchSQL","params":{"stream":"default","call_id":"c1"},"state":"running"}',
    ],
    ["retrying", '{"type":"retrying","attempt":2,"reason":"rate_limit","retry_after":12}'],
    ["cancelled", '{"type":"cancelled","by":"server","turn_id":"t1"}'],
    ["complete", '{"type":"complete","empty":true,"compacted":true}'],
    [
      "permission_denied",
      '{"type":"permission_denied","tool":"o2_x","policy":"opencode","detail":"d"}',
    ],
    ["turn_started", '{"type":"turn_started","turn_id":"t1","agent_type":"sre","trace_id":"tr"}'],
  ])("parses the lifecycle %s frame with its new fields", (type, json) => {
    const frame = parseFrame(json);
    expect(frame.type).toBe(type);
    expect(frame).toEqual(JSON.parse(json));
  });
});

describe("complete.context_used", () => {
  const complete = (contextUsed: unknown) =>
    parseFrame(JSON.stringify({ type: "complete", persisted: true, context_used: contextUsed }));

  it("keeps a complete frame whose context_used holds o2-ai's key entries", () => {
    const frame = complete([
      { key: "stream", used: true },
      { key: "query", used: true, reason: "truncated" },
      { key: "time_range", used: false, reason: "empty" },
    ]);
    expect(isFrame(frame, "complete") && frame.persisted).toBe(true);
    expect(isFrame(frame, "complete") && contextUsedKeys(frame.context_used)).toEqual([
      "stream",
      "query",
    ]);
  });

  it("still reads a list of bare key names", () => {
    const frame = complete(["stream", "stream"]);
    expect(isFrame(frame, "complete") && contextUsedKeys(frame.context_used)).toEqual(["stream"]);
    expect(contextUsedKeys(["query", 3, null])).toEqual(["query"]);
  });

  it("drops a malformed list without losing the frame", () => {
    const frame = complete({ key: "stream" });
    expect(isFrame(frame, "complete") && frame.persisted).toBe(true);
    expect(isFrame(frame, "complete") && frame.context_used).toBeUndefined();
  });

  it("keeps the good entries when one entry is malformed, and cuts the list before reading it", () => {
    const frame = complete([
      { key: "stream", used: true },
      { key: 5, used: "yes" },
      "query",
      null,
      { key: "time_range", used: true, reason: 7 },
    ]);
    expect(isFrame(frame, "complete") && frame.persisted).toBe(true);
    expect(isFrame(frame, "complete") && contextUsedKeys(frame.context_used)).toEqual([
      "stream",
      "query",
      "time_range",
    ]);
    const long = complete(Array.from({ length: 1_000 }, () => 0));
    expect(isFrame(long, "complete") && long.context_used).toHaveLength(200);
  });

  it("bounds the count and the key length", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, used: true }));
    expect(contextUsedKeys(many)).toHaveLength(20);
    expect(contextUsedKeys([{ key: "x".repeat(500), used: true }])?.[0]).toHaveLength(64);
    expect(contextUsedKeys(undefined)).toBeUndefined();
  });
});

describe("frame guards", () => {
  it("narrows by type", () => {
    const frame = parseFrame('{"type":"tool_call","tool":"SearchSQL","call_id":"c1"}');
    expect(isFrame(frame, "tool_call") && frame.call_id).toBe("c1");
    expect(isFrame(frame, "tool_result")).toBe(false);
  });

  it("types sync and sync_state and flags them droppable", () => {
    expect(isDroppableFrame(parseFrame('{"type":"sync","seq":1}'))).toBe(true);
    expect(isDroppableFrame(parseFrame('{"type":"sync_state"}'))).toBe(true);
    expect(isDroppableFrame(parseFrame('{"type":"status"}'))).toBe(false);
    expect(isUnknownFrame(parseFrame('{"type":"sync"}'))).toBe(false);
  });
});
