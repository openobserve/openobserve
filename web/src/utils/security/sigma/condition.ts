// Copyright 2026 OpenObserve Inc.
//
// condition.ts — the little language in `detection.condition`.
//
// A Sigma condition is boolean logic over the search identifiers defined beside
// it, plus the quantifiers that let a rule say "any one of these twenty
// selections". It is small enough to parse properly, and parsing it properly is
// worth doing: a regex approximation gets `selection and not filter_a and not
// filter_b` right and then quietly inverts the meaning of
// `selection and not (filter_a or filter_b)`.
//
//   condition   := or
//   or          := and ( 'or' and )*
//   and         := unary ( 'and' unary )*
//   unary       := 'not' unary | primary
//   primary     := '(' or ')' | quantifier | identifier
//   quantifier  := ( number | 'any' | 'all' ) 'of' ( pattern | 'them' )
//
// Aggregation (`| count() by User > 5`) is a different kind of thing: it needs a
// GROUP BY and a threshold, not a WHERE clause. It is rejected here rather than
// half-implemented, and the caller reports the rule as needing aggregation.

export type ConditionNode =
  | { type: "identifier"; name: string }
  | { type: "quantifier"; count: number | "all"; pattern: string }
  | { type: "and"; operands: ConditionNode[] }
  | { type: "or"; operands: ConditionNode[] }
  | { type: "not"; operand: ConditionNode };

export interface ConditionParseResult {
  node: ConditionNode | null;
  /** Set when the condition is well-formed but asks for something unsupported. */
  unsupported: string[];
  error?: string;
}

const KEYWORDS = new Set(["and", "or", "not", "of", "them"]);

interface Token {
  value: string;
  /** Lower-cased when it is a keyword, so identifiers keep their real case. */
  keyword: string;
}

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ value: char, keyword: char });
      index += 1;
      continue;
    }
    // Identifiers may carry a trailing `*`, which is what makes `1 of
    // selection*` work, and Sigma names commonly use underscores and digits.
    const match = /^[A-Za-z0-9_*.-]+/.exec(text.slice(index));
    if (!match) return null;
    tokens.push({ value: match[0], keyword: match[0].toLowerCase() });
    index += match[0].length;
  }
  return tokens;
}

/**
 * Recursive descent over the token list. Errors are returned, not thrown: a
 * malformed condition in one rule of a pack must not take the pack down.
 */
export function parseCondition(text: string): ConditionParseResult {
  const unsupported: string[] = [];

  let expression = text.trim();
  const pipe = expression.indexOf("|");
  if (pipe >= 0) {
    unsupported.push(`aggregation: ${expression.slice(pipe + 1).trim()}`);
    expression = expression.slice(0, pipe).trim();
  }
  // `near` correlates two searches within a timeframe, which is a sequence
  // problem rather than a filter.
  if (/\bnear\b/i.test(expression)) {
    return { node: null, unsupported: ["temporal correlation (near)"], error: undefined };
  }

  const tokens = tokenize(expression);
  if (!tokens)
    return { node: null, unsupported, error: "Condition contains unexpected characters" };
  if (!tokens.length) return { node: null, unsupported, error: "Condition is empty" };

  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  let failure: string | undefined;
  const fail = (message: string): null => {
    failure ??= message;
    return null;
  };

  function parseOr(): ConditionNode | null {
    const operands: ConditionNode[] = [];
    const first = parseAnd();
    if (!first) return null;
    operands.push(first);
    while (peek()?.keyword === "or") {
      next();
      const operand = parseAnd();
      if (!operand) return null;
      operands.push(operand);
    }
    return operands.length === 1 ? operands[0] : { type: "or", operands };
  }

  function parseAnd(): ConditionNode | null {
    const operands: ConditionNode[] = [];
    const first = parseUnary();
    if (!first) return null;
    operands.push(first);
    while (peek()?.keyword === "and") {
      next();
      const operand = parseUnary();
      if (!operand) return null;
      operands.push(operand);
    }
    return operands.length === 1 ? operands[0] : { type: "and", operands };
  }

  function parseUnary(): ConditionNode | null {
    if (peek()?.keyword === "not") {
      next();
      const operand = parseUnary();
      return operand && { type: "not", operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): ConditionNode | null {
    const token = next();
    if (!token) return fail("Condition ended unexpectedly");

    if (token.keyword === "(") {
      const inner = parseOr();
      if (!inner) return null;
      if (next()?.keyword !== ")") return fail("Unbalanced parentheses in condition");
      return inner;
    }
    if (token.keyword === ")") return fail("Unbalanced parentheses in condition");
    if (KEYWORDS.has(token.keyword)) return fail(`Unexpected '${token.value}' in condition`);

    // A quantifier is only a quantifier when `of` follows; a search identifier
    // is genuinely allowed to be called `all`.
    if (peek()?.keyword === "of") {
      const count = quantifierCount(token.keyword);
      if (count === null) return fail(`Unexpected '${token.value}' before 'of'`);
      next();
      const target = next();
      if (!target) return fail("Condition ended after 'of'");
      if (target.keyword === "them") return { type: "quantifier", count, pattern: "*" };
      if (KEYWORDS.has(target.keyword) || target.keyword === "(" || target.keyword === ")") {
        return fail(`Unexpected '${target.value}' after 'of'`);
      }
      return { type: "quantifier", count, pattern: target.value };
    }

    return { type: "identifier", name: token.value };
  }

  function quantifierCount(keyword: string): number | "all" | null {
    if (keyword === "all") return "all";
    if (keyword === "any") return 1;
    const count = Number(keyword);
    return Number.isInteger(count) && count > 0 ? count : null;
  }

  const node = parseOr();
  if (!node) return { node: null, unsupported, error: failure ?? "Condition could not be parsed" };
  if (position < tokens.length) {
    return {
      node: null,
      unsupported,
      error: `Unexpected '${tokens[position].value}' in condition`,
    };
  }
  return { node, unsupported };
}

/**
 * Expands a quantifier's target into the identifiers it covers.
 *
 * `them` is every identifier, `selection*` is every identifier with that prefix.
 * The pattern is a Sigma glob, not a regex, and in practice it is always either
 * a bare name or a name with a trailing star.
 */
export function expandPattern(pattern: string, names: string[]): string[] {
  if (pattern === "*") return [...names];
  if (!pattern.includes("*")) return names.filter((name) => name === pattern);
  const expression = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "i");
  return names.filter((name) => expression.test(name));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every search identifier a condition refers to, quantifiers expanded. */
export function referencedIdentifiers(node: ConditionNode, names: string[]): string[] {
  const found = new Set<string>();
  const walk = (current: ConditionNode) => {
    switch (current.type) {
      case "identifier":
        found.add(current.name);
        break;
      case "quantifier":
        expandPattern(current.pattern, names).forEach((name) => found.add(name));
        break;
      case "not":
        walk(current.operand);
        break;
      default:
        current.operands.forEach(walk);
    }
  };
  walk(node);
  return [...found];
}
