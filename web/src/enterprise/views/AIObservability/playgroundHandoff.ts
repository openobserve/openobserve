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

// Carries one LLM span's conversation from Trace Details into the Playground.
//
// The messages travel through sessionStorage rather than the URL: a real prompt
// is far past any safe query-string length, and encoding it would put customer
// data in browser history and server logs. A snapshot record would work too, but
// it persists a row for what is a transient hand-off.
//
// Everything imported is ORDINARY, editable draft content. Nothing is marked
// `readonly` — the point of the button is to change the call and re-run it.

import { playgroundId, type PlaygroundMessage, type PlaygroundRole } from "./playgroundDraft";

/** One-shot: read by the Playground on entry, then dropped. */
const HANDOFF_KEY = "o2-playground-handoff";

const ROLES: PlaygroundRole[] = ["system", "user", "assistant", "tool"];

export interface PlaygroundHandoff {
  messages: PlaygroundMessage[];
  temperature: string;
  /** The span this came from, for the provenance chip. */
  sourceId: string;
}

// Deliberately NOT carried over: the span's provider and model. A trace records
// whatever served it in production, which the user may have no credentials for
// here — a model string pointing at an unconfigured provider fails at Run with
// nothing on screen explaining why. The bench seeds its own default provider
// instead, and the conversation is the part worth importing.

/** Gemini answers as `model`; everything else already matches our four roles. */
function toRole(value: unknown, fallback: PlaygroundRole): PlaygroundRole {
  const role = String(value ?? "").toLowerCase();
  if (role === "model") return "assistant";
  return ROLES.includes(role as PlaygroundRole) ? (role as PlaygroundRole) : fallback;
}

/** Multimodal content is a parts array; the bench edits text, so the text parts
 *  are joined and anything else is kept as JSON rather than dropped. */
function toContent(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((part: any) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        // Chat parts key the text as `text`; system-instruction parts use
        // `content`. Both shapes come off the same spans.
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
      }
      return JSON.stringify(part);
    });
    return parts.filter(Boolean).join("\n\n");
  }
  return JSON.stringify(content);
}

/** A span field may arrive as an array, a single message, or a JSON string of
 *  either — the same three shapes the trace preview already handles. */
function parseMessages(value: unknown, fallbackRole: PlaygroundRole): PlaygroundMessage[] {
  if (value === null || value === undefined || value === "") return [];

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Not JSON: a bare prompt string is still a message.
      return [{ id: playgroundId("msg"), role: fallbackRole, content: value }];
    }
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .map((entry: any) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === "string") {
        return { id: playgroundId("msg"), role: fallbackRole, content: entry };
      }
      const content = toContent(entry.content ?? entry.parts ?? entry.text);
      if (!content) return null;
      return { id: playgroundId("msg"), role: toRole(entry.role, fallbackRole), content };
    })
    .filter((message): message is PlaygroundMessage => message !== null);
}

function parseSystemInstructions(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof parsed === "string") return parsed;
  return toContent(parsed);
}

/**
 * Exactly one system row, always first.
 *
 * Present on the span or not, the bench needs the field: a conversation with no
 * system turn still needs somewhere to type one, and no row at all reads as the
 * import having lost it. Empty is the input; filled is the prompt that produced
 * the trace.
 */
function withSystemRow(messages: PlaygroundMessage[], instructions: string): PlaygroundMessage[] {
  const existing = messages.find((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  // A system turn inside the messages array wins: the separate field is what
  // providers use INSTEAD of one, never as well as one.
  const content = existing?.content || instructions;
  return [{ id: playgroundId("msg"), role: "system", content }, ...rest];
}

/**
 * Build a hand-off from a trace span. Returns null when the span carries no
 * conversation — the button is hidden in that case rather than opening an empty
 * bench.
 */
export function handoffFromSpan(span: any): PlaygroundHandoff | null {
  if (!span) return null;

  const input = parseMessages(span.gen_ai_input_messages ?? span.attributes_prompt, "user");
  const output = parseMessages(
    span.gen_ai_output_messages ?? span.attributes_response,
    "assistant",
  );
  const instructions = parseSystemInstructions(span.gen_ai_system_instructions);
  if (!input.length && !output.length && !instructions) return null;

  const messages = withSystemRow([...input, ...output], instructions);

  const temperature = span.llm_request_parameters?.temperature;

  return {
    messages,
    temperature: temperature === null || temperature === undefined ? "" : String(temperature),
    sourceId: String(span.span_id ?? ""),
  };
}

/** False when storage is unavailable or full, so the caller can decline to
 *  navigate rather than landing the user on an empty bench. */
export function stashHandoff(handoff: PlaygroundHandoff): boolean {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

/** Reads and CONSUMES the hand-off: a refresh must not silently re-import over
 *  edits the user has since made to the bench. */
export function takeHandoff(): PlaygroundHandoff | null {
  try {
    const stored = sessionStorage.getItem(HANDOFF_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(stored) as PlaygroundHandoff;
    // Ids are regenerated: a stale id colliding with a restored session's
    // message would make two rows share a key.
    parsed.messages = (parsed.messages ?? []).map((message) => ({
      ...message,
      id: playgroundId("msg"),
    }));
    return parsed.messages.length ? parsed : null;
  } catch {
    return null;
  }
}
