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
 * Text Highlighting and Semantic Colorization Composable
 * =====================================================
 *
 * Combines semantic text colorization with keyword highlighting functionality.
 * Provides unified text processing for both visual styling and search highlighting.
 *
 * Features:
 * - Extracts keywords from SQL query patterns (match_all, fuzzy_match_all, str_match, re_match)
 * - Applies semantic colors to different text types (IPs, URLs, timestamps, etc.)
 * - Highlights matching keywords with background color
 * - Handles HTML escaping and safe rendering
 *
 * Usage:
 * const { processTextWithHighlights } = useTextHighlighter();
 * const result = processTextWithHighlights(text, queryString, colors, showQuotes);
 */

import type { I18nText } from "@/types/i18n";

import { useStore } from "vuex";
import { escapeHtml } from "@/utils/html";

/**
 * Represents a processed text segment with styling information
 */

export interface TextSegment {
  id: string;
  content: I18nText;
  color?: string;
  isHighlighted: boolean;
  isWhitespace: boolean;
}

/**
 * Bounds that keep re_match highlighting from stalling the UI. JS regexes
 * backtrack (Rust's do not), so a pattern that is cheap on the server can be
 * catastrophic here; patterns or texts beyond these limits are not highlighted.
 */
const MAX_REGEX_PATTERN_LENGTH = 256;
const MAX_REGEX_TEXT_LENGTH = 512;
const MAX_REGEX_MATCHES = 100;
/** A {n,m} repeat wider than this counts as unbounded. */
const MAX_BOUNDED_REPEAT = 16;
/**
 * Caps on the product of variable-width choices ({n,m}, ?, |), which multiply
 * backtracking: alongside an unbounded quantifier only one binary choice is
 * allowed (https?://\S+), without one the product may reach 81 (four \d{1,3}).
 */
const MAX_VARIANTS_WITH_UNBOUNDED = 2;
const MAX_VARIANTS = 81;

/** Escaped str_match literals: linear to match, so exempt from MAX_REGEX_TEXT_LENGTH. */
const literalPatterns = new WeakSet<RegExp>();

/**
 * Matches two-argument filter functions with a string-literal second argument:
 * - str_match(field, 'value') / match_field(field, 'value')
 * - str_match_ignore_case(field, 'value') / match_field_ignore_case(field, 'value')
 * - re_match(field, 'pattern')
 * Group 1 is the function name, group 2 a single-quoted literal ('' escapes a
 * quote), group 3 a double-quoted literal.
 */
const FIELD_FILTER_REGEX =
  /\b(str_match_ignore_case|match_field_ignore_case|str_match|match_field|re_match)\s*\(\s*[^,()]+?\s*,\s*(?:'((?:[^']|'')*)'|"([^"]*)")\s*\)/gi;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a regex source risks super-linear backtracking. Rejected: a
 * quantified group such as (a+)+ or (x)*; more than one unbounded quantifier
 * (*, +, {n,} or a {n,m} wider than MAX_BOUNDED_REPEAT); or variable-width
 * choices ({n,m}, ?, |) whose widths multiply past MAX_VARIANTS_WITH_UNBOUNDED
 * when an unbounded quantifier is present, else past MAX_VARIANTS. Escaped
 * characters and character classes are skipped, so [a*]+ has one quantifier.
 * What passes stays near-quadratic with a small constant on a
 * MAX_REGEX_TEXT_LENGTH text (well under 1 ms per field, measured in Node 24).
 */
function isBacktrackingRisk(source: string): boolean {
  let unbounded = 0;
  let variants = 1;
  let inClass = false;
  // Previous token: a quantifier makes a following ? lazy; "(" makes it a group modifier.
  let previous: "quantifier" | "open" | "other" = "other";

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      previous = "other";
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      previous = "other";
      continue;
    }

    const next = source[i + 1];
    if (char === ")" && (next === "*" || next === "+" || next === "{")) return true;

    let isQuantifier = false;
    if (char === "*" || char === "+") {
      unbounded++;
      isQuantifier = true;
    } else if (char === "?") {
      if (previous === "other") variants *= 2;
      isQuantifier = previous !== "open";
    } else if (char === "|") {
      variants *= 2;
    } else if (char === "{") {
      const repeat = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (repeat) {
        isQuantifier = true;
        if (repeat[2] && (repeat[3] === "" || Number(repeat[3]) > MAX_BOUNDED_REPEAT)) {
          unbounded++;
        } else if (repeat[2]) {
          variants *= Math.max(Number(repeat[3]) - Number(repeat[1]) + 1, 1);
        }
        i += repeat[0].length - 1;
      }
    }
    previous = isQuantifier ? "quantifier" : char === "(" ? "open" : "other";

    if (unbounded > 1 || variants > (unbounded ? MAX_VARIANTS_WITH_UNBOUNDED : MAX_VARIANTS)) {
      return true;
    }
  }

  return false;
}

/**
 * Compiles a Rust-regex pattern (as passed to re_match) into a global JS RegExp.
 * Leading inline flags such as (?i) become JS flags. Returns null for anything
 * JS cannot compile or that risks catastrophic backtracking (isBacktrackingRisk).
 */
function compileHighlightRegex(pattern: string): RegExp | null {
  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) return null;

  let source = pattern;
  let flags = "g";
  const inlineFlags = /^\(\?([a-zA-Z]+)\)/.exec(source);
  if (inlineFlags) {
    for (const flag of inlineFlags[1]) {
      if (flag !== "i" && flag !== "m" && flag !== "s") return null;
      if (!flags.includes(flag)) flags += flag;
    }
    source = source.slice(inlineFlags[0].length);
  }

  if (isBacktrackingRisk(source)) return null;

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

let cachedPatternQuery: string | null = null;
let cachedPatterns: RegExp[] = [];

/**
 * Composable for text highlighting and semantic colorization
 */
export function useTextHighlighter() {
  useStore();

  /**
   * Extracts keywords from SQL query strings
   * Matches patterns like:
   * - match_all('keyword')
   * - fuzzy_match('keyword', 2)
   * - fuzzy_match_all('keyword', 2)
   * Keywords are highlighted case-insensitively within each token; field
   * filters (str_match, re_match, ...) are returned by extractHighlightPatterns.
   *
   * @param queryString - The SQL query string to parse
   * @returns Array of extracted keywords
   */
  function extractKeywords(queryString: string): string[] {
    if (!queryString?.trim()) return [];

    // Regex to support match_all, fuzzy_match, and fuzzy_match_all SQL functions
    const regex =
      /\b(?:match_all|fuzzy_match_all|fuzzy_match)\(\s*(['"])([^'"]+)\1(?:\s*,\s*\d+)?\s*\)/g;
    const result: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(queryString)) !== null) {
      if (match[2]) {
        // Trim the extracted keyword to handle extra spaces
        const keyword = match[2].trim();
        if (keyword) {
          result.push(keyword);
        }
      }
    }

    return Array.from(new Set(result));
  }

  /**
   * Builds a global RegExp matching a str_match literal verbatim. Ignore-case
   * literals get the u flag too, so case folding follows Unicode as the
   * server's lowercase match does (e.g. the Kelvin sign matches k).
   */
  function literalPattern(value: string, ignoreCase: boolean): RegExp {
    const regex = new RegExp(escapeRegExp(value), ignoreCase ? "giu" : "g");
    literalPatterns.add(regex);
    return regex;
  }

  /**
   * Extracts highlight patterns from field filters; they are matched against a
   * whole field value, so anchors and literals containing spaces behave as on
   * the server:
   * - str_match(field, 'value') / match_field(field, 'value') — case-sensitive literal
   * - str_match_ignore_case / match_field_ignore_case — case-insensitive literal
   * - re_match(field, 'pattern') — regex; re_not_match is skipped since its
   *   rows by definition do not contain a match
   * Literals are kept verbatim (the server does not trim them). Patterns JS
   * cannot compile, or that risk catastrophic backtracking, are skipped silently.
   *
   * @param queryString - The SQL query string to parse
   * @returns Array of global RegExps to highlight
   */
  function extractHighlightPatterns(queryString: string): RegExp[] {
    if (!queryString?.trim()) return [];
    if (queryString === cachedPatternQuery) return cachedPatterns;

    const patterns: RegExp[] = [];
    const seen = new Set<string>();

    for (const filter of queryString.matchAll(FIELD_FILTER_REGEX)) {
      const name = filter[1].toLowerCase();
      const value = filter[2]?.replace(/''/g, "'") ?? filter[3] ?? "";
      const regex =
        name === "re_match"
          ? compileHighlightRegex(value)
          : value
            ? literalPattern(value, name.endsWith("_ignore_case"))
            : null;

      if (regex && !seen.has(`${regex.source}/${regex.flags}`)) {
        seen.add(`${regex.source}/${regex.flags}`);
        patterns.push(regex);
      }
    }

    cachedPatternQuery = queryString;
    cachedPatterns = patterns;
    return patterns;
  }

  /**
   * Collects the [start, end) ranges a global regex matches in text. Zero-length
   * matches are skipped and at most MAX_REGEX_MATCHES ranges are collected.
   */
  function collectMatchRanges(text: string, regex: RegExp, ranges: Array<[number, number]>) {
    regex.lastIndex = 0;
    let count = 0;
    let match: RegExpExecArray | null;

    while (count < MAX_REGEX_MATCHES && (match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
      count++;
    }
    regex.lastIndex = 0;
  }

  /**
   * Collects the [start, end) ranges the highlight patterns match in text.
   * Patterns run on a whole field value, so anchors and spaces behave as they
   * do on the server; compiled re_match regexes skip texts over
   * MAX_REGEX_TEXT_LENGTH.
   */
  function collectPatternRanges(text: string, patterns: RegExp[]): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    if (!text) return ranges;
    for (const pattern of patterns) {
      if (text.length <= MAX_REGEX_TEXT_LENGTH || literalPatterns.has(pattern)) {
        collectMatchRanges(text, pattern, ranges);
      }
    }
    return ranges;
  }

  /**
   * Splits text by highlight keywords and patterns and marks matched parts
   *
   * @param text - Text to process
   * @param keywords - Array of keywords to highlight (case-insensitive)
   * @param patterns - Global RegExps to highlight, from extractHighlightPatterns
   * @returns Array of text parts with highlight flags
   */
  function splitTextByKeywords(
    text: string,
    keywords: string[],
    patterns: RegExp[] = [],
  ): Array<{ text: string; isHighlighted: boolean }> {
    return splitTextByRanges(text, keywords, collectPatternRanges(text, patterns));
  }

  /**
   * Splits text by highlight keywords plus precomputed highlight ranges.
   */
  function splitTextByRanges(
    text: string,
    keywords: string[],
    extraRanges: Array<[number, number]>,
  ): Array<{ text: string; isHighlighted: boolean }> {
    if ((!keywords.length && !extraRanges.length) || !text) {
      return [{ text, isHighlighted: false }];
    }

    if (extraRanges.length) {
      const ranges = [...extraRanges];
      if (keywords.length) {
        collectMatchRanges(text, new RegExp(keywords.map(escapeRegExp).join("|"), "giu"), ranges);
      }
      ranges.sort((a, b) => a[0] - b[0]);

      const result: Array<{ text: string; isHighlighted: boolean }> = [];
      let cursor = 0;
      for (const [start, end] of ranges) {
        if (end <= cursor) continue;
        const from = Math.max(start, cursor);
        if (from > cursor) result.push({ text: text.slice(cursor, from), isHighlighted: false });
        if (result.length && result[result.length - 1].isHighlighted) {
          result[result.length - 1].text += text.slice(from, end);
        } else {
          result.push({ text: text.slice(from, end), isHighlighted: true });
        }
        cursor = end;
      }
      if (cursor < text.length) result.push({ text: text.slice(cursor), isHighlighted: false });
      return result;
    }

    // Create regex pattern from keywords (escape special characters)
    const escapedKeywords = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    const pattern = new RegExp(`(${escapedKeywords.join("|")})`, "giu");

    // Split by pattern but keep the delimiters
    const parts = text.split(pattern);
    const result: Array<{ text: string; isHighlighted: boolean }> = [];

    for (const part of parts) {
      if (!part) continue;

      // Check if this part matches any keyword (case-insensitive)
      const isHighlighted = keywords.some(
        (keyword) => keyword.toLowerCase() === part.toLowerCase(),
      );

      result.push({ text: part, isHighlighted });
    }

    return result;
  }

  /**
   * Tokenizes text by splitting on whitespace only. Quotes and brackets stay
   * attached to the text they are part of; semantic detection happens afterwards.
   *
   * @param text - Text to tokenize
   * @returns Array of token objects with only 2 types: "token" or "whitespace"
   *
   * @example
   * smartTokenize('hello "world" [test]')
   * // Returns:
   * // [
   * //   {content: 'hello', type: 'token'},
   * //   {content: ' ', type: 'whitespace'},
   * //   {content: '"world"', type: 'token'},
   * //   {content: ' ', type: 'whitespace'},
   * //   {content: '[test]', type: 'token'}
   * // ]
   */
  function smartTokenize(text: string): Array<{ content: string; type: string }> {
    if (!text) return [];

    const tokens: Array<{ content: string; type: string }> = [];

    // Split by whitespace but keep the whitespace in the result
    // (capturing group (\s+) preserves the separators)
    const parts = text.split(/(\s+)/);

    for (const part of parts) {
      if (!part) continue; // Skip empty strings from split

      const isWhitespace = /^\s+$/.test(part);
      tokens.push({
        content: part,
        type: isWhitespace ? "whitespace" : "token",
      });
    }

    return tokens;
  }

  /**
   * Detects semantic type of a text segment for colorization
   *
   * @param segment - Text segment to analyze
   * @returns Semantic type identifier
   */
  function detectSemanticType(segment: string): string {
    if (!segment.trim()) return "whitespace";

    const cleaned = segment.replace(/^["']|["']$/g, "");
    const analysis = analyzeSegment(cleaned);

    // IP addresses
    if (
      analysis.dotSeparatedNumbers === 4 &&
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleaned)
    ) {
      return "ip";
    }

    // URLs
    if (/^https?:\/\//i.test(cleaned)) return "url";

    // Email addresses
    if (analysis.hasAtSymbol && analysis.hasDots && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      return "email";
    }

    // Timestamps
    if (analysis.hasDateTimePattern) return "timestamp";

    // HTTP methods
    if (
      analysis.startsWithUppercase &&
      analysis.wordCount === 1 &&
      cleaned.length <= 7 &&
      /^[A-Z]+$/.test(cleaned) &&
      analysis.hasCommonHttpVerb
    ) {
      return "http_method";
    }

    // HTTP status codes
    if (analysis.isThreeDigitStatusCode) return "status_code";

    // Large numbers
    if (analysis.isLargeNumber) return "file_size";

    // UUIDs
    if (analysis.isUuidPattern) return "uuid";

    // File paths
    if (analysis.isFilePath) return "path";

    return "default";
  }

  /**
   * Analyzes text segment for various patterns and characteristics
   * Performs comprehensive pattern analysis to help with semantic type detection
   *
   * @param text - Text segment to analyze
   * @returns Object containing analysis results with boolean flags and counts for various text patterns
   */
  function analyzeSegment(text: string): any {
    return {
      length: text.length,
      wordCount: text.split(/\s+/).length,
      hasUppercase: /[A-Z]/.test(text),
      hasLowercase: /[a-z]/.test(text),
      hasDigits: /\d/.test(text),
      hasSpecialChars: /[^a-zA-Z0-9\s]/.test(text),
      hasDots: text.includes("."),
      hasAtSymbol: text.includes("@"),
      hasColons: text.includes(":"),
      hasSlashes: text.includes("/"),
      hasHyphens: text.includes("-"),
      hasParentheses: /[()[\]]/.test(text),
      dotSeparatedNumbers: (text.match(/\d+/g) || []).length,
      startsWithUppercase: /^[A-Z]/.test(text),
      isThreeDigitStatusCode:
        /^(1(0[0-3])|2(0[0-8]|26)|3(0[0-8])|4(0[0-9]|1[0-9]|2[0-9]|3[01]|51)|5(0[0-9]|1[01]))$/.test(
          text,
        ),
      isLargeNumber: /^\d{4,}$/.test(text),
      hasDateTimePattern:
        /\d{1,4}[/-]\w{1,3}[/-]\d{1,4}[:\s]\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s*[+-]\d{4})?/.test(
          text,
        ),
      hasVersionPattern: /\d+\.\d+/.test(text),
      hasCommonHttpVerb: /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.test(text),
      isUuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text),
      isFilePath: /^\//.test(text) || /^[A-Za-z]:\\/.test(text),
    };
  }

  /**
   * Gets color for semantic type based on the provided color theme
   * Maps semantic type identifiers to their corresponding theme colors
   *
   * @param type - Semantic type identifier (ip, url, email, timestamp, etc.)
   * @param colors - Color theme object containing color definitions
   * @returns Color string for the semantic type, or null if no mapping exists
   */
  function getColorForType(type: string, colors: any): string | null {
    const colorMap: { [key: string]: string } = {
      ip: colors.ip,
      url: colors.url,
      email: colors.email,
      timestamp: colors.timestamp,
      http_method: colors.path,
      status_code: colors.numberValue,
      file_size: colors.numberValue,
      user_agent: colors.stringValue,
      uuid: colors.uuid,
      path: colors.path,
    };

    return colorMap[type] || null;
  }

  /**
   * Gets semantic CSS class for a text value
   * Maps semantic types to CSS class names for consistent styling
   *
   * @param semanticType - The detected semantic type
   * @returns CSS class name for the semantic type
   */
  function getSemanticCSSClass(semanticType: string): string {
    const classMap: { [key: string]: string } = {
      ip: "log-ip",
      url: "log-url",
      email: "log-email",
      timestamp: "log-timestamp",
      http_method: "log-http-method",
      status_code: "log-status-code",
      file_size: "log-number",
      uuid: "log-uuid",
      path: "log-path",
      whitespace: "log-whitespace",
      default: "log-string",
    };

    return classMap[semanticType] || "log-string";
  }

  /**
   * Gets semantic color for a single text value
   * Convenience function that detects semantic type and returns appropriate color
   * @deprecated Use getSemanticCSSClass instead for better performance
   *
   * @param value - Text value to analyze and colorize
   * @param colors - Color theme object containing color definitions
   * @returns Color string for the detected semantic type, defaults to stringValue color
   */
  function getSingleSemanticColor(value: string, colors: any): string {
    const semanticType = detectSemanticType(value);
    return getColorForType(semanticType, colors) || colors.stringValue;
  }

  /**
   * Detects if a column contains Full Text Search (FTS) content that needs advanced colorization
   * Uses FTS keys from store configuration instead of hardcoded values
   *
   * @param columnId - The column identifier
   * @param cellValue - The cell value to analyze
   * @returns True if the column contains FTS content
   */
  function isFTSColumn(columnId: string, cellValue: any, selectedStreamFtsKeys: string[]): boolean {
    // Skip for source column (already handled separately)
    if (columnId === "source") return false;
    // Only analyze string values
    if (typeof cellValue !== "string" || !cellValue.trim()) return false;

    if (selectedStreamFtsKeys.includes(columnId.toLowerCase())) {
      return true;
    }
    return false;
  }

  /**
   * Processes text segments with both semantic coloring and keyword highlighting
   * Simplified version - just handles tokens and whitespace
   *
   * @param segments - Array of text segments to process
   * @param keywords - Keywords to highlight
   * @param colors - Color theme object
   * @param showQuotes - Whether to add quotes around values
   * @param patternRanges - Pattern match ranges over the whole text the segments make up
   * @returns HTML string with applied styling
   */
  function processTextSegments(
    segments: Array<{ content: string; type: string }>,
    keywords: string[],
    colors: any,
    showQuotes: boolean = false,
    patternRanges: Array<[number, number]> = [],
  ): string {
    let result = "";

    // Add opening quote if requested
    if (showQuotes) {
      result += `<span class="log-string">&quot;</span>`;
    }

    // Process each segment individually
    let offset = 0;
    result += segments
      .map((segment) => {
        // Pattern ranges that fall in this segment, relative to its start
        const start = offset;
        const end = offset + segment.content.length;
        offset = end;
        const segmentRanges: Array<[number, number]> = [];
        for (const [from, to] of patternRanges) {
          if (from < end && to > start) {
            segmentRanges.push([Math.max(from, start) - start, Math.min(to, end) - start]);
          }
        }

        // For whitespace, return as-is unless a pattern match spans it
        if (segment.type === "whitespace") {
          if (!segmentRanges.length) return segment.content;
          return splitTextByRanges(segment.content, [], segmentRanges)
            .map((part) =>
              part.isHighlighted ? `<span class="log-highlighted">${part.text}</span>` : part.text,
            )
            .join("");
        }

        // For regular tokens, split by keywords and apply semantic colors
        const parts = splitTextByRanges(segment.content, keywords, segmentRanges);
        return parts
          .map((part) => {
            const content = escapeHtml(part.text);
            if (part.isHighlighted) {
              // Highlighted keywords get yellow background
              return `<span class="log-highlighted">${content}</span>`;
            } else {
              // Apply semantic colorization based on content type
              const semanticType = detectSemanticType(part.text);
              const semanticClass = getSemanticCSSClass(semanticType);
              return `<span class="${semanticClass}">${content}</span>`;
            }
          })
          .join("");
      })
      .join("");

    // Add closing quote if requested
    if (showQuotes) {
      result += `<span class="log-string">&quot;</span>`;
    }

    return result;
  }

  /**
   * Main function to process text with both semantic coloring and highlighting
   * Quotes are always preserved, but highlighting only applies to content within quotes
   *
   * @param text - Text to process
   * @param queryString - Query string containing keywords to highlight
   * @param colors - Color theme object
   * @param showQuotes - Whether to show quotes around values
   * @returns HTML string with applied styling
   */
  function processTextWithHighlights(
    text: any,
    queryString: string = "",
    colors: any,
    showQuotes: boolean = false,
  ): string {
    if (text === null || text === undefined) {
      return "";
    }

    const textStr = String(text);
    const keywords = extractKeywords(queryString);
    const patternRanges = collectPatternRanges(textStr, extractHighlightPatterns(queryString));
    const segments = smartTokenize(textStr);

    return processTextSegments(segments, keywords, colors, showQuotes, patternRanges);
  }

  return {
    processTextWithHighlights,
    extractKeywords,
    extractHighlightPatterns,
    splitTextByKeywords,
    getSingleSemanticColor,
    getSemanticCSSClass,
    isFTSColumn,
  };
}
