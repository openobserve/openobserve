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
 * Where a query uses double quotes for a string VALUE.
 *
 * `WHERE level = "error"` parses as a comparison against a COLUMN named
 * `error`, which usually exists nowhere, so the query returns nothing and looks
 * like missing data. Worth a warning — but the scan used to run over the raw
 * text, so it also warned about `-- level = "error"` in a comment and about the
 * legal literal `'he said "hi"'`. A warning on valid SQL teaches people to
 * ignore the squiggle, including the times it is right.
 *
 * Pure on purpose: the editor owns the monaco half (offsets to positions,
 * positions to markers), and this owns the decision, which is string in,
 * offsets out and can be tested as such.
 */

import type { TranslateFn } from "@/types/i18n";

export interface DoubleQuoteIssue {
  /** Index of the opening quote in the ORIGINAL text. */
  startOffset: number;
  /** Index one past the closing quote. */
  endOffset: number;
  message: string;
}

/**
 * Blank out everything that is not executable SQL, preserving every offset.
 *
 * Line comments, block comments and the INTERIOR of single-quoted strings
 * become spaces. String delimiters are deliberately kept: `a = "x'` is a
 * mismatched pair that has to stay visible to be reported, and it is only the
 * text between quotes that must stop matching.
 */
const maskNonCode = (text: string): string => {
  const out = text.split("");
  let i = 0;

  const blank = (index: number) => {
    // Newlines survive so line/column mapping downstream stays correct.
    if (out[index] !== "\n") out[index] = " ";
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "-" && next === "-") {
      while (i < text.length && text[i] !== "\n") blank(i++);
      continue;
    }

    if (ch === "/" && next === "*") {
      blank(i++);
      blank(i++);
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) blank(i++);
      // An unterminated block comment swallows the rest, as SQL does.
      if (i < text.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }

    if (ch === "'") {
      // Find the terminator first. An UNTERMINATED literal is left exactly as
      // written, because `a = 'x"` is not a string containing a quote — it is
      // the mismatched pair this scan exists to report, and masking its
      // interior would hide the `"` that makes it reportable.
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === "'") {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (text[end + 1] === "'") {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      if (end >= text.length) break;

      for (let j = i + 1; j < end; j++) blank(j);
      i = end + 1; // both delimiters survive
      continue;
    }

    i++;
  }

  return out.join("");
};

/**
 * Two shapes are reported, both only in value position — after a comparison or
 * membership operator. `FROM "table"` and `SELECT "col"` are correct quoting of
 * an identifier and are never matched.
 *
 *   fully double-quoted:  field = "value"
 *   mismatched:           field = "value'   or   field = 'value"
 */
const VALUE_QUOTE_REGEX =
  /(?:NOT\s+LIKE|NOT\s+IN\s*\(|!=|<>|>=|<=|=|>|<|LIKE|IN\s*\()\s*("[^'"]*'|'[^'"]*"|"[^"]*")/gi;

export const findDoubleQuoteIssues = (t: TranslateFn, text: string): DoubleQuoteIssue[] => {
  if (!text) return [];

  // Matched against the masked copy; offsets index the original, which the
  // masking preserves character for character.
  const masked = maskNonCode(text);
  const issues: DoubleQuoteIssue[] = [];
  const regex = new RegExp(VALUE_QUOTE_REGEX.source, VALUE_QUOTE_REGEX.flags);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    const quoted = match[1];
    const startOffset = match.index + match[0].length - quoted.length;
    const isMixed =
      (quoted.startsWith('"') && quoted.endsWith("'")) ||
      (quoted.startsWith("'") && quoted.endsWith('"'));

    issues.push({
      startOffset,
      endOffset: startOffset + quoted.length,
      message: isMixed
        ? t("sqlEditor.diagnostics.mismatchedQuotes")
        : t("sqlEditor.diagnostics.doubleQuotedValue"),
    });
  }

  return issues;
};
