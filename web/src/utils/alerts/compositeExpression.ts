// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Front-end parser for a composite alert's boolean term expression.
 *
 * Mirrors the enterprise back-end grammar (recursive-descent, precedence
 * `!` > `&&` > `||`, C-style) so authors get live validation before saving.
 * The back-end is the source of truth; this only surfaces errors early.
 *
 * Grammar:
 *   or   := and ( "||" and )*
 *   and  := not ( "&&" not )*
 *   not  := "!" not | atom
 *   atom := ident | "(" or ")"
 */

export interface CompositeExpressionResult {
  /** Whether the expression parses. */
  valid: boolean;
  /** A human-readable error, when `valid` is false. */
  error: string | null;
  /** Distinct term identifiers referenced by the expression, in first-seen order. */
  referencedTerms: string[];
}

type Tok =
  | { kind: "ident"; value: string }
  | { kind: "and" }
  | { kind: "or" }
  | { kind: "not" }
  | { kind: "lparen" }
  | { kind: "rparen" };

const isIdentChar = (c: string) => /[a-zA-Z0-9_]/.test(c);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
    } else if (c === "(") {
      toks.push({ kind: "lparen" });
      i += 1;
    } else if (c === ")") {
      toks.push({ kind: "rparen" });
      i += 1;
    } else if (c === "!") {
      toks.push({ kind: "not" });
      i += 1;
    } else if (c === "&") {
      if (input[i + 1] === "&") {
        toks.push({ kind: "and" });
        i += 2;
      } else {
        throw new Error("Use '&&' for AND");
      }
    } else if (c === "|") {
      if (input[i + 1] === "|") {
        toks.push({ kind: "or" });
        i += 2;
      } else {
        throw new Error("Use '||' for OR");
      }
    } else if (isIdentChar(c)) {
      let start = i;
      while (i < input.length && isIdentChar(input[i])) i += 1;
      toks.push({ kind: "ident", value: input.slice(start, i) });
    } else {
      throw new Error(`Unexpected character '${c}'`);
    }
  }
  return toks;
}

class Parser {
  private pos = 0;
  private referenced: string[] = [];

  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private next(): Tok | undefined {
    return this.toks[this.pos++];
  }

  parse(): string[] {
    const _ = this.parseOr();
    if (this.pos !== this.toks.length) {
      throw new Error("Unexpected trailing input");
    }
    return this.referenced;
  }

  private parseOr(): void {
    this.parseAnd();
    while (this.peek()?.kind === "or") {
      this.next();
      this.parseAnd();
    }
  }

  private parseAnd(): void {
    this.parseNot();
    while (this.peek()?.kind === "and") {
      this.next();
      this.parseNot();
    }
  }

  private parseNot(): void {
    if (this.peek()?.kind === "not") {
      this.next();
      this.parseNot();
    } else {
      this.parseAtom();
    }
  }

  private parseAtom(): void {
    const tok = this.next();
    if (!tok) throw new Error("Unexpected end of expression");
    if (tok.kind === "ident") {
      if (!this.referenced.includes(tok.value)) this.referenced.push(tok.value);
      return;
    }
    if (tok.kind === "lparen") {
      this.parseOr();
      const close = this.next();
      if (!close || close.kind !== "rparen") {
        throw new Error("Missing closing ')'");
      }
      return;
    }
    throw new Error("Expected a term name or '('");
  }
}

/**
 * Parses and validates a composite expression against the set of defined term
 * names. Returns validity, a first error message, and the referenced terms.
 */
export function validateCompositeExpression(
  expression: string,
  definedTermNames: string[],
): CompositeExpressionResult {
  const trimmed = (expression || "").trim();
  if (!trimmed) {
    return { valid: false, error: "Expression is required", referencedTerms: [] };
  }
  let referencedTerms: string[];
  try {
    const toks = tokenize(trimmed);
    referencedTerms = new Parser(toks).parse();
  } catch (e: any) {
    return { valid: false, error: e.message || "Invalid expression", referencedTerms: [] };
  }

  // Every referenced identifier must be a defined term (referencing a query
  // that doesn't exist is a real error).
  const undefinedRef = referencedTerms.find((r) => !definedTermNames.includes(r));
  if (undefinedRef) {
    return {
      valid: false,
      error: `Unknown term '${undefinedRef}'`,
      referencedTerms,
    };
  }
  // NOTE: we intentionally do NOT flag a defined query that isn't referenced in
  // the expression — that's the author's choice while editing, not an error to
  // nag about. (The back-end still requires all queries to be referenced; if a
  // query is left out we keep it in sync so the save stays valid — see
  // CompositeAlert add/remove handling.)

  return { valid: true, error: null, referencedTerms };
}
