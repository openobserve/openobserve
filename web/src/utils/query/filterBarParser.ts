// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  emptyFilterGroup,
  newFilterId,
  type FilterCondition,
  type FilterConnector,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";

type TokenKind = "ident" | "string" | "number" | "op" | "lparen" | "rparen" | "comma";

interface Token {
  kind: TokenKind;
  text: string;
}

const COMPARISON: Record<string, FilterOperatorId> = {
  "=": "eq",
  "==": "eq",
  "!=": "neq",
  "<>": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

const FUNCTION_OPERATORS: Record<string, FilterOperatorId> = {
  str_match: "contains",
  str_match_ignore_case: "contains_ci",
  re_match: "regex",
  re_not_match: "not_regex",
};

const TOKEN_PATTERN =
  /\s*(?:('(?:[^']|'')*')|("(?:[^"]|"")*")|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\b|(>=|<=|!=|<>|==|=|>|<)|(\()|(\))|(,)|([A-Za-z_@][\w.@-]*))/y;

const tokenize = (text: string): Token[] | null => {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  while (TOKEN_PATTERN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN_PATTERN.lastIndex))) break;
    const match = TOKEN_PATTERN.exec(text);
    if (!match) return null;
    const [, str, quoted, num, op, lparen, rparen, comma, ident] = match;
    if (str !== undefined)
      tokens.push({ kind: "string", text: str.slice(1, -1).replace(/''/g, "'") });
    else if (quoted !== undefined)
      tokens.push({ kind: "ident", text: quoted.slice(1, -1).replace(/""/g, '"') });
    else if (num !== undefined) tokens.push({ kind: "number", text: num });
    else if (op !== undefined) tokens.push({ kind: "op", text: op });
    else if (lparen !== undefined) tokens.push({ kind: "lparen", text: "(" });
    else if (rparen !== undefined) tokens.push({ kind: "rparen", text: ")" });
    else if (comma !== undefined) tokens.push({ kind: "comma", text: "," });
    else tokens.push({ kind: "ident", text: ident });
  }
  return tokens;
};

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FilterGroup | null {
    const root = emptyFilterGroup();
    if (!this.tokens.length) return root;
    const items = this.expression();
    if (!items || this.pos !== this.tokens.length) return null;
    root.items = items;
    return root;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private keyword(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "ident" && token.text.toUpperCase() === word;
  }

  private expression(): FilterNode[] | null {
    const items: FilterNode[] = [];
    let connector: FilterConnector = "AND";
    for (;;) {
      const node = this.term(connector);
      if (!node) return null;
      items.push(node);
      if (this.keyword("AND") || this.keyword("OR")) {
        connector = this.tokens[this.pos++].text.toUpperCase() as FilterConnector;
        continue;
      }
      return items;
    }
  }

  private term(connector: FilterConnector): FilterNode | null {
    if (this.peek()?.kind === "lparen") {
      this.pos++;
      const items = this.expression();
      if (!items || this.peek()?.kind !== "rparen") return null;
      this.pos++;
      if (items.length === 1 && items[0].kind === "condition") return { ...items[0], connector };
      return { kind: "group", id: newFilterId(), connector, items };
    }
    return this.predicate(connector);
  }

  private value(): string | null {
    const token = this.peek();
    if (!token) return null;
    if (token.kind === "string" || token.kind === "number") {
      this.pos++;
      return token.text;
    }
    if (token.kind === "ident" && /^(true|false)$/i.test(token.text)) {
      this.pos++;
      return token.text.toLowerCase();
    }
    return null;
  }

  private condition(
    connector: FilterConnector,
    field: string,
    operator: FilterOperatorId,
    values: string[],
  ): FilterCondition {
    return { kind: "condition", id: newFilterId(), connector, field, operator, values };
  }

  private functionPredicate(connector: FilterConnector): FilterCondition | null {
    const name = this.peek()!.text.toLowerCase();
    if (name === "match_all") return this.matchAllPredicate(connector);
    const operator = FUNCTION_OPERATORS[name];
    if (!operator || this.peek(1)?.kind !== "lparen") return null;
    const field = this.peek(2);
    const value = this.peek(4);
    if (
      field?.kind !== "ident" ||
      this.peek(3)?.kind !== "comma" ||
      value?.kind !== "string" ||
      this.peek(5)?.kind !== "rparen"
    )
      return null;
    this.pos += 6;
    return this.condition(connector, field.text, operator, [value.text]);
  }

  private matchAllPredicate(connector: FilterConnector): FilterCondition | null {
    const value = this.peek(2);
    if (value?.kind !== "string" || this.peek(3)?.kind !== "rparen") return null;
    this.pos += 4;
    return this.condition(connector, "", "match_all", [value.text]);
  }

  private listPredicate(connector: FilterConnector, field: string, negate: boolean) {
    if (this.peek()?.kind !== "lparen") return null;
    this.pos++;
    const values: string[] = [];
    for (;;) {
      const value = this.value();
      if (value === null) return null;
      values.push(value);
      if (this.peek()?.kind === "comma") {
        this.pos++;
        continue;
      }
      break;
    }
    if (this.peek()?.kind !== "rparen") return null;
    this.pos++;
    return this.condition(connector, field, negate ? "not_in" : "in", values);
  }

  private likePredicate(connector: FilterConnector, field: string, negate: boolean) {
    const pattern = this.peek();
    if (pattern?.kind !== "string") return null;
    this.pos++;
    const text = pattern.text;
    const starts = text.endsWith("%");
    const ends = text.startsWith("%");
    const inner = text.slice(ends ? 1 : 0, starts ? -1 : undefined);
    if (inner.includes("%")) return null;
    if (negate) {
      if (starts && ends) return this.condition(connector, field, "not_contains", [inner]);
      if (starts) return this.condition(connector, field, "not_starts_with", [inner]);
      return ends ? this.condition(connector, field, "not_ends_with", [inner]) : null;
    }
    if (starts && ends) return this.condition(connector, field, "contains", [inner]);
    if (starts) return this.condition(connector, field, "starts_with", [inner]);
    if (ends) return this.condition(connector, field, "ends_with", [inner]);
    return this.condition(connector, field, "eq", [inner]);
  }

  private predicate(connector: FilterConnector): FilterCondition | null {
    const head = this.peek();
    if (head?.kind !== "ident") return null;
    if (this.peek(1)?.kind === "lparen") return this.functionPredicate(connector);
    this.pos++;
    const field = head.text;
    const next = this.peek();
    if (next?.kind === "op") {
      this.pos++;
      const value = this.value();
      return value === null
        ? null
        : this.condition(connector, field, COMPARISON[next.text], [value]);
    }
    const negate = this.keyword("NOT");
    if (negate) this.pos++;
    if (this.keyword("IN")) {
      this.pos++;
      return this.listPredicate(connector, field, negate);
    }
    if (this.keyword("LIKE")) {
      this.pos++;
      return this.likePredicate(connector, field, negate);
    }
    if (!negate && this.keyword("IS")) return this.isPredicate(connector, field);
    return null;
  }

  private isPredicate(connector: FilterConnector, field: string): FilterCondition | null {
    const is = this.tokens[this.pos++].text;
    const isNot = this.keyword("NOT");
    let not = is === is.toLowerCase() ? "not" : "NOT";
    if (isNot) not = this.tokens[this.pos++].text;
    if (this.keyword("NULL")) {
      this.pos++;
      return this.condition(connector, field, isNot ? "is_not_null" : "is_null", []);
    }
    if (!this.keyword("TRUE") && !this.keyword("FALSE")) return null;
    const literal = this.tokens[this.pos++].text;
    const condition = this.condition(connector, field, isNot ? "neq" : "eq", [
      literal.toLowerCase(),
    ]);
    return { ...condition, isSpelling: { is, not, literal } };
  }
}

/** Parses a WHERE expression back into a filter tree; null when it uses anything the bar cannot draw. */
export const parseSqlFilter = (text: string): FilterGroup | null => {
  const tokens = tokenize(text.trim());
  return tokens ? new Parser(tokens).parse() : null;
};

const SHORTHAND_PATTERN = /^\s*([A-Za-z_@][\w.@-]*)\s*(!=|>=|<=|=~|!~|=|>|<|:)\s*(.+?)\s*$/;

const SHORTHAND_OPERATORS: Record<string, FilterOperatorId> = {
  "=": "eq",
  ":": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  "=~": "regex",
  "!~": "not_regex",
};

/** Reads `field=value`, `field>=10` or `field:value` typed into the bar; null when the text is not that shape. */
export const parseShorthand = (
  text: string,
): { field: string; operator: FilterOperatorId; value: string } | null => {
  const match = SHORTHAND_PATTERN.exec(text);
  if (!match) return null;
  const [, field, op, rawValue] = match;
  const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  return { field, operator: SHORTHAND_OPERATORS[op], value };
};
