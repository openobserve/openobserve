// Copyright 2026 OpenObserve Inc.

import DOMPurify from "dompurify";

/**
 * Provides a sanitize function wrapping DOMPurify for safe v-html rendering.
 *
 * All highlighted HTML output passes through this before v-html injection.
 * The highlighting composables already escape text content, but this adds
 * defense-in-depth against XSS from user-supplied field values.
 */
export function useSanitizedHtml() {
  function sanitize(html: string): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["span"],
      ALLOWED_ATTR: ["class"],
    });
  }

  return { sanitize };
}
