// Copyright 2026 OpenObserve Inc.

// A rule that cannot run is shown with its reason rather than hidden.

import type { SourceType } from "../sourceTypes";
import type { CompiledSigma } from "./compile";
import type { SigmaRule } from "./types";
import { KEYWORD_FIELDS, SIGMA_FIELD_MAPS, sigmaCatalog } from "./catalog";
import { matchesLogsource } from "./parse";
import { ocsfGuardSearch, ocsfProfileFor } from "./ocsf";
import { compileSigmaRule } from "./compile";
import { SIGMA_LEVELS } from "./types";
import { gt, raw, type I18nText } from "@/types/i18n";

export interface ApplicableRule {
  rule: SigmaRule;
  compiled: CompiledSigma;
}

/** Why a rule cannot run here, in one line, or empty when it can. */
export function blockedReason(compiled: CompiledSigma): I18nText {
  if (compiled.error) return raw(compiled.error);
  if (compiled.unsupported.length) {
    return gt("siem.sigma.notSupported", { fields: compiled.unsupported.join(", ") });
  }
  if (compiled.runnable) return raw("");
  if (compiled.assumedAbsent.length) {
    return gt("siem.sigma.cannotMatch", { fields: compiled.assumedAbsent.join(", ") });
  }
  return gt("siem.sigma.compiledEmpty");
}

/** Fields a runnable rule assumed absent; an optional filter is then inert and the rule is broader here. */
export function caveat(compiled: CompiledSigma): I18nText {
  if (!compiled.runnable || !compiled.assumedAbsent.length) return raw("");
  return gt("siem.sigma.assumedAbsent", { fields: compiled.assumedAbsent.join(", ") });
}

const levelRank = (rule: SigmaRule) =>
  rule.level ? SIGMA_LEVELS.indexOf(rule.level) : SIGMA_LEVELS.indexOf("medium");

/** Shipped rules for this source: runnable before blocked, then severe before routine. */
export function applicableRules(source: SourceType, fields: string[]): ApplicableRule[] {
  return sigmaCatalog()
    .filter((rule) => ruleAppliesTo(rule, source))
    .map((rule) => ({ rule, compiled: compileForSource(rule, source, fields) }))
    .sort((a, b) => {
      if (a.compiled.runnable !== b.compiled.runnable) return a.compiled.runnable ? -1 : 1;
      return levelRank(b.rule) - levelRank(a.rule);
    });
}

/** Own logsource, a source alias, or for OCSF-native data an OCSF class carrying the rule's logsource. */
export function ruleAppliesTo(rule: Pick<SigmaRule, "logsource">, source: SourceType): boolean {
  if (matchesLogsource(rule, source.sigma)) return true;
  if ((source.sigmaAliases ?? []).some((alias) => matchesLogsource(rule, alias))) return true;
  return source.id === "ocsf_native" && ocsfProfileFor(rule) !== null;
}

/** The one compile path, so the catalog, the Content page and a pasted rule all agree on what runs. */
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
  // Unguarded on a mixed stream the rule would match the wrong events.
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

/** Only columns the stream has, so a keyword rule is refused rather than compiled against a missing column. */
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
