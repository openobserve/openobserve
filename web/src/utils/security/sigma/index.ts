// Copyright 2026 OpenObserve Inc.
//
// index.ts — the one call the UI makes into the Sigma engine.
//
// Everything above this line is deliberately unaware of OpenObserve: the parser,
// the condition grammar and the compiler take a rule and a field list and give
// back SQL. This file is where that meets a classified stream, and it answers
// the only question the Events page actually has: given this stream, which of
// the shipped detections can run against it right now, and for the ones that
// cannot, why not.
//
// That last part is the point. A rule that cannot run is shown with its reason
// rather than hidden, because "we have 40 detections and 31 of them apply to
// your data" is a useful sentence and "we have 31 detections" is not.

import type { SourceType } from "../sourceTypes";
import type { CompiledSigma } from "./compile";
import type { SigmaRule } from "./types";
import { KEYWORD_FIELDS, SIGMA_FIELD_MAPS, sigmaCatalog } from "./catalog";
import { matchesLogsource } from "./parse";
import { ocsfGuardSearch, ocsfProfileFor } from "./ocsf";
import { compileSigmaRule } from "./compile";
import { SIGMA_LEVELS } from "./types";

export interface ApplicableRule {
  rule: SigmaRule;
  compiled: CompiledSigma;
}

/** Why a rule cannot run here, in one line, or empty when it can. */
export function blockedReason(compiled: CompiledSigma): string {
  if (compiled.error) return compiled.error;
  if (compiled.unsupported.length) return `Not supported: ${compiled.unsupported.join(", ")}`;
  if (compiled.runnable) return "";
  if (compiled.assumedAbsent.length) {
    return `Cannot match: this stream has no ${compiled.assumedAbsent.join(", ")}`;
  }
  return "Rule compiled to nothing";
}

/**
 * What a runnable rule had to assume to run, or empty when it assumed nothing.
 *
 * This is a caveat, not a refusal. The rule is running and can fire; it is just
 * doing so with some of its fields known to be absent, which usually means an
 * optional filter is inert and the rule is broader here than where it was
 * written.
 */
export function caveat(compiled: CompiledSigma): string {
  if (!compiled.runnable || !compiled.assumedAbsent.length) return "";
  return `Assuming this stream never has ${compiled.assumedAbsent.join(", ")}`;
}

const levelRank = (rule: SigmaRule) =>
  rule.level ? SIGMA_LEVELS.indexOf(rule.level) : SIGMA_LEVELS.indexOf("medium");

/**
 * Every shipped rule written for this source, compiled against its real columns.
 *
 * Ordered the way a triage list should be: what can run before what cannot, and
 * within that, the severe before the routine.
 */
export function applicableRules(source: SourceType, fields: string[]): ApplicableRule[] {
  return sigmaCatalog()
    .filter((rule) => ruleAppliesTo(rule, source))
    .map((rule) => ({ rule, compiled: compileForSource(rule, source, fields) }))
    .sort((a, b) => {
      if (a.compiled.runnable !== b.compiled.runnable) return a.compiled.runnable ? -1 : 1;
      return levelRank(b.rule) - levelRank(a.rule);
    });
}

/**
 * Whether a rule was written for what this source records: its own logsource,
 * an alias the source also answers to, or, for OCSF-native data, an OCSF class
 * that carries the rule's logsource.
 */
export function ruleAppliesTo(rule: Pick<SigmaRule, "logsource">, source: SourceType): boolean {
  if (matchesLogsource(rule, source.sigma)) return true;
  if ((source.sigmaAliases ?? []).some((alias) => matchesLogsource(rule, alias))) return true;
  return source.id === "ocsf_native" && ocsfProfileFor(rule) !== null;
}

/**
 * A rule compiled against one stream of a known source: the source's field map
 * and keyword columns, or for OCSF-native data, the OCSF profile for the rule's
 * logsource with its class guard AND-ed on. This is the one compile path, so
 * the catalog, the Content page and a pasted rule all agree on what runs.
 */
export function compileForSource(
  rule: SigmaRule,
  source: SourceType | null,
  fields: string[],
): CompiledSigma {
  const keywordFields =
    (source ? KEYWORD_FIELDS[source.id] : undefined) ?? defaultKeywordFields(fields);
  const profile =
    source?.id === "ocsf_native" && !matchesLogsource(rule, source.sigma)
      ? ocsfProfileFor(rule)
      : null;
  if (!profile) {
    return compileSigmaRule(rule, {
      fieldMap: source ? SIGMA_FIELD_MAPS[source.id] : undefined,
      availableFields: fields,
      keywordFields,
    });
  }

  const compiled = compileSigmaRule(rule, {
    fieldMap: profile.fieldMap,
    availableFields: fields,
    keywordFields,
    strictFieldMap: true,
  });
  const guard = compileSigmaRule(
    {
      ...rule,
      searches: { ocsf_class: ocsfGuardSearch(profile) },
      condition: ["ocsf_class"],
    },
    { availableFields: fields },
  );
  // Without the guard columns the rule cannot be kept to its class, and running
  // it unguarded on a mixed stream would match the wrong events.
  if (!guard.runnable) {
    return {
      ...compiled,
      where: "",
      runnable: false,
      assumedAbsent: [...new Set([...guard.assumedAbsent, ...compiled.assumedAbsent])],
    };
  }
  return {
    ...compiled,
    where: compiled.where ? `(${guard.where}) AND (${compiled.where})` : "",
    fields: [...new Set([...guard.fields, ...compiled.fields])],
  };
}

/**
 * The columns a keyword search falls back to when the source has no declared
 * full-text field. Only columns the stream actually has are returned, so a
 * keyword rule is refused honestly rather than compiled against a column that
 * is not there.
 */
function defaultKeywordFields(fields: string[]): string[] {
  const candidates = ["message", "log", "msg", "body", "raw", "_raw"];
  const present = new Set(fields.map((field) => field.toLowerCase()));
  return candidates.filter((candidate) => present.has(candidate));
}

export { compileSigmaRule } from "./compile";
export { matchesLogsource, parseSigmaRule, sigmaLevelToSeverity } from "./parse";
export { catalogErrors, catalogTechniques, rulesForLogsource, sigmaCatalog } from "./catalog";
export { OCSF_SIGMA_PROFILES, ocsfProfileFor } from "./ocsf";
export { parseCondition, referencedIdentifiers } from "./condition";
export type { CompiledSigma, CompileOptions } from "./compile";
export type { SigmaLevel, SigmaLogsource, SigmaRule, SigmaStatus } from "./types";
export { SIGMA_LEVELS } from "./types";
