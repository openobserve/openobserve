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

import type { ComputedRef, InjectionKey } from "vue";

import { stepLabelOf, type QueryRef, type StepFacts } from "@/composables/assistant/pure";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatCount, formatElapsed, formatOrgRange } from "@/utils/formatters";

const LANGUAGE_LABELS: Record<QueryRef["language"], string> = {
  sql: "SQL",
  promql: "PromQL",
  vrl: "VRL",
  regex: "Regex",
};

const QUERY_KINDS: ReadonlySet<StepFacts["kind"]> = new Set(["query", "promql", "traces"]);

/** One answer's claim numbers by `call_id`, so prose chips and findings chips agree. */
export const claimNumbersKey: InjectionKey<ComputedRef<Map<string, number>>> =
  Symbol("claimNumbers");

/** "13:43–13:58 IST" in the org zone, minute precision. */
export function rangeText(range: { from: number; to: number }): I18nText {
  return raw(formatOrgRange(range.from, range.to));
}

/** The language as it is written everywhere: SQL, PromQL, VRL, Regex. */
export function languageLabel(language: QueryRef["language"]): I18nText {
  return raw(LANGUAGE_LABELS[language] ?? language.toUpperCase());
}

/** The explorer's own page name, as the nav shows it. */
export function explorerLabel(explorer: "logs" | "metrics" | "traces", t: TranslateFn): I18nText {
  if (explorer === "metrics") return t("common.metrics");
  if (explorer === "traces") return t("common.traces");
  return t("common.logs");
}

/** A trail row: what the step did, then its facts, composed from structured fields. */
export function stepLine(step: StepFacts, t: TranslateFn): I18nText {
  if (step.state === "running") {
    const label = stepLabelOf(step.tool, step.target ? { stream_name: step.target } : undefined);
    return t(label.key, label.params);
  }
  if (step.state === "failed") {
    const head = QUERY_KINDS.has(step.kind)
      ? t("assistant.steps.step.queryFailed")
      : t("assistant.steps.step.toolFailed", { tool: raw(step.tool) });
    return joined([head, step.error ? raw(step.error) : null]);
  }
  const verb = stepVerb(step, t);
  if (step.state === "interrupted") return joined([verb, t("assistant.steps.stoppedBeforeFinish")]);
  return joined([verb, ...stepFactsText(step, t)]);
}

/** The step's verb phrase, past tense: "Queried default", "Listed streams". */
export function stepVerb(step: StepFacts, t: TranslateFn): I18nText {
  const target = raw(step.target ?? step.query?.stream ?? "");
  switch (step.kind) {
    case "query":
      return step.target || step.query?.stream
        ? t("assistant.steps.step.queried", { stream: target })
        : t("assistant.steps.step.ranTool", { tool: raw(step.tool) });
    case "promql":
      return t("assistant.steps.step.queriedMetrics");
    case "traces":
      return t("assistant.steps.step.searchedTraces");
    case "stream_list":
      return t("assistant.steps.step.listed");
    case "schema":
      return t("assistant.steps.step.schema", { stream: target });
    case "cli":
      return t("assistant.steps.step.ran", { command: raw(step.command ?? step.tool) });
    case "create":
      return t("assistant.steps.step.created", { resource: target });
    case "update":
      return t("assistant.steps.step.updated", { resource: target });
    case "delete":
      return t("assistant.steps.step.deleted", { resource: target });
    default:
      return t("assistant.steps.step.ranTool", { tool: raw(step.tool) });
  }
}

/** The accessible name of a row: the line, then the state in words. */
export function stepName(step: StepFacts, t: TranslateFn): I18nText {
  const state =
    step.state === "running"
      ? t("assistant.step.running")
      : step.state === "failed"
        ? t("assistant.step.failed")
        : step.state === "interrupted"
          ? t("assistant.step.interrupted")
          : t("assistant.step.done");
  return t("assistant.steps.rowName", { step: stepLine(step, t), state });
}

/** The verb and window of a step, the claim chip's and a footnote's label. */
export function stepCitation(step: StepFacts, t: TranslateFn): I18nText {
  return joined([stepVerb(step, t), step.range ? rangeText(step.range) : null]);
}

function stepFactsText(step: StepFacts, t: TranslateFn): (I18nText | null)[] {
  const took = step.tookMs !== null ? raw(formatElapsed(step.tookMs)) : null;
  if (QUERY_KINDS.has(step.kind)) {
    const range = step.range ? rangeText(step.range) : t("assistant.evidence.rangeUnknown");
    const rows =
      step.rows !== null
        ? t("assistant.steps.rows", { count: formatCount(step.rows) }, step.rows)
        : null;
    return [range, rows, took];
  }
  if (step.kind === "stream_list" && step.count !== null)
    return [t("assistant.steps.streams", { count: formatCount(step.count) }, step.count), took];
  if (step.kind === "schema" && step.count !== null)
    return [t("assistant.steps.fields", { count: formatCount(step.count) }, step.count), took];
  if (step.kind === "cli") {
    const exit = step.result?.exitCode;
    const lines = step.result?.stdout
      ? step.result.stdout.split("\n").filter(Boolean).length
      : null;
    return [
      exit !== undefined ? t("assistant.steps.exit", { code: exit }) : null,
      lines !== null ? t("assistant.steps.lines", { count: formatCount(lines) }, lines) : null,
    ];
  }
  return [took];
}

// Facts are separate values of one row, never one sentence split across keys.
function joined(parts: (I18nText | null | undefined)[]): I18nText {
  return raw(parts.filter((part): part is I18nText => !!part).join(" · "));
}
