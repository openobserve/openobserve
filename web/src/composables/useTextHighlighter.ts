// Copyright 2023 OpenObserve Inc.
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
 * - Extracts keywords from SQL query patterns (match_all, fuzzy_match_all)
 * - Applies semantic colors to different text types (IPs, URLs, timestamps, etc.)
 * - Highlights matching keywords with background color
 * - Handles HTML escaping and safe rendering
 *
 * Usage:
 * const { processTextWithHighlights } = useTextHighlighter();
 * const result = processTextWithHighlights(text, queryString, colors, showQuotes);
 */

import { useStore } from "vuex";
import useLogs from "./useLogs";

/**
 * Represents a processed text segment with styling information
 */

export interface TextSegment {
  id: string;
  content: string;
  color?: string;
  isHighlighted: boolean;
  isWhitespace: boolean;
}

/**
 * Composable for text highlighting and semantic colorization
 */
export function useTextHighlighter() {
  // Initialize store within the composable for accessing configuration
  const store = useStore();

  /**
   * Extracts keywords from SQL query strings
   * Matches patterns like:
   * - match_all('keyword')
   * - fuzzy_match('keyword', 2)
   * - fuzzy_match_all('keyword', 2)
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
   * Splits text by highlight keywords and marks matched parts
   * Similar to the original HighLight component logic
   *
   * @param text - Text to process
   * @param keywords - Array of keywords to highlight
   * @returns Array of text parts with highlight flags
   */
  function splitTextByKeywords(
    text: string,
    keywords: string[],
  ): Array<{ text: string; isHighlighted: boolean }> {
    if (!keywords.length || !text) {
      return [{ text, isHighlighted: false }];
    }

    // Create regex pattern from keywords (escape special characters)
    const escapedKeywords = keywords.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const pattern = new RegExp(`(${escapedKeywords.join("|")})`, "gi");

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
   * Escapes HTML characters in text for safe rendering
   *
   * Prevents XSS attacks by converting dangerous HTML characters into safe HTML entities.
   * This ensures user content displays as literal text instead of executing as HTML markup.
   *
   * @param str - String to escape
   * @returns HTML-safe string with entities escaped
   *
   * @example
   * // Input containing malicious HTML
   * const userInput = '<script>alert("hack")</script>';
   * const safeOutput = escapeHtml(userInput);
   * // Output: '&lt;script&gt;alert("hack")&lt;/script&gt;'
   * // Displays as: <script>alert("hack")</script> (visible text, not executed)
   *
   * @example
   * // Log data with HTML tags
   * const logMessage = '<h1>Error: Database connection failed</h1>';
   * const escapedLog = escapeHtml(logMessage);
   * // Output: '&lt;h1&gt;Error: Database connection failed&lt;/h1&gt;'
   * // Displays as: <h1>Error: Database connection failed</h1> (visible text)
   *
   * @example
   * // JSON data with quotes and ampersands
   * const jsonData = '{"message": "Success & complete", "html": "<div>content</div>"}';
   * const safeJson = escapeHtml(jsonData);
   * // Output: '{&quot;message&quot;: &quot;Success &amp; complete&quot;, &quot;html&quot;: &quot;&lt;div&gt;content&lt;/div&gt;&quot;}'
   */
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;") // Must be first: & → &amp;
      .replace(/</g, "&lt;") // Less than: < → &lt;
      .replace(/>/g, "&gt;") // Greater than: > → &gt;
      .replace(/"/g, "&quot;"); // Double quote: " → &quot;
  }

  /**
   * Tokenizes text while preserving quoted strings and brackets, with smart merging
   *
   * MAIN FEATURES:
   * 1. Preserves quoted strings: "hello world" stays as one token
   * 2. Preserves bracketed content: [timestamp] stays as one token
   * 3. Merges consecutive quoted strings: "Success" "message" → "Success message"
   * 4. Separates by whitespace: regular words become individual tokens
   *
   * EXAMPLES:
   * Input: 'Hello "quoted text" world [bracket]'
   * Output: [
   *   {content: "Hello", type: "token"},
   *   {content: " ", type: "whitespace"},
   *   {content: '"quoted text"', type: "quoted"},
   *   {content: " ", type: "whitespace"},
   *   {content: "world", type: "token"},
   *   {content: " ", type: "whitespace"},
   *   {content: "[bracket]", type: "bracketed"}
   * ]
   *
   * Input: '"Success" "message" failed'
   * Output: [
   *   {content: "Success message", type: "token"},  // ← MERGED!
   *   {content: " ", type: "whitespace"},
   *   {content: "failed", type: "token"}
   * ]
   *
   * @param text - Text to tokenize
   * @returns Array of token objects with content and type
   */
  function smartTokenize(
    text: string,
  ): Array<{ content: string; type: string }> {
    const tokens: Array<{ content: string; type: string }> = [];
    let current = "";
    let inQuotes = false;
    let inBrackets = false;
    let quoteChar = "";

    // FIRST PASS: Basic tokenization
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Start of quoted string: " or '
      if (!inQuotes && !inBrackets && (char === '"' || char === "'")) {
        // Save any accumulated content before quote
        if (current.trim()) {
          tokens.push({ content: current.trim(), type: "token" });
        }
        if (current !== current.trim()) {
          tokens.push({ content: " ", type: "whitespace" });
        }
        current = "";
        inQuotes = true;
        quoteChar = char;
        current += char; // Include opening quote
      }
      // Start of bracketed content: [
      else if (!inQuotes && !inBrackets && char === "[") {
        // Save any accumulated content before bracket
        if (current.trim()) {
          tokens.push({ content: current.trim(), type: "token" });
        }
        if (current !== current.trim()) {
          tokens.push({ content: " ", type: "whitespace" });
        }
        current = "";
        inBrackets = true;
        current += char; // Include opening bracket
      }
      // End of quoted string: matching quote
      else if (inQuotes && char === quoteChar) {
        current += char; // Include closing quote
        tokens.push({ content: current, type: "quoted" });
        current = "";
        inQuotes = false;
        quoteChar = "";
      }
      // End of bracketed content: ]
      else if (inBrackets && char === "]") {
        current += char; // Include closing bracket
        tokens.push({ content: current, type: "bracketed" });
        current = "";
        inBrackets = false;
      }
      // Whitespace outside quotes/brackets: separator
      else if (!inQuotes && !inBrackets && /\s/.test(char)) {
        if (current.trim()) {
          tokens.push({ content: current.trim(), type: "token" });
        }
        tokens.push({ content: char, type: "whitespace" });
        current = "";
      }
      // Regular character: accumulate
      else {
        current += char;
      }
    }

    // Handle any remaining content
    if (current.trim()) {
      tokens.push({
        content: current.trim(),
        type: inQuotes ? "quoted" : inBrackets ? "bracketed" : "token",
      });
    }

    // SECOND PASS: Merge consecutive quoted strings
    // Example: "Success" "message" → "Success message"
    const mergedTokens: Array<{ content: string; type: string }> = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === "quoted") {
        // Start with first quoted string (remove quotes)
        let mergedContent = token.content.slice(1, -1); // Remove outer quotes
        let j = i + 1;

        // Look for pattern: whitespace + quoted string
        while (j < tokens.length) {
          if (
            tokens[j].type === "whitespace" &&
            j + 1 < tokens.length &&
            tokens[j + 1].type === "quoted"
          ) {
            // Merge: add space + next quoted content (without quotes)
            mergedContent += " " + tokens[j + 1].content.slice(1, -1);
            j += 2; // Skip whitespace and quoted token
          } else {
            break; // No more consecutive quoted strings
          }
        }

        // If we merged multiple strings, create single token
        if (j > i + 1) {
          mergedTokens.push({ content: mergedContent, type: "token" });
          i = j;
        } else {
          // Single quoted string, keep as-is
          mergedTokens.push(token);
          i++;
        }
      } else {
        // Non-quoted token, keep as-is
        mergedTokens.push(token);
        i++;
      }
    }

    return mergedTokens;
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
    if (
      analysis.hasAtSymbol &&
      analysis.hasDots &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)
    ) {
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
      hasParentheses: /[()\[\]]/.test(text),
      dotSeparatedNumbers: (text.match(/\d+/g) || []).length,
      startsWithUppercase: /^[A-Z]/.test(text),
      isThreeDigitStatusCode: /^[1-5]\d{2}$/.test(text),
      isLargeNumber: /^\d{4,}$/.test(text),
      hasDateTimePattern:
        /\d{1,4}[/-]\w{1,3}[/-]\d{1,4}[:\s]\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s*[+-]\d{4})?/.test(
          text,
        ),
      hasVersionPattern: /\d+\.\d+/.test(text),
      hasCommonHttpVerb: /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.test(
        text,
      ),
      isUuidPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          text,
        ),
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
  function isFTSColumn(
    columnId: string,
    cellValue: any,
    selectedStreamFtsKeys: string[],
  ): boolean {
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
   * Splits text into semantic segments (IPs, emails, URLs, etc.)
   * @param text - Text to split into semantic parts
   * @returns Array of text parts with their positions
   */
  function splitTextBySemantic(
    text: string,
  ): Array<{ text: string; start: number; end: number; type: string }> {
    if (!text || typeof text !== "string") {
      return [
        {
          text: text || "",
          start: 0,
          end: (text || "").length,
          type: "default",
        },
      ];
    }

    const semanticPatterns = [
      { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, type: "ip" },
      { pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, type: "email" },
      { pattern: /\bhttps?:\/\/[^\s]+\b/g, type: "url" },
      {
        pattern: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g,
        type: "http_method",
      },
      { pattern: /\b[1-5]\d{2}\b/g, type: "status_code" },
      {
        pattern:
          /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
        type: "uuid",
      },
      { pattern: /\b\d{13,}\b/g, type: "timestamp" },
      {
        pattern: /\b\d+(\.\d+)?\s*(KB|MB|GB|TB|bytes?)\b/gi,
        type: "file_size",
      },
      { pattern: /\/[^\s]*(?:\?[^\s]*)?(?:#[^\s]*)?\b/g, type: "path" },
    ];

    const matches: Array<{
      text: string;
      start: number;
      end: number;
      type: string;
    }> = [];

    // Find all semantic matches
    semanticPatterns.forEach(({ pattern, type }) => {
      // Reset regex lastIndex to ensure proper matching
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          type,
        });
      }
    });

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches (prioritize by pattern order - first wins)
    const filteredMatches = [];
    for (const match of matches) {
      const hasOverlap = filteredMatches.some(
        (existing) =>
          (match.start >= existing.start && match.start < existing.end) ||
          (match.end > existing.start && match.end <= existing.end) ||
          (existing.start >= match.start && existing.start < match.end),
      );
      if (!hasOverlap) {
        filteredMatches.push(match);
      }
    }

    // Create segments with semantic and non-semantic parts
    const segments = [];
    let lastEnd = 0;

    for (const match of filteredMatches) {
      // Add text before this match (only if non-empty)
      if (match.start > lastEnd) {
        const beforeText = text.slice(lastEnd, match.start);
        if (beforeText.trim()) {
          segments.push({
            text: beforeText,
            start: lastEnd,
            end: match.start,
            type: "default",
          });
        }
      }

      // Add the semantic match
      segments.push(match);
      lastEnd = match.end;
    }

    // Add remaining text (only if non-empty)
    if (lastEnd < text.length) {
      const remainingText = text.slice(lastEnd);
      if (remainingText.trim()) {
        segments.push({
          text: remainingText,
          start: lastEnd,
          end: text.length,
          type: "default",
        });
      }
    }

    return segments.length > 0
      ? segments
      : [{ text, start: 0, end: text.length, type: "default" }];
  }

  /**
   * Processes text segments with both semantic coloring and keyword highlighting
   * Now handles multiple semantic types within a single FTS string
   *
   * @param segments - Array of text segments to process
   * @param keywords - Keywords to highlight
   * @param colors - Color theme object
   * @param showQuotes - Whether to add quotes around values
   * @returns HTML string with applied styling
   */
  function processTextSegments(
    segments: Array<{ content: string; type: string }>,
    keywords: string[],
    colors: any,
    showQuotes: boolean = false,
  ): string {
    // Always reconstruct the full text to handle merged consecutive quotes properly
    const fullText = segments.map((s) => s.content).join("");

    // First split by semantic patterns to get multiple semantic types
    const semanticSegments = splitTextBySemantic(fullText);

    // Then apply keyword highlighting to each semantic segment
    return semanticSegments
      .map((segment) => {
        const keywordParts = splitTextByKeywords(segment.text, keywords);

        return keywordParts
          .map((part) => {
            const content = escapeHtml(part.text);
            if (part.isHighlighted) {
              return `<span class="log-highlighted">${content}</span>`;
            } else {
              // Use the detected semantic type from the segment, or detect it
              const semanticType =
                segment.type !== "default"
                  ? segment.type
                  : detectSemanticType(part.text);
              const cssClass = getSemanticCSSClass(semanticType);
              return `<span class="${cssClass}">${content}</span>`;
            }
          })
          .join("");
      })
      .join("");
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
    const segments = smartTokenize(textStr);

    return processTextSegments(segments, keywords, colors, showQuotes);
  }

  return {
    processTextWithHighlights,
    extractKeywords,
    splitTextByKeywords,
    getSingleSemanticColor,
    getSemanticCSSClass,
    escapeHtml,
    isFTSColumn,
  };
}
