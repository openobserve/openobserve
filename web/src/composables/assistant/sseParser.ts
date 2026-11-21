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

import { isDroppableFrame, isUnknownFrame, parseFrame, type AssistantFrame } from "./frames";

/** A line over this many characters ends the turn as `stream_oversized` (`99` T8). */
export const MAX_LINE_LENGTH = 1024 * 1024;

const UNKNOWN_TYPE_LENGTH = 32;

export interface ExtractedFrames {
  events: string[];
  rest: string;
}

/** What the parser hands its consumer, one line at a time. */
export interface SseHandlers {
  /** `id` is the last `id:` line seen: the seq the frame comes after, which several frames may share (WP-18). */
  frame(frame: AssistantFrame, id: string | null): void;
  /** An `id: N` message without data: everything through seq N was sent. */
  boundary?(id: string): void;
  keepalive(): void;
  /** Counted as `ai_frame_unknown{type}` and ignored; one bad line never halts the stream. */
  unknown(type: string): void;
}

export interface SseParser {
  /** False once a line went over the guard; the caller ends the stream. */
  push(chunk: string): boolean;
  /** Applies a last line the stream ended without a newline for (HT-07 AC 4). */
  end(): boolean;
  readonly lastEventId: string | null;
}

/** `error` is a consumer that threw on a frame; the reader is cancelled and the turn is not a drop. */
export type StreamEnd = "eof" | "abort" | "oversized" | "error";

function payloadOf(line: string): string | null {
  if (!line.trim().startsWith("data: ")) return null;
  // No brace means indexOf returns -1 and substring(-1) hands back the whole line, which then fails to parse.
  const jsonStr = line.substring(line.indexOf("{"));
  if (!jsonStr || !jsonStr.trim()) return null;
  return jsonStr;
}

export function extractFrames(buffer: string): ExtractedFrames {
  const lines = buffer.split("\n");
  const rest = lines.pop() || "";
  const events: string[] = [];
  for (const line of lines) {
    const payload = payloadOf(line);
    if (payload !== null) events.push(payload);
  }
  return { events, rest };
}

export function extractTailFrames(buffer: string): string[] {
  if (!buffer.trim()) return [];
  const events: string[] = [];
  for (const line of buffer.split("\n")) {
    const payload = payloadOf(line);
    if (payload !== null) events.push(payload);
  }
  return events;
}

export function createSseParser(handlers: SseHandlers): SseParser {
  let carry = "";
  let lastEventId: string | null = null;
  let oversized = false;
  // What the message being read has so far; a blank line ends it.
  let messageId = false;
  let messageData = false;
  const handle = (rawLine: string): boolean => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length > MAX_LINE_LENGTH) return false;
    const trimmed = line.trimStart();
    if (!trimmed) {
      if (messageId && !messageData && lastEventId !== null) handlers.boundary?.(lastEventId);
      messageId = messageData = false;
    } else if (trimmed.startsWith(":")) handlers.keepalive();
    else if (trimmed.startsWith("id:")) {
      lastEventId = trimmed.slice(3).trim() || null;
      messageId = true;
    } else if (trimmed.startsWith("data:")) {
      messageData = true;
      dispatchPayload(trimmed.slice(5), lastEventId, handlers);
    }
    return true;
  };
  return {
    push(chunk) {
      if (oversized) return false;
      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";
      oversized = !lines.every(handle) || carry.length > MAX_LINE_LENGTH;
      return !oversized;
    },
    end() {
      if (oversized) return false;
      const rest = carry;
      carry = "";
      oversized = rest.trim() !== "" && !handle(rest);
      return !oversized;
    },
    get lastEventId() {
      return lastEventId;
    },
  };
}

/** Reads a response body to its end; resolves how it ended and never throws. */
export async function parseStream(
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<StreamEnd> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(handlers);
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  const feed = (chunk: string, last: boolean): StreamEnd | null => {
    try {
      if (!parser.push(chunk) || (last && !parser.end())) return "oversized";
      return last ? "eof" : null;
    } catch {
      return "error";
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return "abort";
      const end = done
        ? feed(decoder.decode(), true)
        : feed(decoder.decode(value, { stream: true }), false);
      if (end === "eof") return end;
      if (end) {
        cancel();
        return end;
      }
    }
  } catch {
    // A reset mid-body is a dropped stream the turn reports, not a crash.
    return signal?.aborted ? "abort" : "eof";
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function dispatchPayload(data: string, id: string | null, handlers: SseHandlers): void {
  const brace = data.indexOf("{");
  if (brace < 0) {
    if (data.trim()) handlers.unknown("unparsed");
    return;
  }
  const frame = parseFrame(data.slice(brace));
  if (isUnknownFrame(frame)) handlers.unknown(unknownTypeOf(frame.raw));
  else if (!isDroppableFrame(frame)) handlers.frame(frame, id);
}

function unknownTypeOf(json: string): string {
  try {
    const type = (JSON.parse(json) as { type?: unknown })?.type;
    return typeof type === "string" ? type.slice(0, UNKNOWN_TYPE_LENGTH) : "unparsed";
  } catch {
    return "unparsed";
  }
}
