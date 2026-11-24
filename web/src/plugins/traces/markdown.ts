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

import { Marked } from "marked";
import DOMPurify from "dompurify";
import { SAFE_HTML_TAGS } from "@/utils/safeHtml";

const safeHtmlTags = new Set(SAFE_HTML_TAGS);

// Isolate trace rendering from app-wide Markdown options.
const md = new Marked({
  gfm: true,
  breaks: false,
  tokenizer: {
    // Block HTML bypasses Markdown and placeholder parsing inside its contents.
    html: () => undefined,
    tag(src) {
      const tag = /^<\/?([a-z][a-z0-9]*)(?=[\s/>])/i.exec(src)?.[1];
      return tag && safeHtmlTags.has(tag.toLowerCase()) ? false : undefined;
    },
  },
  renderer: {
    text(token) {
      // Marked skips text escaping inside raw pre/code elements.
      if ("escaped" in token && token.escaped) {
        return token.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
      return false;
    },
  },
});

/** Render an LLM message as sanitized HTML while preserving unknown tags as text. */
export function renderMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  return DOMPurify.sanitize(md.parse(content) as string);
}
