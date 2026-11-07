// Copyright 2026 OpenObserve Inc.
//
// Starter checks for Code scorers. They ship in the web bundle (no catalog
// fetch, no provider) and import as editable Code scorers with a Boolean score
// config. Each source declares `function score(...)`; its parameter names are
// the scorer's variables, which an eval job maps to span fields.

export interface CodeScorerStarter {
  /** Scorer and score-config name on import; also the i18n key under codeScorer.starters. */
  key: string;
  source: string;
}

export const CODE_SCORER_STARTERS: CodeScorerStarter[] = [
  {
    key: "json_is_valid",
    source: `function score(output) {
  try {
    JSON.parse(output);
    return true;
  } catch (e) {
    return false;
  }
}`,
  },
  {
    key: "matches_json_schema",
    source: `// Paste your JSON Schema. Supports type, required, properties, items and enum.
const SCHEMA = {
  type: "object",
  required: ["answer"],
  properties: { answer: { type: "string" } },
};

function score(output) {
  let value;
  try {
    value = JSON.parse(output);
  } catch (e) {
    return false;
  }
  return fits(value, SCHEMA);
}

function fits(value, schema) {
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    return false;
  }
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const integer = schema.type === "integer" && Number.isInteger(value);
  if (schema.type && schema.type !== type && !integer) return false;
  if (type === "object") {
    if ((schema.required || []).some((key) => !(key in value))) return false;
    return Object.entries(schema.properties || {}).every(
      ([key, sub]) => !(key in value) || fits(value[key], sub),
    );
  }
  if (type === "array" && schema.items) return value.every((item) => fits(item, schema.items));
  return true;
}`,
  },
  {
    key: "matches_regex",
    source: `// MUST_MATCH = true: the output must match PATTERN. false: it must not.
const PATTERN = /\\b(sorry|I cannot|I can't)\\b/i;
const MUST_MATCH = false;

function score(output) {
  return PATTERN.test(String(output)) === MUST_MATCH;
}`,
  },
  {
    key: "cost_at_most",
    source: `// Passes when the cost, in US dollars, is at most LIMIT. A missing cost fails.
const LIMIT = 0.05;

function score(cost) {
  return parseFloat(cost) <= LIMIT;
}`,
  },
  {
    key: "latency_at_most",
    source: `// Passes when the duration is at most LIMIT_SECONDS. Map duration to the
// span duration field, which is in microseconds.
const LIMIT_SECONDS = 10;

function score(duration) {
  return parseFloat(duration) / 1e6 <= LIMIT_SECONDS;
}`,
  },
  {
    key: "exact_match",
    source: `// Passes when the output equals the expected output, ignoring outer whitespace.
function score(output, expected_output) {
  return String(output).trim() === String(expected_output).trim();
}`,
  },
];

const SCORE_SIGNATURE = /function\s+score\s*\(([^)]*)\)/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Parameter names of `function score(...)`, in order, or `null` when the source
 * does not declare it with plain names. Mirrors the backend's `score_params`,
 * which rejects a scorer whose variables it cannot read.
 */
export function scoreFunctionParams(source: string): string[] | null {
  const match = SCORE_SIGNATURE.exec(source);
  if (!match) return null;
  const params = match[1]
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean);
  return params.every((param) => IDENTIFIER.test(param)) ? params : null;
}
