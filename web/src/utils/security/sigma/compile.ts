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

export interface CompileOptions {
  /** Sigma field name to stream column, for sources that spell things differently. */
  fieldMap?: Record<string, string>;
  /** Columns the stream has. When given, rules naming anything else are refused. */
  availableFields?: string[];
  /** Columns a bare-string (keyword) search looks in. */
  keywordFields?: string[];
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
]);

const quoteIdent = (field: string) => `"${field.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

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
 * A CIDR block as a string prefix.
 *
 * Only the byte-aligned masks compile, because those are the ones where "is this
 * address in this block" is the same question as "does this text start with this
 * prefix". Anything else needs real address arithmetic and is refused rather
 * than approximated, since an approximate network match is a wrong one.
 */
function cidrPrefix(value: string): string | null {
  const [address, bitsText] = value.split("/");
  const bits = Number(bitsText);
  if (!address || !Number.isInteger(bits)) return null;
  if (address.includes(":")) return null; // IPv6 text form is not prefix-comparable
  const octets = address.split(".");
  if (octets.length !== 4 || bits % 8 !== 0 || bits < 8 || bits > 32) return null;
  const kept = octets.slice(0, bits / 8);
  return bits === 32 ? kept.join(".") : `${kept.join(".")}.`;
}

interface FieldResolution {
  column: string;
  known: boolean;
}

class Compiler {
  readonly unsupported = new Set<string>();
  readonly assumedAbsent = new Set<string>();
  readonly fields = new Set<string>();
  error?: string;

  private readonly available: FieldIndex | null;
  private readonly fieldMap: Record<string, string>;
  private readonly keywordFields: string[];

  constructor(options: CompileOptions) {
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
    const candidate = mapped ?? name;
    if (!this.available) return { column: candidate, known: true };
    const column = this.available.resolve(candidate);
    if (column) return { column, known: true };
    this.assumedAbsent.add(candidate);
    return { column: candidate, known: false };
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

    const { column, known } = this.resolveField(name);
    if (!known) return this.absentField(modifiers, value);
    this.fields.add(column);
    const identifier = quoteIdent(column);

    if (modifiers.has("exists")) {
      return value === false || value === "false"
        ? `${identifier} IS NULL`
        : `${identifier} IS NOT NULL`;
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
      const prefix = cidrPrefix(String(value));
      if (prefix === null) {
        this.unsupported.add(`cidr: ${String(value)}`);
        return null;
      }
      return `${identifier} LIKE ${quoteString(`${prefix.replace(/([%_\\])/g, "\\$1")}%`)}`;
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
      return `${identifier} ${operator} ${numeric}`;
    }

    if (typeof value === "boolean") return `${identifier} = ${value}`;
    // A bare number compares numerically. Wrapping it in lower() would ask
    // DataFusion to run a string function on an integer column, which errors.
    if (typeof value === "number") return `${identifier} = ${value}`;

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
    const parts = this.keywordFields.map((field) => {
      const { column, known } = this.resolveField(field);
      if (!known) return FALSE;
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
