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

import { gt } from "@/types/i18n";

export type FormulaResult = { expr: string } | { error: string };
export type FormulaInput = { text: string; isFormula: boolean };
type RefToken = { start: number; name: string };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LABEL_LIST_KEYWORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
]);
const QUOTES = new Set(['"', "'", "`"]);
const FORMULA_REF = /^F[1-9][0-9]*$/;
const MAX_FORMULA_LENGTH = 100_000;
const MAX_FORMULA_DEPTH = 10;

const isIdentStart = (ch: string) => /[A-Za-z_:]/.test(ch);
const isIdentPart = (ch: string) => /[A-Za-z0-9_:]/.test(ch);

const skipString = (text: string, start: number): number => {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    // Backtick strings are raw in PromQL, so only the other two have escapes.
    i += text[i] === "\\" && quote !== "`" ? 2 : 1;
  }
  return i + 1;
};

const skipUntil = (text: string, start: number, close: string): number => {
  let i = start + 1;
  while (i < text.length && text[i] !== close) {
    i = QUOTES.has(text[i]) ? skipString(text, i) : i + 1;
  }
  return i + 1;
};

const skipLabelList = (text: string, wordEnd: number): number => {
  let i = wordEnd;
  while (/\s/.test(text[i] ?? "")) i++;
  return text[i] === "(" ? skipUntil(text, i, ")") : wordEnd;
};

const scanWord = (text: string, start: number, refs: RefToken[]): number => {
  let end = start;
  while (end < text.length && isIdentPart(text[end])) end++;
  const word = text.slice(start, end);
  if (LABEL_LIST_KEYWORDS.has(word.toLowerCase())) return skipLabelList(text, end);
  if ((word.length === 1 && LETTERS.includes(word)) || FORMULA_REF.test(word)) {
    refs.push({ start, name: word });
  }
  return end;
};

const nextToken = (text: string, i: number, refs: RefToken[]): number => {
  const ch = text[i];
  if (QUOTES.has(ch)) return skipString(text, i);
  if (ch === "{") return skipUntil(text, i, "}");
  if (ch === "#") {
    const newline = text.indexOf("\n", i);
    return newline === -1 ? text.length : newline;
  }
  if (/[0-9.]/.test(ch)) {
    let end = i + 1;
    while (end < text.length && /[A-Za-z0-9_.]/.test(text[end])) end++;
    return end;
  }
  if (isIdentStart(ch)) return scanWord(text, i, refs);
  return i + 1;
};

const refTokens = (formula: string): RefToken[] => {
  const refs: RefToken[] = [];
  let i = 0;
  while (i < formula.length) i = nextToken(formula, i, refs);
  return refs;
};

export const isFormulaQuery = (query: any): boolean => typeof query?.config?.formula === "string";

/** Each query's name: its stored `ref`, else the first free letter, or `F1`, `F2`, … for a formula. */
export const queryRefs = (queries: any[]): (string | undefined)[] => {
  const used = new Set<string>(queries.map((q) => q?.config?.ref).filter(Boolean));
  const nextFormulaRef = () => {
    let n = 1;
    while (used.has(`F${n}`)) n++;
    return `F${n}`;
  };
  return queries.map((q) => {
    if (q?.config?.ref) return q.config.ref;
    // Formulas live apart from the letters, so a letter a formula is waiting on stays free for its query.
    const ref = isFormulaQuery(q) ? nextFormulaRef() : [...LETTERS].find((l) => !used.has(l));
    if (ref) used.add(ref);
    return ref;
  });
};

/** Letter → that query's final text, and whether the text is itself a formula. */
export const formulaInputs = (queries: any[], texts: string[]): Record<string, FormulaInput> => {
  const inputs: Record<string, FormulaInput> = {};
  queryRefs(queries).forEach((letter, i) => {
    if (letter) inputs[letter] = { text: texts[i], isFormula: isFormulaQuery(queries[i]) };
  });
  return inputs;
};

export const formulaRefs = (formula: string): string[] => [
  ...new Set(refTokens(formula).map((ref) => ref.name)),
];

/** The letters of the non-formula queries a formula reads, through any formulas it references. */
export const formulaLeafRefs = (queries: any[], formula: string): Set<string> => {
  const formulaByLetter: Record<string, string> = {};
  queryRefs(queries).forEach((letter, i) => {
    if (letter && isFormulaQuery(queries[i])) formulaByLetter[letter] = queries[i].config.formula;
  });
  const leaves = new Set<string>();
  const seen = new Set<string>();
  const visit = (text: string) => {
    for (const letter of formulaRefs(text)) {
      if (!(letter in formulaByLetter)) leaves.add(letter);
      else if (!seen.has(letter)) {
        seen.add(letter);
        visit(formulaByLetter[letter]);
      }
    }
  };
  visit(formula);
  return leaves;
};

/** Expands a formula into one expression, inlining referenced formulas; `self` is its own name. */
export const substituteFormula = (
  formula: string,
  inputsByLetter: Record<string, FormulaInput>,
  self?: string,
): FormulaResult => {
  const expanded: Record<string, string> = {};
  const expand = (text: string, path: string[]): FormulaResult => {
    let expr = "";
    let last = 0;
    for (const { start, name: letter } of refTokens(text)) {
      const input = inputsByLetter[letter];
      if (!input) return { error: gt("dashboard.formulaUnknownLetter", { letter }) };
      if (input.isFormula && !(letter in expanded)) {
        if (path.includes(letter)) {
          const cycle = [...path.slice(path.indexOf(letter)), letter].join(" → ");
          return { error: gt("dashboard.formulaCycle", { cycle }) };
        }
        if (path.length >= MAX_FORMULA_DEPTH) {
          return { error: gt("dashboard.formulaTooDeep", { limit: MAX_FORMULA_DEPTH }) };
        }
        const out = expand(input.text, [...path, letter]);
        if ("error" in out) return out;
        expanded[letter] = out.expr;
      }
      const inner = input.isFormula ? expanded[letter] : input.text;
      // A trailing `#` comment in the input would otherwise swallow the closing parenthesis.
      expr += `${text.slice(last, start)}(${inner}${inner.includes("#") ? "\n" : ""})`;
      last = start + letter.length;
      // Each nesting level can double the text, so the cap stops exponential growth early.
      if (expr.length > MAX_FORMULA_LENGTH) {
        return { error: gt("dashboard.formulaTooLong", { limit: MAX_FORMULA_LENGTH }) };
      }
    }
    return { expr: expr + text.slice(last) };
  };
  return expand(formula, self ? [self] : []);
};

/** A query's text for naming a label-free series: as sent, with dashboard variables filled in. */
export const legendExprOf = (
  queries: any[] | undefined,
  metadata: any,
  index: number,
): string | undefined =>
  metadata?.queries?.find((meta: any) => meta?.panelQueryIndex === index && meta?.query)?.query ??
  queries?.[index]?.query;

/** Inputs get their letter only beside a formula, so formula-free panels keep today's legends. */
export const legendFallbackOf = (queries: any[] | undefined, index: number): string | undefined => {
  const query = queries?.[index];
  if (query?.config?.promql_legend_fallback) return query.config.promql_legend_fallback;
  if (isFormulaQuery(query)) return query.config.formula;
  if (!queries?.some(isFormulaQuery) || query?.config?.promql_legend) return undefined;
  return queryRefs(queries)[index];
};
