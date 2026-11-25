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

function startsWithSafeTag(source: string): boolean {
  const name = /^ {0,3}<\/?([a-zA-Z][\w:-]*)(?=[\s/>])/.exec(source)?.[1];
  return !!name && safeHtmlTags.has(name.toLowerCase());
}

function escapeUnknownTags(html: string): string {
  // Match quoted attributes with their outer tag so embedded markup stays literal.
  return html.replace(
    /<\/?([a-zA-Z][\w:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
    (tag, name: string) =>
      safeHtmlTags.has(name.toLowerCase()) ? tag : tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}

const markdown = new Marked({
  gfm: true,
  breaks: false,
  // Unknown wrappers use inline parsing so their Markdown still renders.
  tokenizer: { html: (source) => (startsWithSafeTag(source) ? false : undefined) },
  renderer: {
    html: ({ text }) => escapeUnknownTags(text),
    // Marked skips text escaping inside raw pre/code elements.
    text: (token) => ("escaped" in token && token.escaped ? escapeUnknownTags(token.text) : false),
  },
});

/** Render an LLM message as sanitized HTML while preserving unknown tags as text. */
export function renderMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  return DOMPurify.sanitize(markdown.parse(content) as string);
}
