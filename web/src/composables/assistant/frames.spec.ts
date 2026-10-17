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

import { isDroppableFrame, isFrame, isUnknownFrame, parseFrame } from "./frames";

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
