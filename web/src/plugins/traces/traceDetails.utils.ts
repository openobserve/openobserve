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
 * Pure helpers for `TraceDetails.vue`. Extracted so we can unit-test
 * the small derivations (session ID resolution, etc.) without mounting
 * the SFC, which has a heavy dependency footprint (echarts, monaco,
 * quasar, vuex, several composables).
 */

/**
 * Resolve the session ID to display in the trace-details header.
 *
 * Looks through the span list for the first span with either:
 *   - `gen_ai_conversation_id` (OTEL Gen-AI semantic convention,
 *     preferred), or
 *   - `session_id` (legacy OO field, kept for backward compatibility
 *     with traces ingested before the rename).
 *
 * Returns an empty string when no span carries either field — the
 * header template uses `v-if="sessionId"` to hide the chip in that
 * case.
 *
 * Why scan the span list rather than reading the root span: not all
 * SDKs propagate the conversation ID to the root span. Anthropic and
 * Vertex tag it on the LLM-call span only. Scanning gives us the
 * widest compatibility.
 *
 * @example resolveSessionId([{ gen_ai_conversation_id: "c-1" }])  // "c-1"
 * @example resolveSessionId([{ session_id: "s-2" }])              // "s-2"
 * @example resolveSessionId([
 *   { gen_ai_conversation_id: "c-1" }, { session_id: "s-2" },
 * ]) // "c-1" — first span with either field wins, gen_ai preferred
 *
 * @example resolveSessionId([{ trace_id: "t-1" }])  // ""  (no session)
 * @example resolveSessionId(undefined)              // ""
 */
export function resolveSessionId(spans: any[] | null | undefined): string {
  if (!spans?.length) return "";
  const s: any = spans.find(
    (sp: any) => sp?.gen_ai_conversation_id || sp?.session_id,
  );
  return s ? String(s.gen_ai_conversation_id || s.session_id || "") : "";
}
