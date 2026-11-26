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

import { gt, raw, type I18nText } from "@/types/i18n";
import { uiIntlLocale } from "@/utils/formatters";
import { periodMs, periodText } from "./context/contextChips";
import type { ContextChip } from "./context/types";
import type { Starter } from "./useAssistantStarters";
import type { ChatMessage } from "@/ts/interfaces/chat";
import type {
  AssistantHostAdapter,
  AssistantSession,
  DockHostId,
  InlineHostId,
  ProposalHostId,
} from "./assistantStore.types";

/** The window an empty default-window answer offers instead (PO A26). */
export const WIDER_PERIOD = "1h";

/** What a starter stages; its window is a door range ending at the click, so it never goes stale. */
export function starterPayload(
  starter: Pick<Starter, "prompt" | "chips" | "period" | "home">,
  org: string,
  now: number = Date.now(),
): { text: string; chips: ContextChip[]; homeStarter?: true } {
  const home = starter.home ? { homeStarter: true as const } : {};
  if (!starter.period) return { text: starter.prompt, chips: starter.chips, ...home };
  const from = now - periodMs(starter.period);
  const period = periodText(starter.period, uiIntlLocale()) ?? starter.period;
  const time: ContextChip = {
    id: "starter-time",
    kind: "time",
    label: gt("assistant.welcome.lastRange", { period: raw(period) }),
    ref: { type: "time", org, from, to: now },
    sizeBytes: 32,
    provenance: "door",
    sent: "whitelist",
  };
  return { text: starter.prompt, chips: [time, ...starter.chips], ...home };
}

/** "1 h" in the UI locale, the duration the empty-window offer names. */
export function widerPeriodText(): I18nText {
  return raw(periodText(WIDER_PERIOD, uiIntlLocale()) ?? WIDER_PERIOD);
}

/** Editors that take the inline helper but never dock a chat. */
export const INLINE_HOST_IDS: ReadonlySet<ProposalHostId> = new Set<InlineHostId>([
  "logs",
  "dashboard",
  "anomaly",
  "alert",
]);

/** True for an editor whose hand-off opens its own dock. */
export function isDockHostId(id: ProposalHostId): id is DockHostId {
  return !INLINE_HOST_IDS.has(id);
}

/** The Traces query key naming the filters the assistant set when it opened the page. */
export const ASSISTANT_SET_QUERY_KEY = "assistant_set";

const FIELDS: readonly AssistantSetField[] = ["query", "stream", "time"];

export type AssistantSetField = "query" | "stream" | "time";

/** Comma-separated in a fixed order, duplicates dropped, so the same set always gives the same URL. */
export function encodeAssistantSet(fields: AssistantSetField[]): string {
  return FIELDS.filter((field) => fields.includes(field)).join(",");
}

/** Unknown entries are dropped; anything that is not a string gives the empty set. */
export function decodeAssistantSet(value: unknown): Set<AssistantSetField> {
  if (typeof value !== "string") return new Set();
  const parts = value.split(",").map((part) => part.trim());
  return new Set(FIELDS.filter((field) => parts.includes(field)));
}

export type HelperLanguage = AssistantHostAdapter["language"];

/** The query helper's request prefix per editor language; the request is `{prefix} : {ask}`. */
export const HELPER_PREFIXES: Readonly<Record<HelperLanguage, string>> = {
  sql: "Generate SQL query",
  promql: "Generate PromQL query",
  vrl: "Generate VRL function",
  js: "Generate JavaScript function",
  regex: "Generate SQL query",
  json: "Generate SQL query",
};

/** How a helper request starts; SQL keeps its ` : ` because people type "Generate SQL query for…" themselves. */
export const HELPER_REQUEST_STARTS: readonly string[] = [
  "Generate SQL query : ",
  "Generate PromQL query",
  "Generate VRL function",
  "Generate JavaScript function",
];

/** The answer to the session's latest prompt; `null` while that prompt has none yet. */
export function lastAnswerOf(session: Pick<AssistantSession, "messages"> | null | undefined) {
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return messages[i];
    if (messages[i].role === "user") return null;
  }
  return null;
}

/** An answer's text blocks joined, or its plain content when it has none. */
export function answerTextOf(answer: ChatMessage | null | undefined): string {
  if (!answer) return "";
  const blocks = answer.contentBlocks ?? [];
  const texts = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "");
  return (texts.length ? texts.join("\n") : String(answer.content ?? "")).trim();
}

/** Saved Markdown as an assistant message, so it renders through the transcript's renderer. */
export function markdownMessage(
  text: string,
  extra: ChatMessage["contentBlocks"] = [],
): ChatMessage {
  return {
    role: "assistant",
    content: text,
    contentBlocks: [...(extra ?? []), { type: "text", text }],
  } as ChatMessage;
}
