// Copyright 2026 OpenObserve Inc.

import { computed } from "vue";
import { useTextHighlighter } from "@/composables/useTextHighlighter";

/**
 * Keyword and semantic highlighting for OTable cells.
 *
 * Integrates with the project's useTextHighlighter composable to provide:
 * - Keyword matching with background highlight (yellow)
 * - Semantic coloring (IPs blue, URLs green, timestamps, etc.)
 * - FTS (Full Text Search) column detection
 *
 * Two modes:
 * - **Simple mode**: Plain text keyword highlighting for non-log tables
 * - **FTS mode**: Full semantic + keyword highlighting for log/search tables
 */
export function useTableHighlight(props: {
  highlightText?: string;
  highlightFields?: string[];
  /** Whether to use full semantic highlighting (FTS mode) */
  enableSemanticHighlight?: boolean;
  /** Color theme for semantic highlighting */
  semanticColors?: Record<string, string>;
  /** FTS keys for detecting FTS columns */
  ftsKeys?: string[];
}) {
  const { isFTSColumn, processTextWithHighlights, extractKeywords } =
    useTextHighlighter();

  const hasHighlight = computed(() => !!props.highlightText);

  const keywords = computed(() =>
    props.highlightText ? extractKeywords(props.highlightText) : [],
  );

  /**
   * Whether a given column should be highlighted.
   * In simple mode, all columns are highlighted.
   * In FTS mode, only FTS-matching columns are highlighted.
   */
  function shouldHighlightColumn(
    columnId: string,
    cellValue?: any,
  ): boolean {
    if (!props.highlightText) return false;

    // If specific highlight fields are set, only highlight those
    if (
      props.highlightFields &&
      props.highlightFields.length > 0
    ) {
      return props.highlightFields.includes(columnId);
    }

    // If semantic highlighting is enabled, check FTS columns
    if (props.enableSemanticHighlight && props.ftsKeys) {
      return isFTSColumn(columnId, cellValue, props.ftsKeys);
    }

    // Default: highlight all columns
    return true;
  }

  /**
   * Gets highlighted HTML for a cell value.
   * In FTS mode, returns semantic + keyword highlighted HTML.
   * In simple mode, returns keyword-highlighted HTML.
   */
  function getHighlightedHtml(
    columnId: string,
    cellValue: any,
    colors?: Record<string, string>,
  ): string | null {
    if (!props.highlightText || !shouldHighlightColumn(columnId, cellValue)) {
      return null;
    }

    if (
      props.enableSemanticHighlight &&
      props.ftsKeys?.length &&
      isFTSColumn(columnId, cellValue, props.ftsKeys)
    ) {
      // Full semantic + keyword highlighting
      return processTextWithHighlights(
        cellValue,
        props.highlightText,
        colors ?? getDefaultColors(),
        false,
      );
    }

    // Simple keyword highlighting
    return getSimpleHighlightedHtml(cellValue);
  }

  /**
   * Simple keyword highlighting without semantic coloring.
   */
  function getSimpleHighlightedHtml(text: any): string {
    if (!text || !keywords.value.length) return String(text ?? "");
    const str = String(text);
    const escaped = keywords.value.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    const escapedText = str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escapedText.replace(
      pattern,
      '<span class="log-highlighted">$1</span>',
    );
  }

  /**
   * Splits text into segments, marking which match keywords.
   */
  function getHighlightSegments(
    text: string,
  ): { text: string; match: boolean }[] {
    if (!props.highlightText || !text) {
      return [{ text: text ?? "", match: false }];
    }
    if (keywords.value.length === 0)
      return [{ text, match: false }];

    const escaped = keywords.value.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(pattern);

    return parts.map((part) => ({
      text: part,
      match: keywords.value.some(
        (kw) => kw.toLowerCase() === part.toLowerCase(),
      ),
    }));
  }

  return {
    hasHighlight,
    keywords,
    shouldHighlightColumn,
    getHighlightedHtml,
    getSimpleHighlightedHtml,
    getHighlightSegments,
    isFTSColumn,
    processTextWithHighlights,
  };
}

function getDefaultColors(): Record<string, string> {
  return {
    ip: "#3b82f6",
    url: "#22c55e",
    email: "#a855f7",
    timestamp: "#f59e0b",
    path: "#06b6d4",
    numberValue: "#ef4444",
    stringValue: "#6b7280",
    uuid: "#ec4899",
  };
}
