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

/**
 * Shared "message part -> display text" logic for the OTel GenAI semconv v5
 * `parts` model (https://github.com/open-telemetry/semantic-conventions-genai,
 * docs/gen-ai/non-normative/models.py), used by both the span sidebar Preview
 * pane (LLMContentRenderer.vue / TraceDetailsSidebar.vue) and the trace
 * detail Thread tab (threadView.utils.ts) so the two surfaces stay in sync
 * on which part types render as text.
 *
 * `blob` / `file` / `uri` intentionally return null (not a fallback string):
 * they carry binary/external-reference payloads with first-class rendering
 * elsewhere, not a text body — callers decide the appropriate treatment via
 * `isSuppressedGenAiPartType`. Every other unrecognised type also returns
 * null, but is NOT suppressed, so a caller can still surface a generic
 * marker instead of silently dropping the turn when the spec grows a new
 * part type.
 */

const SUPPRESSED_PART_TYPES = new Set(["blob", "file", "uri"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    // JSON.stringify can itself return undefined (functions, symbols) despite
    // its declared `string` return type — fall back to String() for those.
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function isSuppressedGenAiPartType(type: string): boolean {
  return SUPPRESSED_PART_TYPES.has(type);
}

export function extractGenAiPartText(part: unknown): string | null {
  if (!isRecord(part)) return null;
  const type = typeof part.type === "string" ? part.type : "";
  if (!type) return null;

  switch (type) {
    case "text":
    case "reasoning":
    case "compaction":
    // pydantic-ai (the SDK from issue #14127) spells the spec's "reasoning"
    // part as "thinking" — verified against its own _otel_messages.py.
    case "thinking":
      if (typeof part.content === "string") return part.content;
      if (typeof part.text === "string") return part.text;
      return null;
    case "tool_call": {
      const name = typeof part.name === "string" ? part.name : "tool";
      return `Called ${name}(${safeStringify(part.arguments ?? {})})`;
    }
    case "tool_call_response":
      // pydantic-ai emits `result`, not the spec's `response` field.
      return safeStringify(part.response ?? part.result);
    case "server_tool_call": {
      const name = typeof part.name === "string" ? part.name : "tool";
      return `Called ${name}(${safeStringify(part.server_tool_call ?? {})})`;
    }
    case "server_tool_call_response":
      return safeStringify(part.server_tool_call_response);
    default:
      return null;
  }
}
