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

import { describe, expect, it, vi } from "vitest";

import type { AssistantFrame } from "./frames";
import { reduce, type ReducerCtx, type StreamState } from "./reducer";
import {
  MAX_LINE_LENGTH,
  createSseParser,
  extractFrames,
  extractTailFrames,
  parseStream,
} from "./sseParser";

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

function collect() {
  const frames: { frame: any; id: string | null }[] = [];
  const unknown: string[] = [];
  let keepalives = 0;
  const parser = createSseParser({
    frame: (frame, id) => frames.push({ frame, id }),
    keepalive: () => (keepalives += 1),
    unknown: (type) => unknown.push(type),
  });
  return { parser, frames, unknown, keepalives: () => keepalives };
}

// Pull-based, so a failure arrives after the chunks were read, as a mid-body reset does.
function body(chunks: string[], fail?: Error): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const queue = [...chunks];
  return new ReadableStream({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(enc.encode(next));
      else if (fail) controller.error(fail);
      else controller.close();
    },
  });
}

describe("createSseParser", () => {
  it("reports an id-only message as a boundary and gives each frame the id it came with, repeated ids included (WP-18)", () => {
    const frames: { frame: AssistantFrame; id: string | null }[] = [];
    const boundaries: string[] = [];
    const parser = createSseParser({
      frame: (frame, id) => frames.push({ frame, id }),
      keepalive: () => undefined,
      unknown: () => undefined,
      boundary: (id) => boundaries.push(id),
    });
    parser.push(
      'id: -1\ndata: {"type":"turn_started","turn_id":"t"}\n\nid: -1\ndata: {"type":"status"}\n\n',
    );
    parser.push('id: 0\n\nid: 0\ndata: {"type":"message_delta","content":"a"}\n\nid: 0\nda');
    parser.push('ta: {"type":"message_delta","content":"b"}\n\nid: 1\r\n\r\n: keepalive\n\n');
    expect(frames.map((f) => f.id)).toEqual(["-1", "-1", "0", "0"]);
    expect(boundaries).toEqual(["0", "1"]);
  });

  it("reassembles a frame split across chunks, including a cut JSON brace", () => {
    const { parser, frames } = collect();
    parser.push('data: {"type":"message_delta","con');
    parser.push('tent":"hel');
    parser.push('lo"}\ndata: {"type":"title","title":"T"');
    parser.push("}\n");
    expect(frames.map((f) => f.frame)).toEqual([
      { type: "message_delta", content: "hello" },
      { type: "title", title: "T" },
    ]);
  });

  it("treats `: keepalive` comments as liveness, never as frames (app.py:1826)", () => {
    const { parser, frames, keepalives } = collect();
    parser.push(": keepalive\n\n: keepalive\n");
    expect(keepalives()).toBe(2);
    expect(frames).toEqual([]);
  });

  it("hands the last `id:` to the frames after it, for Last-Event-ID (B-03)", () => {
    const { parser, frames } = collect();
    parser.push(
      'id: 7\ndata: {"type":"status"}\n\nid: 8\r\ndata: {"type":"title","title":"x"}\r\n',
    );
    expect(frames.map((f) => f.id)).toEqual(["7", "8"]);
    expect(parser.lastEventId).toBe("8");
  });

  it("counts an unknown type, cut to 32 characters, and keeps going", () => {
    const { parser, frames, unknown } = collect();
    const long = "x".repeat(40);
    parser.push(`data: {"type":"${long}"}\ndata: not json\ndata: {"type":"title","title":"ok"}\n`);
    expect(unknown).toEqual(["x".repeat(32), "unparsed"]);
    expect(frames.map((f) => f.frame.type)).toEqual(["title"]);
  });

  it("drops sync and sync_state silently (constraint 45)", () => {
    const { parser, frames, unknown } = collect();
    parser.push('data: {"type":"sync"}\ndata: {"type":"sync_state"}\n');
    expect(frames).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("stops at a line over 1 MiB, complete or still open (99 T8)", () => {
    const whole = collect();
    expect(
      whole.parser.push(`data: {"type":"message","content":"${"a".repeat(MAX_LINE_LENGTH)}"}\n`),
    ).toBe(false);
    expect(whole.parser.push('data: {"type":"title","title":"after"}\n')).toBe(false);
    expect(whole.frames).toEqual([]);
    const open = collect();
    expect(open.parser.push(`data: ${"a".repeat(MAX_LINE_LENGTH + 1)}`)).toBe(false);
  });

  it("applies a last frame the stream ended without a newline for (HT-07 AC 4)", () => {
    const { parser, frames } = collect();
    parser.push(
      'data: {"type":"navigation_action","resource_type":"logs","action":"load_query","target":{}}',
    );
    expect(frames).toEqual([]);
    expect(parser.end()).toBe(true);
    expect(frames.map((f) => f.frame.type)).toEqual(["navigation_action"]);
  });
});

describe("parseStream", () => {
  const handlers = () => ({ frame: vi.fn(), keepalive: vi.fn(), unknown: vi.fn() });

  it("reads to the end and flushes the trailing frame", async () => {
    const h = handlers();
    const end = await parseStream(
      body(['data: {"type":"status"}\n', 'data: {"type":"complete"}']),
      h,
    );
    expect(end).toBe("eof");
    expect(h.frame.mock.calls.map(([frame]) => frame.type)).toEqual(["status", "complete"]);
  });

  it("reports a body read failure as eof, so the turn ends as dropped (flips O2AIChat.stream.spec.ts:2004)", async () => {
    const h = handlers();
    const end = await parseStream(
      body(['data: {"type":"message_delta","content":"a"}\n'], new TypeError("network reset")),
      h,
    );
    expect(end).toBe("eof");
    expect(h.frame).toHaveBeenCalledTimes(1);
  });

  it("reports a handler that throws as error, distinct from eof, and cancels the reader", async () => {
    const cancel = vi.fn();
    const queue = ['data: {"type":"status"}\n', 'data: {"type":"title","title":"t"}\n'];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = queue.shift();
        if (next) controller.enqueue(new TextEncoder().encode(next));
        else controller.close();
      },
      cancel,
    });
    const h = handlers();
    h.frame.mockImplementation(() => {
      throw new Error("consumer bug");
    });
    await expect(parseStream(stream, h)).resolves.toBe("error");
    expect(h.frame).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });

  it("reports an abort as abort", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const pending = parseStream(stream, handlers(), controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe("abort");
  });

  it("reports an oversized line", async () => {
    const big = `data: ${"b".repeat(MAX_LINE_LENGTH + 10)}\n`;
    await expect(parseStream(body([big]), handlers())).resolves.toBe("oversized");
  });
});

describe("the final-chunk gap is closed for the new path", () => {
  const t = ((key: string) => key) as any;
  const ctx: ReducerCtx = {
    isActive: true,
    autoNavigationEnabled: false,
    phase: "live",
    t,
    generateNavigation: () => null,
  };
  const state = (): StreamState => ({
    messages: [],
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
  });

  it.each([
    [
      "confirmation_required (O2AIChat.stream.spec.ts:528)",
      '{"type":"confirmation_required","tool":"o2_delete","message":"Delete?"}',
    ],
    [
      "navigation_action (O2AIChat.stream.spec.ts:1178)",
      '{"type":"navigation_action","resource_type":"logs","action":"load_query","label":"Open","target":{}}',
    ],
  ])("applies %s when it is the last bytes of the stream", async (_name, json) => {
    const s = state();
    await parseStream(
      body([`data: {"type":"message_delta","content":"text"}\n`, `data: ${json}`]),
      {
        frame: (frame) => void reduce(s, frame, ctx),
        keepalive: () => undefined,
        unknown: () => undefined,
      },
    );
    const blocks = s.messages[0].contentBlocks ?? [];
    // A navigation is a link card and a confirmation an approval block, the record its card resolves into.
    expect(blocks.some((b) => b.type === "approval" || b.type === "link")).toBe(true);
  });
});
