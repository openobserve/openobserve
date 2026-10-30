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

import { extractFrames, extractTailFrames } from "@/components/O2AIChat.framing";

describe("extractFrames", () => {
  it("returns nothing for an empty buffer", () => {
    expect(extractFrames("")).toEqual({ events: [], rest: "" });
  });

  it("extracts one complete frame and leaves no remainder", () => {
    expect(extractFrames('data: {"type":"title"}\n')).toEqual({
      events: ['{"type":"title"}'],
      rest: "",
    });
  });

  it("holds back the trailing incomplete line", () => {
    expect(extractFrames('data: {"a":1}\ndata: {"b":')).toEqual({
      events: ['{"a":1}'],
      rest: 'data: {"b":',
    });
  });

  it("extracts several frames from one chunk", () => {
    const { events, rest } = extractFrames('data: {"a":1}\ndata: {"a":2}\ndata: {"a":3}\n');
    expect(events).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
    expect(rest).toBe("");
  });

  it("reassembles a frame split across chunks inside the JSON", () => {
    const first = extractFrames('data: {"content":"hel');
    expect(first.events).toEqual([]);
    const second = extractFrames(first.rest + 'lo"}\n');
    expect(second.events).toEqual(['{"content":"hello"}']);
    expect(second.rest).toBe("");
  });

  it("reassembles a frame split inside the data: prefix", () => {
    const first = extractFrames("da");
    expect(first).toEqual({ events: [], rest: "da" });
    const second = extractFrames(first.rest + 'ta: {"a":1}\n');
    expect(second.events).toEqual(['{"a":1}']);
  });

  it("keeps the carriage return of CRLF line endings in the payload", () => {
    const { events } = extractFrames('data: {"a":1}\r\n');
    expect(events).toEqual(['{"a":1}\r']);
    expect(JSON.parse(events[0])).toEqual({ a: 1 });
  });

  it("tolerates leading whitespace before data:", () => {
    expect(extractFrames('   data: {"a":1}\n').events).toEqual(['{"a":1}']);
  });

  it("drops blank lines, comments and keepalives", () => {
    const { events } = extractFrames(': ping\n\nevent: message\ndata: {"a":1}\n\n');
    expect(events).toEqual(['{"a":1}']);
  });

  it("drops a data line without the trailing space", () => {
    expect(extractFrames('data:{"a":1}\n').events).toEqual([]);
  });

  it("emits the [DONE] sentinel verbatim because it has no brace", () => {
    expect(extractFrames("data: [DONE]\n").events).toEqual(["data: [DONE]"]);
  });

  it("emits a brace-less data line verbatim, so the caller's JSON.parse rejects it", () => {
    expect(extractFrames("data: not json\n").events).toEqual(["data: not json"]);
  });

  it("starts the payload at the first brace, dropping anything before it", () => {
    expect(extractFrames('data:  \t {"a":1}\n').events).toEqual(['{"a":1}']);
  });

  it("returns an empty remainder when the buffer ends on a newline", () => {
    expect(extractFrames("data: {}\n").rest).toBe("");
  });

  it("returns the whole buffer as remainder when it has no newline", () => {
    expect(extractFrames("data: {}")).toEqual({ events: [], rest: "data: {}" });
  });
});

describe("extractTailFrames", () => {
  it("returns nothing for an empty buffer", () => {
    expect(extractTailFrames("")).toEqual([]);
  });

  it("returns nothing for a whitespace-only buffer", () => {
    expect(extractTailFrames("  \n \n")).toEqual([]);
  });

  it("returns nothing when the buffer holds no data lines", () => {
    expect(extractTailFrames(": keepalive\nevent: done\n")).toEqual([]);
  });

  it("consumes the final line even without a trailing newline", () => {
    expect(extractTailFrames('data: {"a":1}')).toEqual(['{"a":1}']);
  });

  it("consumes every line, unlike extractFrames", () => {
    const buffer = 'data: {"a":1}\ndata: {"a":2}';
    expect(extractTailFrames(buffer)).toEqual(['{"a":1}', '{"a":2}']);
    expect(extractFrames(buffer).events).toEqual(['{"a":1}']);
  });

  it("emits a truncated JSON payload, leaving the caller's parse to fail", () => {
    expect(extractTailFrames('data: {"a":')).toEqual(['{"a":']);
  });
});
