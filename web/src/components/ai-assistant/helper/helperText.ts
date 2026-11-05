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

import { HELPER_PREFIXES, type HelperLanguage } from "@/composables/assistant/pure";

export { HELPER_PREFIXES, type HelperLanguage };

/** The "needs the assistant" line quotes at most this much of the answer. */
export const ANSWER_LINE_CHARS = 120;

/** A buffer longer than this is never read as a sentence. */
export const MAX_HINT_CHARS = 400;

const FENCE_TAGS: Record<HelperLanguage, string[]> = {
  sql: ["sql"],
  promql: ["promql", "prometheus"],
  vrl: ["vrl"],
  js: ["javascript", "js"],
  regex: ["regex"],
  json: ["json"],
};

const COMMENT_MARKERS = ["--", "#", "//", "/*"];

const SQL_LEAD = /^(select|with|from|where|insert|update|delete|create|alter|drop|explain)\b/i;

// Any of these makes the text code: assignment, comparison, call, brace, bracket, pipe, key:value, dot path.
const CODE_TOKEN = /[=<>{}()[\];|&$`\\]|\w:\S|(^|\s)\.\w|\w\.\w/;

const SQL_RUN = /^\s*(select|with)\b/i;

// Clause words that continue a statement even when the model writes them in lower case.
const SQL_CONTINUATION =
  /^(from|where|group|order|limit|having|and|or|not|join|left|right|inner|outer|full|cross|on|union|offset|as|case|when|then|else|end|select|with|in|between|like|is)\b/i;

const QUESTION_PATTERNS = [
  /what is your organization/i,
  /I need to check/i,
  /I need the organization/i,
  /which stream/i,
  /what stream/i,
  /could you provide/i,
  /can you specify/i,
];

/** True when the buffer reads as a sentence rather than code: three or more words, no code token, no leading comment. */
export function readsAsPlainLanguage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_HINT_CHARS || trimmed.includes("\n")) return false;
  if (COMMENT_MARKERS.some((marker) => trimmed.startsWith(marker))) return false;
  if (SQL_LEAD.test(trimmed) || CODE_TOKEN.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return words.length >= 3;
}

/** The query in an answer: a fence tagged with the language, else the first fence, else a SQL statement run. */
export function extractProposal(answer: string, language: HelperLanguage): string | null {
  const fences = fencesOf(answer);
  const tagged = fences.find((fence) => FENCE_TAGS[language].includes(fence.tag));
  const picked = tagged ?? fences[0];
  if (picked?.body.trim()) {
    const body = picked.body.trim();
    return language === "vrl" ? normalizeVrlComments(body) : body;
  }
  return language === "sql" ? sqlRunOf(answer) : null;
}

/** The question an answer ends on, when it asks for more detail instead of writing a query. */
export function questionOf(answer: string): string | null {
  const text = answer.trim();
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (last.endsWith("?")) return clip(lastSentence(last));
  const asked = lines.find((line) => QUESTION_PATTERNS.some((pattern) => pattern.test(line)));
  return asked ? clip(asked) : null;
}

/** The first line of the answer, cut for the status line. */
export function firstAnswerLine(answer: string): string {
  const line =
    answer
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return clip(line.replace(/^#+\s*/, ""));
}

/** The text sent to the agent: the modify form against the current query, or the generate form. */
export function helperRequest(
  prompt: string,
  language: HelperLanguage,
  current: string | null,
): string {
  const prefix = HELPER_PREFIXES[language];
  const ask = prompt.trim();
  if (!current?.trim()) return `${prefix} : ${ask}`;
  const name = language === "js" ? "JAVASCRIPT" : language.toUpperCase();
  return `${prefix} : Modify this ${name} query to ${ask}:\n\n${current}`;
}

function fencesOf(answer: string): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = [];
  const pattern = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) && out.length < 20)
    out.push({ tag: match[1].toLowerCase(), body: match[2] });
  return out;
}

function sqlRunOf(answer: string): string | null {
  const lines = answer.split("\n");
  const start = lines.findIndex((line) => SQL_RUN.test(line));
  if (start === -1) return null;
  const run: string[] = [];
  for (const line of lines.slice(start)) {
    const trimmed = line.trim();
    if (!trimmed || (run.length > 0 && readsAsProse(trimmed))) break;
    run.push(line);
  }
  return run.join("\n").trim() || null;
}

// Lower-case SQL keeps going; a list item or a sentence that is not a clause ends the statement.
function readsAsProse(line: string): boolean {
  if (SQL_CONTINUATION.test(line)) return false;
  if (/^[-*]\s/.test(line)) return true;
  return /^[a-z]/.test(line) && /[.!?:]$/.test(line);
}

function normalizeVrlComments(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const quotes = (line.match(/"/g) ?? []).length;
      if (quotes % 2 !== 0 || !line.includes("//")) return line;
      return line.replace(/^(\s*)\/\/\s?/, "$1# ").replace(/(\s+)\/\/\s?/, "$1# ");
    })
    .join("\n");
}

function lastSentence(line: string): string {
  const parts = line.split(/(?<=[.!])\s+/);
  return parts[parts.length - 1] ?? line;
}

function clip(text: string): string {
  return text.length > ANSWER_LINE_CHARS ? `${text.slice(0, ANSWER_LINE_CHARS - 1)}…` : text;
}
