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

const scanWord = (text: string, start: number, letters: number[]): number => {
  let end = start;
  while (end < text.length && isIdentPart(text[end])) end++;
  const word = text.slice(start, end);
  if (LABEL_LIST_KEYWORDS.has(word.toLowerCase())) return skipLabelList(text, end);
  if (word.length === 1 && LETTERS.includes(word)) letters.push(start);
  return end;
};

const nextToken = (text: string, i: number, letters: number[]): number => {
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
  if (isIdentStart(ch)) return scanWord(text, i, letters);
  return i + 1;
};

const letterPositions = (formula: string): number[] => {
  const letters: number[] = [];
  let i = 0;
  while (i < formula.length) i = nextToken(formula, i, letters);
  return letters;
};

export const isFormulaQuery = (query: any): boolean => typeof query?.config?.formula === "string";

/** Each query's letter: its stored `ref`, else the first letter no other query holds. */
export const queryRefs = (queries: any[]): (string | undefined)[] => {
  const used = new Set<string>(queries.map((q) => q?.config?.ref).filter(Boolean));
  return queries.map((q) => {
    if (q?.config?.ref || isFormulaQuery(q)) return q?.config?.ref || undefined;
    const letter = [...LETTERS].find((l) => !used.has(l));
    if (letter) used.add(letter);
    return letter;
  });
};

/** Letter → final query text; a formula's own letter maps to null. */
export const formulaInputs = (queries: any[], texts: string[]): Record<string, string | null> => {
  const inputs: Record<string, string | null> = {};
  queryRefs(queries).forEach((letter, i) => {
    if (letter) inputs[letter] = isFormulaQuery(queries[i]) ? null : texts[i];
  });
  return inputs;
};

export const formulaRefs = (formula: string): string[] => [
  ...new Set(letterPositions(formula).map((pos) => formula[pos])),
];

export const substituteFormula = (
  formula: string,
  inputsByLetter: Record<string, string | null>,
): FormulaResult => {
  const positions = letterPositions(formula);
  for (const pos of positions) {
    const letter = formula[pos];
    if (!(letter in inputsByLetter)) {
      return { error: gt("dashboard.formulaUnknownLetter", { letter }) };
    }
    if (inputsByLetter[letter] === null) {
      return { error: gt("dashboard.formulaReferencesFormula", { letter }) };
    }
  }
  let expr = "";
  let last = 0;
  for (const pos of positions) {
    const text = inputsByLetter[formula[pos]] as string;
    // A trailing `#` comment in the input would otherwise swallow the closing parenthesis.
    expr += `${formula.slice(last, pos)}(${text}${text.includes("#") ? "\n" : ""})`;
    last = pos + 1;
  }
  return { expr: expr + formula.slice(last) };
};
