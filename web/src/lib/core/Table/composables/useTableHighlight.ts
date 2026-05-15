// Copyright 2026 OpenObserve Inc.

import { computed } from "vue";

/**
 * Highlights matching text within cell content.
 * Used by OTableBodyCell to render highlighted spans.
 */
export function useTableHighlight(props: {
  highlightText?: string;
  highlightFields?: string[];
}) {
  const hasHighlight = computed(() => !!props.highlightText);

  function getHighlightTokens(text: string): string[] {
    if (!props.highlightText) return [];
    const keywords = props.highlightText
      .split(/\s+/)
      .filter((k) => k.length > 0);
    return keywords;
  }

  function shouldHighlightColumn(columnId: string): boolean {
    if (!props.highlightText) return false;
    if (!props.highlightFields || props.highlightFields.length === 0) {
      return true; // Highlight all columns by default
    }
    return props.highlightFields.includes(columnId);
  }

  /**
   * Splits text into segments, marking which ones match the highlight.
   * Returns array of { text, match } objects.
   */
  function getHighlightSegments(
    text: string,
  ): { text: string; match: boolean }[] {
    if (!props.highlightText || !text) {
      return [{ text: text ?? "", match: false }];
    }

    const tokens = getHighlightTokens(text);
    if (tokens.length === 0) return [{ text, match: false }];

    // Build a regex that matches any of the tokens (case-insensitive)
    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(pattern);

    return parts.map((part) => ({
      text: part,
      match: pattern.test(part),
    }));
  }

  return {
    hasHighlight,
    shouldHighlightColumn,
    getHighlightSegments,
    getHighlightTokens,
  };
}
