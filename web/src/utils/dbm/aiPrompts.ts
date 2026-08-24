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
 * The prompts the "suggest a fix" buttons send to the AI assistant.
 *
 * These are English instructions to a model, not UI copy — they are composed
 * here as plain strings and wrapped in `raw()` at the call site. Three rules,
 * all about not letting the model invent the half of the problem it cannot see:
 *
 *   • Every number carries its unit and its window. A bare "p95 250" is a
 *     number the model will guess the unit of, and the guess ends up in advice.
 *   • The statement is stated as NORMALIZED (literals replaced with `?`). Left
 *     unsaid, a model reads `id = ?` as a bind parameter it can reason about
 *     selectivity for, and confidently recommends an index on a value it has
 *     never seen.
 *   • A missing fact is omitted, never defaulted. An absent p99 must not become
 *     `0ms`, which reads as "instant" and inverts the diagnosis.
 *
 * Each builder returns one natural-language paragraph block plus a specific
 * closing question, kept under ~200 words so the whole prompt survives the
 * chat input without truncation.
 */

import { formatCount, formatMultiplier, formatNs, oneLine } from "@/utils/dbm/format";

/** Drop empty lines so an omitted fact leaves no blank gap in the prompt. */
const joinLines = (lines: (string | null | undefined)[]): string =>
  lines.filter((line) => Boolean(line && line.trim())).join("\n");

/** `label: value`, or nothing at all when the value is missing. */
const fact = (label: string, value: string | null | undefined): string | null =>
  value ? `- ${label}: ${value}` : null;

/** A number is only a fact when it is actually present — 0 is, undefined is not. */
const nsFact = (label: string, ns: number | null | undefined): string | null =>
  ns == null ? null : fact(label, formatNs(ns));

/**
 * The engine, in the words a model reasons about. `postgresql`/`mysql` arrive
 * from the span attribute; anything else is passed through so an unusual engine
 * is still named rather than silently becoming "SQL".
 */
const engineName = (dbSystem: string | null | undefined): string =>
  (dbSystem ?? "").trim() || "an unspecified SQL engine";

/** The one sentence that stops the model reasoning about literals it cannot see. */
const NORMALIZED_NOTE =
  "The statement is normalized: every literal has been replaced with `?`, " +
  "so treat parameter values as unknown and do not assume selectivity from them.";

export interface QueryFixPromptInput {
  /** Normalized statement, literals already replaced with `?`. */
  queryNorm: string;
  dbSystem?: string | null;
  dbInstance?: string | null;
  /** Rollup metrics, NANOseconds — the same unit the page displays. */
  p50Ns?: number | null;
  p95Ns?: number | null;
  p99Ns?: number | null;
  maxNs?: number | null;
  totalTimeNs?: number | null;
  calls?: number | null;
  errors?: number | null;
  /** Executions of this statement per request/trace, when known. */
  callsPerTrace?: number | null;
  /** Callers, already ranked; only the top few are worth the prompt budget. */
  endpoints?: { service?: string | null; endpoint?: string | null; calls?: number | null }[];
}

/** Top callers named on one line — who to go talk to, not a table dump. */
const ENDPOINT_LIMIT = 3;

const endpointLine = (endpoints: QueryFixPromptInput["endpoints"]): string | null => {
  const named = (endpoints ?? [])
    .slice(0, ENDPOINT_LIMIT)
    .map((entry) => {
      const who = [entry.service, entry.endpoint].filter(Boolean).join(" ");
      if (!who) return "";
      return entry.calls == null ? who : `${who} (${formatCount(entry.calls)} calls)`;
    })
    .filter(Boolean);
  return named.length ? fact("Called from", named.join(", ")) : null;
};

/**
 * "Why is this slow and what do I do" — the query detail page's question.
 *
 * The per-request multiplier is included whenever it is known because it
 * separates the two fixes that look identical from latency alone: a slow
 * statement needs an index, a statement run 40 times per request needs the
 * caller changed, and the numbers only tell them apart together.
 */
export const buildQueryFixPrompt = (input: QueryFixPromptInput): string => {
  const statement = oneLine(input.queryNorm);
  const facts = joinLines([
    fact("Engine", engineName(input.dbSystem)),
    fact("Instance", input.dbInstance),
    nsFact("p50", input.p50Ns),
    nsFact("p95", input.p95Ns),
    nsFact("p99", input.p99Ns),
    nsFact("Slowest execution", input.maxNs),
    input.calls == null ? null : fact("Executions in the window", formatCount(input.calls)),
    input.totalTimeNs == null
      ? null
      : fact("Total database time in the window", formatNs(input.totalTimeNs)),
    input.errors == null || input.errors <= 0
      ? null
      : fact("Failed executions", formatCount(input.errors)),
    input.callsPerTrace == null
      ? null
      : fact("Executions per request", `${formatMultiplier(input.callsPerTrace)} on average`),
    endpointLine(input.endpoints),
  ]);

  return joinLines([
    `This ${engineName(input.dbSystem)} query is one of the most expensive on the instance and I need to make it faster.`,
    "",
    "```sql",
    statement,
    "```",
    "",
    facts,
    "",
    NORMALIZED_NOTE,
    "",
    "Given these numbers, what is most likely making it slow, and what specific changes " +
      "should I make? Cover indexing, the shape of the statement itself, and whether the " +
      "calling code should run it fewer times. Rank your suggestions by expected impact " +
      "and say what each one would cost to apply.",
  ]);
};

export interface DeadlockFixPromptInput {
  /** Both conflicting statements, normalized. */
  queries: string[];
  dbSystem?: string | null;
  dbInstance?: string | null;
  /** The table(s) the two sides fought over. */
  objects?: string[];
  /** The two statements touch one object's rows in opposite order. */
  oppositeRowOrder?: boolean;
  /** Deadlocks matching this pair in the window. */
  count?: number | null;
  /** Typical gap between recurrences, seconds. */
  cadenceSeconds?: number | null;
  /** Applications/sessions on each side. */
  applications?: string[];
}

/**
 * "How do I stop this deadlock" — answerable because a deadlock has a known
 * fix shape (consistent lock ordering), and the evidence for or against it is
 * on the row: whether the two statements touch the same rows in opposite order.
 */
export const buildDeadlockFixPrompt = (input: DeadlockFixPromptInput): string => {
  const statements = (input.queries ?? [])
    .map((query) => oneLine(query))
    .filter(Boolean)
    .map((query, index) => ["```sql", `-- session ${index + 1}`, query, "```"].join("\n"));

  const facts = joinLines([
    fact("Engine", engineName(input.dbSystem)),
    fact("Instance", input.dbInstance),
    input.objects?.length ? fact("Contested objects", input.objects.join(", ")) : null,
    input.applications?.length
      ? fact("Applications involved", input.applications.join(", "))
      : null,
    input.count == null ? null : fact("Deadlocks in the window", formatCount(input.count)),
    input.cadenceSeconds == null
      ? null
      : fact("Recurring roughly every", `${input.cadenceSeconds}s`),
    fact(
      "Opposite row order detected",
      input.oppositeRowOrder
        ? "yes — the two statements touch the same object's rows in opposite order"
        : "no — the row ordering evidence is inconclusive",
    ),
  ]);

  return joinLines([
    `Two sessions on this ${engineName(input.dbSystem)} instance deadlocked against each other and the database cancelled one of them.`,
    "",
    ...statements,
    "",
    facts,
    "",
    NORMALIZED_NOTE,
    "",
    "How do I stop this deadlock from recurring? Tell me whether a consistent lock " +
      "ordering fixes it here, what that ordering should be for these two statements, " +
      "and what else to change if ordering alone is not enough — transaction scope, " +
      "isolation level, or retry handling.",
  ]);
};

export interface BlockingFixPromptInput {
  /** The root blocker's last statement, normalized. */
  query?: string | null;
  dbSystem?: string | null;
  dbInstance?: string | null;
  /** The root's backend pid / thread id. */
  pid?: number | null;
  application?: string | null;
  /** How long the root has been idle in transaction, seconds. */
  idleSeconds?: number | null;
  /** Sessions stuck behind it. */
  blockingCount?: number | null;
  /** The longest wait behind this root, seconds. */
  longestWaitSeconds?: number | null;
}

/**
 * "Why is this blocking" — asked ONLY on the root of the chain. Every other row
 * is a victim, and asking the model about a victim invites advice aimed at the
 * wrong session.
 */
export const buildBlockingFixPrompt = (input: BlockingFixPromptInput): string => {
  const statement = oneLine(input.query);
  const facts = joinLines([
    fact("Engine", engineName(input.dbSystem)),
    fact("Instance", input.dbInstance),
    input.pid == null ? null : fact("Session", `pid ${input.pid}`),
    fact("Application", input.application),
    input.blockingCount == null
      ? null
      : fact("Sessions stuck behind it", formatCount(input.blockingCount)),
    input.longestWaitSeconds == null
      ? null
      : fact("Longest wait behind it", `${Math.round(input.longestWaitSeconds)}s`),
    input.idleSeconds == null
      ? null
      : fact(
          "Idle in transaction for",
          `${Math.round(input.idleSeconds)}s — it holds locks but is running nothing`,
        ),
  ]);

  return joinLines([
    `One session on this ${engineName(input.dbSystem)} instance is at the root of a lock-wait chain: nothing is blocking it, and everything else is waiting behind it.`,
    "",
    statement
      ? ["```sql", "-- the root session's last statement", statement, "```"].join("\n")
      : "",
    "",
    facts,
    "",
    statement ? NORMALIZED_NOTE : "",
    "",
    "Why would this session be holding locks and blocking the others, and what should I " +
      "do about it right now versus permanently? Cover whether terminating it is safe, " +
      "what in the application would leave a transaction open like this, and which " +
      "timeout or transaction-scope settings would stop it happening again.",
  ]);
};
