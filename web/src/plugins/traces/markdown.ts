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

import { Marked, Tokenizer } from "marked";
import DOMPurify from "dompurify";
import { SAFE_HTML_TAGS } from "@/utils/safeHtml";

const safeHtmlTags = new Set(SAFE_HTML_TAGS);
const htmlTag = /<\/?([a-zA-Z][\w:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
const htmlTagAtPosition = new RegExp(htmlTag.source, "y");

function startsWithSafeTag(source: string): boolean {
  const name = /^ {0,3}<\/?([a-zA-Z][\w:-]*)(?=[\s/>])/.exec(source)?.[1];
  return !!name && safeHtmlTags.has(name.toLowerCase());
}

function replaceUnknownTags(html: string, replace: (tag: string) => string): string {
  // Match quoted attributes with their outer tag so embedded markup stays literal.
  return html.replace(htmlTag, (tag, name: string) =>
    safeHtmlTags.has(name.toLowerCase()) ? tag : replace(tag),
  );
}

function maskHtmlPrefix(source: string, length: number): string {
  const prefix = source.slice(0, length);
  const parts: string[] = [];
  let offset = 0;
  for (let index = prefix.indexOf("<"); index !== -1;) {
    htmlTagAtPosition.lastIndex = index;
    const match = htmlTagAtPosition.exec(source);
    if (!match) {
      index = prefix.indexOf("<", index + 1);
      continue;
    }
    const end = index + match[0].length;
    if (!safeHtmlTags.has(match[1].toLowerCase())) {
      parts.push(source.slice(offset, index), "x".repeat(match[0].length));
      offset = end;
    }
    index = prefix.indexOf("<", end);
  }
  // A quoted unknown tag can extend beyond the prefix; include it atomically.
  parts.push(source.slice(offset, Math.max(length, offset)));
  return parts.join("");
}

function escapeUnknownTags(html: string): string {
  return replaceUnknownTags(html, (tag) => tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

const markdown = new Marked({
  gfm: true,
  breaks: false,
  // Unknown wrappers use inline parsing so their Markdown still renders.
  tokenizer: {
    html(source) {
      if (!startsWithSafeTag(source)) return;
      const native = Tokenizer.prototype.html.call(this, source);
      if (!native) return;
      let length = Math.min(source.length, native.raw.length + 1);
      for (;;) {
        const masked = maskHtmlPrefix(source, length);
        const token = Tokenizer.prototype.html.call(this, masked);
        if (!token) return;
        if (token.raw.length < masked.length || masked.length === source.length) {
          token.raw = token.text = source.slice(0, token.raw.length);
          return token;
        }
        // Grow only when a masked terminator extends this block, with linear total scanning.
        length = Math.min(source.length, masked.length * 2);
      }
    },
  },
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
