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

import { Marked, type MarkedExtension } from "marked";
import DOMPurify from "dompurify";
import { SAFE_HTML_TAGS } from "@/utils/safeHtml";

const safeHtmlTags = new Set(SAFE_HTML_TAGS);

function tagName(tag: string): string {
  return /^<\/?([\w:-]+)/.exec(tag)?.[1].toLowerCase() ?? "";
}

function escapeAngles(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseMarkdown(content: string): string {
  const openTags: string[] = [];
  const closingTags = new Set<string>();
  const options: MarkedExtension = {
    gfm: true,
    breaks: false,
    tokenizer: { html: () => undefined },
    walkTokens(token) {
      if (token.type === "html" && token.text.startsWith("</")) {
        closingTags.add(tagName(token.text));
      }
    },
    renderer: {
      html({ text }) {
        const name = tagName(text);
        if (text.startsWith("</")) {
          const opening = openTags.lastIndexOf(name);
          if (opening !== -1) openTags.splice(opening);
        } else if (
          !["br", "hr", "img"].includes(name) &&
          !text.endsWith("/>") &&
          (safeHtmlTags.has(name) || closingTags.has(name))
        ) {
          // Unpaired placeholders do not create an HTML or Markdown wrapper context.
          openTags.push(name);
        }
        return safeHtmlTags.has(name) ? text : escapeAngles(text);
      },
      code(token) {
        if (token.codeBlockStyle === "indented" && safeHtmlTags.has(openTags.at(-1) ?? "")) {
          // HTML indentation is formatting; unknown wrappers retain Markdown code semantics.
          return new Marked(options).parse(token.text) as string;
        }
        return false;
      },
      text(token) {
        // Marked skips text escaping inside raw pre/code elements.
        if ("escaped" in token && token.escaped) return escapeAngles(token.text);
        return false;
      },
    },
  };
  // Each message owns its HTML context and is isolated from app-wide Markdown options.
  return new Marked(options).parse(content) as string;
}

/** Render an LLM message as sanitized HTML while preserving unknown tags as text. */
export function renderMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  return DOMPurify.sanitize(parseMarkdown(content));
}
