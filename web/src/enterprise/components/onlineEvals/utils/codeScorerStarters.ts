// Copyright 2026 OpenObserve Inc.
// Starters ship in the web bundle so they import without a catalog fetch or provider; score()'s parameter names are the variables a job maps.

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

const SCORE_SIGNATURE = /^function\s+score\s*\(([^)]*)\)/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const IDENT_CHAR = /[\w$]/;
/** A `/` after one of these opens a regex literal rather than a division. */
const REGEX_PREFIX = "(,=:[!&|?{};+-*%<>~^";
/** Keywords that take an expression, so a `/` after one opens a regex literal. */
const REGEX_KEYWORDS: Record<string, true> = {
  return: true,
  typeof: true,
  case: true,
  do: true,
  else: true,
  in: true,
  of: true,
  new: true,
  delete: true,
  void: true,
  throw: true,
  instanceof: true,
  yield: true,
  await: true,
};

/** Whether the `/` at `i` opens a regex literal rather than a division. */
function opensRegex(source: string, i: number, prev: string | null): boolean {
  if (prev === null || REGEX_PREFIX.includes(prev)) return true;
  if (!IDENT_CHAR.test(prev)) return false;
  const word = /[\w$]+$/.exec(source.slice(0, i).trimEnd());
  return word !== null && REGEX_KEYWORDS[word[0]] === true;
}

/** The index just past the string, template or regex literal opened at `start`. */
function skipLiteral(source: string, start: number, quote: string): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === "\n" && quote !== "`") return i + 1;
    else if (c === "[" && quote === "/") inClass = true;
    else if (c === "]" && quote === "/") inClass = false;
    else if (c === quote && !inClass) return i + 1;
  }
  return source.length;
}

/** Mirrors the backend's `score_signature` (scorers/code.rs). */
function scoreSignature(source: string): string | null {
  let depth = 0;
  let last: string | null = null;
  let prev: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i = skipLiteral(source, i, c);
      prev = c;
      continue;
    }
    if (c === "/" && opensRegex(source, i, prev)) {
      i = skipLiteral(source, i, "/");
      prev = "/";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "f" && depth === 0 && (i === 0 || !IDENT_CHAR.test(source[i - 1]))) {
      const match = SCORE_SIGNATURE.exec(source.slice(i));
      if (match) {
        last = match[1];
        i += match[0].length;
        prev = ")";
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return last;
}

/** Mirrors the backend's `score_params`, which rejects names it cannot read. */
export function scoreFunctionParams(source: string): string[] | null {
  const signature = scoreSignature(source);
  if (signature === null) return null;
  const params = signature
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean);
  return params.every((param) => IDENTIFIER.test(param)) ? params : null;
}
