// Copyright 2026 OpenObserve Inc.
//
// compile.ts — a Sigma rule into an OpenObserve SQL predicate.
//
// This is the backend, in Sigma's sense of the word: the piece that turns a
// portable rule into a query this system can actually run. The contract it holds
// to is that a rule either compiles to a predicate that means exactly what the
// rule means, or it does not compile and says why. There is no third outcome
// where a rule half-runs, because a detection that silently matches less than it
// claims is worse than no detection at all: it produces a green dashboard.
//
// Two things drive whether a rule is runnable at all:
//
//   * Unsupported constructs. Aggregation and temporal correlation need a GROUP
//     BY or a sequence join, not a WHERE clause, so they are refused by name.
//   * Missing fields. A Sigma rule names fields in its taxonomy's spelling, not
//     the stream's. Where a mapping exists it is applied; where a field is
//     genuinely absent it is folded to a constant, since an unknown column in
//     DataFusion is a query error rather than a row that fails to match, and a
//     field no row carries has a decided truth value rather than an unknown one.
//     A rule that folds away to constant false is reported as unrunnable: it
//     cannot fire, and saying so is the difference between a detection that
//     found nothing and one that was never capable of finding anything.
//
// Matching is case-insensitive, which is Sigma's default and what analysts
// expect: a rule looking for `cmd.exe` must catch `CMD.EXE`. That costs the
// column index on string comparisons, and it is the right trade for a detection
// engine, where a miss is expensive and a scan is merely slow.

import type { SigmaRule, SigmaSearch } from "./types";
import type { ConditionNode } from "./condition";
import { expandPattern, parseCondition } from "./condition";
import { FieldIndex } from "../fields";
import { quoteString } from "../sql";

export interface CompileOptions {
  /** Sigma field name to stream column, for sources that spell things differently. */
  fieldMap?: Record<string, string>;
  /** Columns the stream has. When given, rules naming anything else are refused. */
  availableFields?: string[];
  /** Columns a bare-string (keyword) search looks in. */
  keywordFields?: string[];
  /**
   * Only fields the map names exist. Set when a rule runs on data in another
   * schema (OCSF): a Sigma name that happens to equal one of its columns
   * (`status`, `type`, `message`) means something else there.
   */
  strictFieldMap?: boolean;
}

export interface CompiledSigma {
  /** The predicate, suitable for a WHERE clause. Empty when not runnable. */
  where: string;
  /** Whether the predicate is safe to run against this stream. */
  runnable: boolean;
  /** Constructs this backend refuses, named so the UI can explain the refusal. */
  unsupported: string[];
  /**
   * Fields the rule names that the stream does not have, and which were
   * therefore folded away as never-present. The rule still ran; this is what it
   * assumed in order to do so.
   */
  assumedAbsent: string[];
  /** Stream columns the predicate touches. */
  fields: string[];
  /** Set when the rule is malformed rather than merely unsupported. */
  error?: string;
}

/**
 * Folded truth values.
 *
 * A comparison against a column the stream does not have is not unknown, it is
 * decided: no row can carry a value in a field that does not exist, so a
 * positive test is false everywhere and a null test is true everywhere.
 * Substituting the constant is exact rather than approximate, which is what lets
 * a rule survive an optional filter naming a field this stream never emits,
 * instead of being discarded whole.
 */
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

const quoteIdent = (field: string) => `"${field.replace(/"/g, '""')}"`;

/** `%` and `_` are LIKE metacharacters; a literal one has to be escaped. */
const escapeLikeLiteral = (char: string) =>
  char === "%" || char === "_" || char === "\\" ? `\\${char}` : char;

/**
 * Sigma's escape rules onto SQL LIKE.
 *
 * In Sigma, `*` and `?` are the wildcards and a backslash escapes them; a
 * backslash before anything else is just a backslash, which is what makes
 * Windows paths tolerable to write.
 */
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

/**
 * `windash` expands a command-line switch into the forms Windows accepts.
 *
 * `-Enc` and `/Enc` are the same flag to PowerShell, and the Unicode dashes are
 * there because attackers use them precisely to dodge rules that only check the
 * ASCII one.
 */
function windashVariants(value: string): string[] {
  const dashes = ["-", "/", "–", "—", "―"];
  // The dash that introduces a parameter, which is at the start of the value or
  // after a space. Rules are usually written as ' -enc ' with the surrounding
  // spaces that make the match precise, so anchoring at position zero would
  // expand almost nothing.
  const match = /(^|\s)([-/–—―])(?=\S)/.exec(value);
  if (!match) return [value];
  const at = match.index + match[1].length;
  const head = value.slice(0, at);
  const tail = value.slice(at + 1);
  return dashes.map((dash) => `${head}${dash}${tail}`);
}

/**
 * An IPv4 CIDR block as a predicate on the address text.
 *
 * The whole octets the mask keeps are a string prefix; a mask that ends inside
 * an octet adds a numeric range on that octet, so /17 or /22 is exact rather
 * than rounded to the nearest byte. IPv6 is refused: its text form can be
 * compressed several ways, so no prefix of the text is a prefix of the address.
 */
function cidrPredicate(identifier: string, value: string): string | null {
  const [address, bitsText, extra] = value.split("/");
  const bits = Number(bitsText);
  if (!address || extra !== undefined || !Number.isInteger(bits)) return null;
  if (address.includes(":")) return null;
  const octets = address.split(".").map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : NaN));
  if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255))) return null;
  if (bits < 0 || bits > 32) return null;

  // Dotted-quad shape, so `10.example.com` is not in 10.0.0.0/8 and an IPv6
  // address is in no IPv4 block.
  const shape = `re_match(CAST(${identifier} AS VARCHAR), '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$')`;
  if (bits === 0) return shape;
  const whole = Math.floor(bits / 8);
  const rest = bits % 8;
  const kept = octets.slice(0, whole).join(".");
  if (whole === 4) return `${identifier} = ${quoteString(kept)}`;
  const parts = [shape];
  if (whole) parts.push(`${identifier} LIKE ${quoteString(`${kept}.%`)}`);
  if (rest) {
    const low = octets[whole] & (0xff << (8 - rest)) & 0xff;
    const high = low + (1 << (8 - rest)) - 1;
    const octet = `TRY_CAST(split_part(CAST(${identifier} AS VARCHAR), '.', ${whole + 1}) AS INT)`;
    parts.push(`${octet} BETWEEN ${low} AND ${high}`);
  }
  return `(${parts.join(" AND ")})`;
}

/**
 * The three base64 encodings of a value, one per byte offset it could start at
 * inside a longer encoded string, trimmed to the characters that do not depend
 * on the neighbouring bytes. Same derivation as pySigma's base64offset.
 */
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
  /** The stream column the value is read from. */
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

  /**
   * A Sigma field name onto a real column.
   *
   * The explicit map wins, and then the stream's own index takes over, which
   * covers both the capitalisation Sigma and the stream disagree about and the
   * rewriting ingest applied: a rule that says `userIdentity.type` has to end up
   * querying `useridentity_type`, or it queries a column that does not exist.
   */
  resolveField(name: string): FieldResolution {
    const mapped = this.fieldMap[name] ?? this.fieldMap[name.toLowerCase()];
    const plain = (column: string, known: boolean) => ({ column, known, sql: quoteIdent(column) });
    if (this.strict && mapped === undefined) {
      this.assumedAbsent.add(name);
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
      return { column: nested.column, known: true, sql: `json_as_text(${quoteIdent(nested.column)}, ${keys})` };
    }
    this.assumedAbsent.add(candidates[0]);
    return plain(candidates[0], false);
  }

  /** One `field|modifiers: value` entry. */
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

    // A list is OR by default; `all` is the modifier that makes it AND, which is
    // how a rule says "the command line contains every one of these".
    if (Array.isArray(value)) {
      const parts = value
        .map((entry) => this.scalarComparison(identifier, modifiers, entry))
        .filter((part): part is string => part !== null);
      if (!parts.length) return null;
      return joinClauses(parts, modifiers.has("all") ? "AND" : "OR");
    }

    return this.scalarComparison(identifier, modifiers, value);
  }

  /**
   * The truth value of a comparison against a field the stream does not have.
   *
   * Positive tests are false for every row. A null or `exists: false` test is
   * true for every row, which is the case that matters: it is how a rule's
   * optional filters keep working on a stream that never emits the field they
   * exclude on.
   */
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
      const pattern = modifiers.has("i") ? `(?i)${String(value)}` : String(value);
      return `re_match(${identifier}, ${quoteString(pattern)})`;
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
        (variant) => `${identifier} LIKE ${quoteString(`%${toLikePattern(variant).pattern}%`)}`,
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
    // A bare number compares numerically, through TRY_CAST because the column
    // may hold it as text (an EventID or port shipped as a string). A bare
    // `col = 2` on a text column is a cast error, and lower() on an integer
    // column is a function error, so neither spelling is safe on its own.
    // A string modifier means the number is text to look for: `contains: 1337`.
    const textual = ["contains", "startswith", "endswith", "windash"].some((m) => modifiers.has(m));
    if (typeof value === "number" && !textual) return `${asNumber(identifier)} = ${value}`;

    const text = String(value);
    // A number under a string modifier is text to find; lower() on an integer
    // column is a function error, so the column is read as text first.
    if (typeof value === "number") identifier = `CAST(${identifier} AS VARCHAR)`;
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

    if (!contains && !startswith && !endswith && !hasWildcard) {
      return `lower(${identifier}) = ${quoteString(unescapeSigma(text).toLowerCase())}`;
    }
    const prefix = contains || endswith ? "%" : "";
    const suffix = contains || startswith ? "%" : "";
    return `lower(${identifier}) LIKE ${quoteString(`${prefix}${pattern}${suffix}`.toLowerCase())}`;
  }

  /** A bare string in a search list: look for it anywhere in the event text. */
  private keyword(value: string | number): string | null {
    if (!this.keywordFields.length) {
      this.unsupported.add("keyword search (stream has no full-text field)");
      return null;
    }
    const { pattern } = toLikePattern(String(value));
    // Keyword columns are the stream's own free text, not Sigma fields: they are
    // looked up directly (never through a field map, so the OCSF bridge does not
    // refuse them), and a candidate the stream lacks is skipped, not reported as
    // an assumption, because the list is a set of guesses by design.
    const columns = this.keywordFields
      .map((field) => (this.available ? this.available.resolve(field) : field))
      .filter((column, i, all): column is string => !!column && all.indexOf(column) === i);
    if (!columns.length) {
      this.unsupported.add("keyword search (stream has no full-text field)");
      return null;
    }
    const parts = columns.map((column) => {
      this.fields.add(column);
      return `lower(${quoteIdent(column)}) LIKE ${quoteString(`%${pattern}%`.toLowerCase())}`;
    });
    return joinClauses(parts, "OR");
  }

  /** One search identifier's body. */
  search(name: string, body: SigmaSearch): string | null {
    if (body === null || body === undefined) {
      this.error ??= `Search '${name}' is empty`;
      return null;
    }

    if (Array.isArray(body)) {
      const parts = body
        .map((entry) =>
          entry !== null && typeof entry === "object"
            ? this.map(entry as Record<string, unknown>)
            : this.keyword(entry as string | number),
        )
        .filter((part): part is string => part !== null);
      // A list of alternatives where every alternative was refused leaves
      // nothing to run; the refusals are already recorded by name.
      if (!parts.length) return null;
      return joinClauses(parts, "OR");
    }

    if (typeof body === "object") return this.map(body as Record<string, unknown>);

    this.error ??= `Search '${name}' is neither a map nor a list`;
    return null;
  }

  private map(entries: Record<string, unknown>): string | null {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(entries)) {
      const part = this.comparison(key, value);
      // Every entry in a map is required, so losing one changes what the rule
      // means. The map is refused rather than narrowed.
      if (part === null) return null;
      parts.push(part);
    }
    if (!parts.length) return null;
    return joinClauses(parts, "AND");
  }

  /** The condition tree, with each identifier already compiled. */
  condition(
    node: ConditionNode,
    clauses: Map<string, string | null>,
    names: string[],
  ): string | null {
    switch (node.type) {
      case "identifier": {
        if (!clauses.has(node.name)) {
          this.error ??= `Condition refers to '${node.name}', which is not defined`;
          return null;
        }
        return clauses.get(node.name) ?? null;
      }
      case "quantifier": {
        const targets = expandPattern(node.pattern, names);
        if (!targets.length) {
          this.error ??= `Condition's '${node.pattern}' matches no search identifier`;
          return null;
        }
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
        const operand = this.condition(node.operand, clauses, names);
        return operand === null ? null : negate(operand);
      }
      default: {
        const parts = node.operands.map((operand) => this.condition(operand, clauses, names));
        if (parts.some((part) => part === null)) return null;
        return joinClauses(parts as string[], node.type === "and" ? "AND" : "OR");
      }
    }
  }
}

/**
 * Combines clauses, folding the constants away as it goes.
 *
 * The folding is not a tidiness measure. It is how the compiler can tell the
 * difference between a rule that merely mentions an absent field and one that
 * can never fire at all: only real folding collapses the second case to FALSE
 * where it can be seen and reported.
 */
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
  // A NULL column makes a comparison NULL rather than false, so a plain NOT
  // would drop rows the rule expects to keep. COALESCE restores the two-valued
  // logic the rule was written in.
  return `NOT COALESCE(${clause}, false)`;
}

/**
 * Compiles a rule into a predicate for one stream.
 *
 * The result is always inspectable: even when nothing can run, the caller gets
 * the reason in `unsupported`, `assumedAbsent` or `error`, which is what lets
 * the Events page say "this rule needs CommandLine, which this stream does not
 * carry" instead of pretending the rule found nothing.
 */
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

  return {
    where,
    // FALSE is a compiled predicate, but it is not a detection.
    runnable: !!where && where !== FALSE && !unsupported.length && !compiler.error,
    unsupported,
    assumedAbsent,
    fields: [...compiler.fields],
    error: compiler.error,
  };
}
