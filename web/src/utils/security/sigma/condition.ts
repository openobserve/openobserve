// Copyright 2026 OpenObserve Inc.

// Parsed properly: a regex approximation inverts `selection and not (filter_a or filter_b)`.

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
    // The trailing `*` is what makes `1 of selection*` work.
    const match = /^[A-Za-z0-9_*.-]+/.exec(text.slice(index));
    if (!match) return null;
    tokens.push({ value: match[0], keyword: match[0].toLowerCase() });
    index += match[0].length;
  }
  return tokens;
}

/** Errors are returned, not thrown: a malformed condition in one rule must not take the pack down. */
export function parseCondition(text: string): ConditionParseResult {
  const unsupported: string[] = [];

  let expression = text.trim();
  const pipe = expression.indexOf("|");
  if (pipe >= 0) {
    unsupported.push(`aggregation: ${expression.slice(pipe + 1).trim()}`);
    expression = expression.slice(0, pipe).trim();
  }
  // `near` correlates two searches within a timeframe: a sequence problem, not a filter.
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

    // Only a quantifier when `of` follows; a search identifier may legitimately be called `all`.
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

/** `them` is every identifier, `selection*` every identifier with that prefix (a Sigma glob, not a regex). */
export function expandPattern(pattern: string, names: string[]): string[] {
  if (pattern === "*") return [...names];
  if (!pattern.includes("*")) return names.filter((name) => name === pattern);
  const expression = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "i");
  return names.filter((name) => expression.test(name));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
