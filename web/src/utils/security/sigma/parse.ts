// Copyright 2026 OpenObserve Inc.
//
// parse.ts — Sigma YAML into the rule model.
//
// Parsing is strict about the parts that decide whether a rule can run (a
// logsource, a detection block, a condition) and permissive about everything
// else, because rules come from a public corpus written by hundreds of people
// and half of the optional metadata is inconsistent in practice.
//
// A rule that cannot be parsed is returned as an error rather than thrown away.
// Silently dropping rules is how a SIEM ends up quietly running 900 detections
// when the operator believes it is running 1,000.

import yaml from "js-yaml";

import type { SigmaLevel, SigmaParseResult, SigmaRule, SigmaSearch } from "./types";
import { SIGMA_LEVELS } from "./types";

/** Sigma level onto the OCSF severity scale used everywhere else in the SIEM. */
const LEVEL_TO_SEVERITY: Record<SigmaLevel, number> = {
  informational: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

export function sigmaLevelToSeverity(level: SigmaLevel | undefined): number {
  return level ? LEVEL_TO_SEVERITY[level] : 3;
}

const asStringList = (value: unknown): string[] | undefined => {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [String(value)];
};

/**
 * Pulls ATT&CK ids out of the free-form `tags` list.
 *
 * The convention is `attack.<something>`: a technique looks like `attack.t1059`
 * or `attack.t1078.004`, anything else under that prefix is a tactic name
 * (`attack.defense_evasion`) or a group id (`attack.g0016`), which are not
 * techniques and must not be presented as such.
 */
function parseAttackTags(tags: string[] | undefined) {
  const techniques: string[] = [];
  const tactics: string[] = [];
  for (const tag of tags ?? []) {
    const lower = tag.toLowerCase();
    if (!lower.startsWith("attack.")) continue;
    const value = lower.slice("attack.".length);
    if (/^t\d{4}(\.\d{3})?$/.test(value)) {
      techniques.push(value.toUpperCase());
    } else if (!/^(g|s|ta)\d+$/.test(value)) {
      tactics.push(value);
    }
  }
  return { techniques, tactics };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses one Sigma rule.
 *
 * `js-yaml`'s default schema is used deliberately: it has no type resolution for
 * arbitrary JS objects, so a rule fetched from anywhere cannot construct
 * something unexpected during load.
 */
export function parseSigmaRule(text: string): SigmaParseResult {
  const fail = (message: string): SigmaParseResult => ({
    ok: false,
    error: { message, yaml: text },
  });

  let documents: unknown[];
  try {
    documents = yaml.loadAll(text);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Rule is not valid YAML");
  }

  // Correlation rules are written as several documents in one file. The
  // correlation half is not supported yet, so the base rule is taken and the
  // caller is not told it got something it did not ask for.
  const document = documents.find(isPlainObject);
  if (!document) return fail("Rule is empty or is not a YAML mapping");

  const title = document.title;
  if (typeof title !== "string" || !title.trim()) return fail("Rule has no title");

  const logsource = document.logsource;
  if (!isPlainObject(logsource)) return fail("Rule has no logsource");

  const detection = document.detection;
  if (!isPlainObject(detection)) return fail("Rule has no detection block");

  const rawCondition = detection.condition;
  if (rawCondition == null) return fail("Detection block has no condition");
  const condition = asStringList(rawCondition)!.filter((entry) => entry.trim());
  if (!condition.length) return fail("Detection block has an empty condition");

  // Everything in the detection block except `condition` and `timeframe` is a
  // search identifier, whatever it is named.
  const searches: Record<string, SigmaSearch> = {};
  for (const [name, value] of Object.entries(detection)) {
    if (name === "condition" || name === "timeframe") continue;
    searches[name] = value as SigmaSearch;
  }
  if (!Object.keys(searches).length) return fail("Detection block has no search identifiers");

  const tags = asStringList(document.tags);
  const { techniques, tactics } = parseAttackTags(tags);

  const level = String(document.level ?? "").toLowerCase();

  const rule: SigmaRule = {
    id: typeof document.id === "string" ? document.id : undefined,
    title: title.trim(),
    description: typeof document.description === "string" ? document.description : undefined,
    status:
      typeof document.status === "string" ? (document.status as SigmaRule["status"]) : undefined,
    author: typeof document.author === "string" ? document.author : undefined,
    date: document.date == null ? undefined : String(document.date),
    modified: document.modified == null ? undefined : String(document.modified),
    references: asStringList(document.references),
    logsource: {
      category: logsource.category == null ? undefined : String(logsource.category),
      product: logsource.product == null ? undefined : String(logsource.product),
      service: logsource.service == null ? undefined : String(logsource.service),
      definition: logsource.definition == null ? undefined : String(logsource.definition),
    },
    searches,
    condition,
    fields: asStringList(document.fields),
    falsepositives: asStringList(document.falsepositives),
    level: (SIGMA_LEVELS as readonly string[]).includes(level) ? (level as SigmaLevel) : undefined,
    tags,
    techniques,
    tactics,
    yaml: text,
  };

  return { ok: true, rule };
}

/**
 * Whether a rule was written for this stream.
 *
 * A rule constrains the triple only as far as it needs to: one that names just
 * `category: process_creation` applies to process telemetry from any product,
 * while one that also names `product: windows` does not apply to Linux. So every
 * part the RULE states must match, and every part it leaves open is free.
 */
export function matchesLogsource(
  rule: Pick<SigmaRule, "logsource">,
  stream: { category?: string; product?: string; service?: string },
): boolean {
  const parts = ["category", "product", "service"] as const;
  return parts.every((part) => {
    const want = rule.logsource[part];
    if (!want) return true;
    const have = stream[part];
    return !!have && have.toLowerCase() === want.toLowerCase();
  });
}
