// Copyright 2026 OpenObserve Inc.

// Unparseable rules are returned as errors, never dropped, so the running-rule count stays honest.

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

/** Tactics (`attack.defense_evasion`) and groups (`attack.g0016`) under `attack.` are not techniques. */
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

/** js-yaml's default schema on purpose: it cannot construct arbitrary JS objects from a fetched rule. */
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

  // Correlation rules span several documents; correlation is unsupported, so the base rule is taken.
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

  // Everything in detection except `condition` and `timeframe` is a search identifier, whatever its name.
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

/** Every logsource part the rule states must match; every part it leaves open is free. */
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
