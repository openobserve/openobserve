// Copyright 2026 OpenObserve Inc.

// A rule compiles to an exact predicate or refuses with a reason; a half-running detection is worse than none.

import type { SigmaRule, SigmaSearch } from "./types";
import type { ConditionNode } from "./condition";
import { expandPattern, parseCondition } from "./condition";
import { FieldIndex } from "../fields";
import { quoteIdent, quoteString } from "../sql";

export interface CompileOptions {
  /** Sigma field name to stream column, for sources that spell things differently. */
  fieldMap?: Record<string, string>;
  /** Columns the stream has. When given, rules naming anything else are refused. */
  availableFields?: string[];
  /** Columns a bare-string (keyword) search looks in. */
  keywordFields?: string[];
  /** Only mapped fields exist; in another schema (OCSF) a same-named column means something else. */
  strictFieldMap?: boolean;
}

export interface CompiledSigma {
  /** The predicate, suitable for a WHERE clause. Empty when not runnable. */
  where: string;
  runnable: boolean;
  /** Constructs this backend refuses, named so the UI can explain the refusal. */
  unsupported: string[];
  /** Fields the stream lacks, folded away as never-present; the rule still ran under that assumption. */
  assumedAbsent: string[];
  fields: string[];
  /** Set when the rule is malformed rather than merely unsupported. */
  error?: string;
}

// Absent-field tests fold to exact constants, so an optional filter on a missing field does not sink the rule.
const TRUE = "TRUE";
const FALSE = "FALSE";

/** Modifiers this backend implements. Anything else is refused by name. */
const SUPPORTED_MODIFIERS = new Set([
  "contains",
  "startswith",
  "endswith",
  "all",
  "re",
  "i",
  "cidr",
  "lt",
  "lte",
  "gt",
  "gte",
  "exists",
  "windash",
  "fieldref",
  "base64offset",
]);

const IPV4_OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";

/** `%` and `_` are LIKE metacharacters; a literal one has to be escaped. */
const escapeLikeLiteral = (char: string) =>
  char === "%" || char === "_" || char === "\\" ? `\\${char}` : char;

/** Sigma `*`/`?` wildcards onto LIKE; a backslash before anything else stays literal (Windows paths). */
function toLikePattern(value: string): { pattern: string; hasWildcard: boolean } {
  let pattern = "";
  let hasWildcard = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\") {
      const following = value[index + 1];
      if (following === "*" || following === "?" || following === "\\") {
        pattern += escapeLikeLiteral(following);
        index += 1;
      } else {
        pattern += escapeLikeLiteral("\\");
      }
      continue;
    }
    if (char === "*") {
      pattern += "%";
      hasWildcard = true;
      continue;
    }
    if (char === "?") {
      pattern += "_";
      hasWildcard = true;
      continue;
    }
    pattern += escapeLikeLiteral(char);
  }
  return { pattern, hasWildcard };
}

/** The literal a Sigma string means once its escapes are resolved. */
function unescapeSigma(value: string): string {
  return value.replace(/\\([*?\\])/g, "$1");
}

/** `-Enc` and `/Enc` are one PowerShell flag; Unicode dashes are added because attackers use them to dodge rules. */
function windashVariants(value: string): string[] {
  const dashes = ["-", "/", "–", "—", "―"];
  // Not anchored at position zero: rules are usually written as ' -enc ' with surrounding spaces.
  const flagDash = /(^|\s)[-/–—―](?=\S)/g;
  if (value.search(flagDash) === -1) return [value];
  return dashes.map((dash) => value.replace(flagDash, `$1${dash}`));
}

/** Octet prefix plus a numeric range so /17 is exact; IPv6 is refused since its text form is not unique. */
function cidrPredicate(identifier: string, value: string): string | null {
  const [address, bitsText, extra] = value.split("/");
  const bits = Number(bitsText);
  if (!address || extra !== undefined || !Number.isInteger(bits)) return null;
  if (address.includes(":")) return null;
  const octets = address.split(".").map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : NaN));
  if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255))) return null;
  if (bits < 0 || bits > 32) return null;

  const text = `CAST(${identifier} AS VARCHAR)`;
  // Dotted quad of 0-255 octets, so `10.example.com` and `10.999.999.999` are not in 10.0.0.0/8.
  const shape = `re_match(${text}, '^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$')`;
  if (bits === 0) return shape;
  const whole = Math.floor(bits / 8);
  const rest = bits % 8;
  const kept = octets.slice(0, whole).join(".");
  if (whole === 4) return `${text} = ${quoteString(kept)}`;
  const parts = [shape];
  if (whole) parts.push(`${text} LIKE ${quoteString(`${kept}.%`)}`);
  if (rest) {
    const low = octets[whole] & (0xff << (8 - rest)) & 0xff;
    const high = low + (1 << (8 - rest)) - 1;
    const octet = `TRY_CAST(split_part(${text}, '.', ${whole + 1}) AS INT)`;
    parts.push(`${octet} BETWEEN ${low} AND ${high}`);
  }
  return `(${parts.join(" AND ")})`;
}

/** The three base64 encodings by byte offset, trimmed to stable characters, as in pySigma's base64offset. */
function base64OffsetVariants(value: string): string[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  const encode = (data: number[]) => btoa(String.fromCharCode(...data));
  const starts = [0, 2, 3];
  const ends = [0, -3, -2];
  return [0, 1, 2].map((offset) => {
    const encoded = encode([...Array(offset).fill(0x20), ...bytes]);
    const end = ends[(bytes.length + offset) % 3];
    return encoded.slice(starts[offset], end || undefined);
  });
}

/** A column read as a number whatever its stored type; text that is not one is NULL. */
const asNumber = (identifier: string) => `TRY_CAST(${identifier} AS DOUBLE)`;

interface FieldResolution {
  column: string;
  known: boolean;
  /** The SQL that reads the value: the column, or a JSON read into it. */
  sql: string;
}

class Compiler {
  readonly unsupported = new Set<string>();
  readonly assumedAbsent = new Set<string>();
  readonly fields = new Set<string>();
  error?: string;

  private readonly absentBySearch = new Map<string, string[]>();
  private absentHere: string[] = [];

  private readonly available: FieldIndex | null;
  private readonly fieldMap: Record<string, string>;
  private readonly keywordFields: string[];
  private readonly strict: boolean;

  constructor(options: CompileOptions) {
    this.strict = !!options.strictFieldMap;
    this.fieldMap = options.fieldMap ?? {};
    this.keywordFields = options.keywordFields ?? [];
    this.available = options.availableFields ? new FieldIndex(options.availableFields) : null;
  }

  /** The map wins, then the stream index, so `userIdentity.type` ends up querying `useridentity_type`. */
  resolveField(name: string): FieldResolution {
    const mapped = this.fieldMap[name] ?? this.fieldMap[name.toLowerCase()];
    const plain = (column: string, known: boolean) => ({ column, known, sql: quoteIdent(column) });
    if (this.strict && mapped === undefined) {
      this.markAbsent(name);
      return plain(name, false);
    }
    // A mapping may offer `a|b`: whichever spelling the stream actually has.
    const candidates = (mapped ?? name).split("|");
    if (!this.available) return plain(candidates[0], true);
    for (const candidate of candidates) {
      const column = this.available.resolve(candidate);
      if (column) return plain(column, true);
    }
    // Deeper than ingest flattens: read it out of the JSON column it stopped at.
    for (const candidate of candidates) {
      const nested = this.available.resolveNested(candidate);
      if (!nested) continue;
      const keys = nested.keys.map(quoteString).join(", ");
      // json_as_text, not json_get_str: the latter is NULL for numbers and booleans.
      return {
        column: nested.column,
        known: true,
        sql: `json_as_text(${quoteIdent(nested.column)}, ${keys})`,
      };
    }
    this.markAbsent(candidates[0]);
    return plain(candidates[0], false);
  }

  search(name: string, body: SigmaSearch): string | null {
    this.absentHere = [];
    const clause = this.searchBody(name, body);
    this.absentBySearch.set(name, this.absentHere);
    return clause;
  }

  private comparison(key: string, value: unknown): string | null {
    const [name, ...modifierList] = key.split("|");
    const modifiers = new Set(modifierList.map((modifier) => modifier.toLowerCase()));

    for (const modifier of modifiers) {
      if (!SUPPORTED_MODIFIERS.has(modifier)) {
        this.unsupported.add(`modifier: ${modifier}`);
        return null;
      }
    }

    const { column, known, sql } = this.resolveField(name);
    if (!known) return this.absentField(modifiers, value);
    this.fields.add(column);
    const identifier = sql;

    if (modifiers.has("exists")) {
      return value === false || value === "false"
        ? `${identifier} IS NULL`
        : `${identifier} IS NOT NULL`;
    }

    if (modifiers.has("fieldref")) {
      if (modifiers.size > 1) {
        this.unsupported.add("fieldref combined with another modifier");
        return null;
      }
      const refs = (Array.isArray(value) ? value : [value]).map((entry) => {
        const target = this.resolveField(String(entry));
        // A field the stream lacks holds no value, so nothing equals it.
        if (!target.known) return FALSE;
        this.fields.add(target.column);
        return `CAST(${identifier} AS VARCHAR) = CAST(${target.sql} AS VARCHAR)`;
      });
      return joinClauses(refs, "OR");
    }

    // A list is OR by default; the `all` modifier makes it AND.
    if (Array.isArray(value)) {
      if (!value.length) {
        this.error ??= `Field '${name}' has an empty value list`;
        return null;
      }
      const parts = value
        .map((entry) => this.scalarComparison(identifier, modifiers, entry))
        .filter((part): part is string => part !== null);
      if (!parts.length) return null;
      return joinClauses(parts, modifiers.has("all") ? "AND" : "OR");
    }

    return this.scalarComparison(identifier, modifiers, value);
  }

  /** A null or `exists: false` test on an absent field is true everywhere, so optional filters keep working. */
  private absentField(modifiers: Set<string>, value: unknown): string {
    if (modifiers.has("exists")) return value === false || value === "false" ? TRUE : FALSE;
    if (value === null || value === undefined) return TRUE;
    if (Array.isArray(value)) {
      const parts = value.map((entry) => (entry === null || entry === undefined ? TRUE : FALSE));
      return joinClauses(parts, modifiers.has("all") ? "AND" : "OR");
    }
    return FALSE;
  }

  private scalarComparison(
    identifier: string,
    modifiers: Set<string>,
    value: unknown,
  ): string | null {
    if (value === null || value === undefined) return `${identifier} IS NULL`;

    if (modifiers.has("re")) {
      // The backend's Rust regex engine cannot compile lookaround or backreferences.
      if (/\(\?<?[=!]|\\[1-9]/.test(String(value))) {
        this.unsupported.add(`re: lookaround or backreference in ${String(value)}`);
        return null;
      }
      const pattern = modifiers.has("i") ? `(?i)${String(value)}` : String(value);
      return `re_match(CAST(${identifier} AS VARCHAR), ${quoteString(pattern)})`;
    }

    if (modifiers.has("cidr")) {
      const predicate = cidrPredicate(identifier, String(value));
      if (predicate === null) {
        this.unsupported.add(`cidr: ${String(value)}`);
        return null;
      }
      return predicate;
    }

    if (modifiers.has("base64offset")) {
      if (!modifiers.has("contains")) {
        this.unsupported.add("base64offset without contains");
        return null;
      }
      const variants = base64OffsetVariants(String(value)).map(
        // Base64 is case-sensitive, so these compare exactly.
        (variant) =>
          `CAST(${identifier} AS VARCHAR) LIKE ${quoteString(`%${toLikePattern(variant).pattern}%`)}`,
      );
      return joinClauses(variants, "OR");
    }

    for (const [modifier, operator] of [
      ["lt", "<"],
      ["lte", "<="],
      ["gt", ">"],
      ["gte", ">="],
    ] as const) {
      if (!modifiers.has(modifier)) continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        this.unsupported.add(`${modifier} on a non-numeric value`);
        return null;
      }
      return `${asNumber(identifier)} ${operator} ${numeric}`;
    }

    if (typeof value === "boolean") return `${identifier} = ${value}`;
    // TRY_CAST: `col = 2` on a text column is a cast error and lower() on an integer column a function error.
    const textual = ["contains", "startswith", "endswith", "windash"].some((m) => modifiers.has(m));
    if (typeof value === "number" && !textual) return `${asNumber(identifier)} = ${value}`;

    const text = String(value);
    if (modifiers.has("windash")) {
      const parts = windashVariants(text).map((variant) =>
        this.stringComparison(identifier, modifiers, variant),
      );
      return joinClauses(parts, "OR");
    }
    return this.stringComparison(identifier, modifiers, text);
  }

  private stringComparison(identifier: string, modifiers: Set<string>, text: string): string {
    const contains = modifiers.has("contains");
    const startswith = modifiers.has("startswith");
    const endswith = modifiers.has("endswith");
    const { pattern, hasWildcard } = toLikePattern(text);
    // lower() on an integer column is a function error, so the column is read as text first.
    const column = `lower(CAST(${identifier} AS VARCHAR))`;

    if (!contains && !startswith && !endswith && !hasWildcard) {
      return `${column} = ${quoteString(unescapeSigma(text).toLowerCase())}`;
    }
    const prefix = contains || endswith ? "%" : "";
    const suffix = contains || startswith ? "%" : "";
    return `${column} LIKE ${quoteString(`${prefix}${pattern}${suffix}`.toLowerCase())}`;
  }

  /** A bare string in a search list: look for it anywhere in the event text. */
  private keyword(value: string | number): string | null {
    if (!this.keywordFields.length) {
      this.unsupported.add("keyword search (stream has no full-text field)");
      return null;
    }
    const { pattern } = toLikePattern(String(value));
    // Keyword columns bypass the field map, and a missing one is skipped: the list is a set of guesses.
    const columns = this.keywordFields
      .map((field) => (this.available ? this.available.resolve(field) : field))
      .filter((column, i, all): column is string => !!column && all.indexOf(column) === i);
    if (!columns.length) {
      this.unsupported.add("keyword search (stream has no full-text field)");
      return null;
    }
    const parts = columns.map((column) => {
      this.fields.add(column);
      return `lower(CAST(${quoteIdent(column)} AS VARCHAR)) LIKE ${quoteString(`%${pattern}%`.toLowerCase())}`;
    });
    return joinClauses(parts, "OR");
  }

  private searchBody(name: string, body: SigmaSearch): string | null {
    if (body === null || body === undefined) {
      this.error ??= `Search '${name}' is empty`;
      return null;
    }

    if (Array.isArray(body)) {
      if (!body.length) {
        this.error ??= `Search '${name}' is empty`;
        return null;
      }
      const parts = body
        .map((entry) =>
          entry !== null && typeof entry === "object"
            ? this.map(name, entry as Record<string, unknown>)
            : this.keyword(entry as string | number),
        )
        .filter((part): part is string => part !== null);
      // Every alternative refused leaves nothing to run; the refusals are already recorded.
      if (!parts.length) return null;
      return joinClauses(parts, "OR");
    }

    if (typeof body === "object") return this.map(name, body as Record<string, unknown>);

    this.error ??= `Search '${name}' is neither a map nor a list`;
    return null;
  }

  private map(name: string, entries: Record<string, unknown>): string | null {
    if (!Object.keys(entries).length) {
      this.error ??= `Search '${name}' is empty`;
      return null;
    }
    const parts: string[] = [];
    for (const [key, value] of Object.entries(entries)) {
      const part = this.comparison(key, value);
      // Every map entry is required, so the map is refused rather than narrowed.
      if (part === null) return null;
      parts.push(part);
    }
    return joinClauses(parts, "AND");
  }

  /** The condition tree, with each identifier already compiled. */
  condition(
    node: ConditionNode,
    clauses: Map<string, string | null>,
    names: string[],
    negated = false,
  ): string | null {
    switch (node.type) {
      case "identifier": {
        if (!clauses.has(node.name)) {
          this.error ??= `Condition refers to '${node.name}', which is not defined`;
          return null;
        }
        this.refuseNegatedAbsent([node.name], negated);
        return clauses.get(node.name) ?? null;
      }
      case "quantifier": {
        const targets = expandPattern(node.pattern, names);
        if (!targets.length) {
          this.error ??= `Condition's '${node.pattern}' matches no search identifier`;
          return null;
        }
        this.refuseNegatedAbsent(targets, negated);
        const parts = targets
          .map((target) => clauses.get(target) ?? null)
          .filter((part): part is string => part !== null);
        if (parts.length !== targets.length) return null;
        if (node.count === "all") return joinClauses(parts, "AND");
        if (node.count === 1) return joinClauses(parts, "OR");
        // "N of them" is a count, not a boolean, so it becomes one.
        const sum = parts.map((part) => `CASE WHEN ${part} THEN 1 ELSE 0 END`).join(" + ");
        return `(${sum}) >= ${node.count}`;
      }
      case "not": {
        const operand = this.condition(node.operand, clauses, names, !negated);
        return operand === null ? null : negate(operand);
      }
      default: {
        const parts = node.operands.map((operand) =>
          this.condition(operand, clauses, names, negated),
        );
        if (parts.some((part) => part === null)) return null;
        return joinClauses(parts as string[], node.type === "and" ? "AND" : "OR");
      }
    }
  }

  private markAbsent(name: string) {
    this.assumedAbsent.add(name);
    this.absentHere.push(name);
  }

  /** Negated, a fold for an absent field turns an exclusion into a pass; the field may exist under another name. */
  private refuseNegatedAbsent(searches: string[], negated: boolean) {
    if (!negated) return;
    for (const search of searches) {
      for (const field of this.absentBySearch.get(search) ?? []) {
        this.unsupported.add(`not over absent field '${field}': cannot prove the exclusion`);
      }
    }
  }
}

/** Folding lets a rule that can never fire collapse to FALSE, where it can be seen and reported. */
function joinClauses(parts: string[], operator: "AND" | "OR"): string {
  const dominant = operator === "AND" ? FALSE : TRUE;
  const neutral = operator === "AND" ? TRUE : FALSE;
  if (parts.includes(dominant)) return dominant;

  const kept = parts.filter((part) => part !== neutral);
  if (!kept.length) return neutral;
  if (kept.length === 1) return kept[0];
  return `(${kept.join(` ${operator} `)})`;
}

function negate(clause: string): string {
  if (clause === TRUE) return FALSE;
  if (clause === FALSE) return TRUE;
  // A NULL comparison is NULL, not false, so a plain NOT would drop rows; COALESCE restores two-valued logic.
  return `NOT COALESCE(${clause}, false)`;
}

/** When nothing can run, the reason is in `unsupported`, `assumedAbsent` or `error`, never a silent no-match. */
export function compileSigmaRule(rule: SigmaRule, options: CompileOptions = {}): CompiledSigma {
  const compiler = new Compiler(options);
  const names = Object.keys(rule.searches);

  const clauses = new Map<string, string | null>();
  for (const name of names) clauses.set(name, compiler.search(name, rule.searches[name]));

  // A rule may carry several conditions, which Sigma reads as alternatives.
  const branches: string[] = [];
  for (const expression of rule.condition) {
    const parsed = parseCondition(expression);
    parsed.unsupported.forEach((entry) => compiler.unsupported.add(entry));
    if (!parsed.node) {
      if (parsed.error) compiler.error ??= parsed.error;
      continue;
    }
    const compiled = compiler.condition(parsed.node, clauses, names);
    if (compiled !== null) branches.push(compiled);
  }

  const where = branches.length ? joinClauses(branches, "OR") : "";
  const assumedAbsent = [...compiler.assumedAbsent];
  const unsupported = [...compiler.unsupported];
  // A saved alert on a constant-TRUE predicate would fire on every event.
  if (where === TRUE) compiler.error ??= "Rule matches every row";

  return {
    where,
    // FALSE is a compiled predicate, but it is not a detection.
    runnable:
      !!where && where !== FALSE && where !== TRUE && !unsupported.length && !compiler.error,
    unsupported,
    assumedAbsent,
    fields: [...compiler.fields],
    error: compiler.error,
  };
}
