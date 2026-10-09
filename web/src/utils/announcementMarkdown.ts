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

import DOMPurify from "dompurify";
import { Marked } from "marked";

const ALLOWED_TAGS = ["strong", "em", "b", "i", "code", "del", "a"];

const ALLOWED_ATTR = ["href", "target", "rel"];

const SAFE_HREF = /^https?:\/\//i;

const LINK_URL = "https://";

const WRAPPERS: Record<Exclude<MarkdownFormat, "link">, string> = {
  bold: "**",
  italic: "_",
  code: "`",
};

// A private instance so the raw-HTML override never leaks into other markdown in the app.
const bannerMarked = new Marked({ gfm: true });
bannerMarked.use({ renderer: { html: ({ text }) => escapeHtml(text) } });

export type MarkdownFormat = "bold" | "italic" | "code" | "link";

/** The edited text plus the selection to restore after a toolbar action. */
export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Banner markdown as inline HTML: bold, italic, code, strikethrough and http(s) links only. */
export function renderBannerMarkdown(message: string | null | undefined): string {
  if (!message) return "";

  const html = bannerMarked.parseInline(message, { async: false }) as string;

  const container = document.createElement("template");
  container.innerHTML = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });

  container.content.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (SAFE_HREF.test(href.trim())) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    } else {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
    }
  });

  return container.innerHTML;
}

/** Wraps the selection in the format's markers, or inserts empty markers at the caret. */
export function applyMarkdownFormat(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): FormatResult {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (format === "link") {
    const inserted = `[${selected}](${LINK_URL})`;
    // With text selected the URL is what is left to type; without, the link text is.
    const caret = selected ? start + inserted.length - 1 : start + 1;
    return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret };
  }

  const marker = WRAPPERS[format];
  const innerStart = start + marker.length;
  return {
    value: before + marker + selected + marker + after,
    selectionStart: innerStart,
    selectionEnd: innerStart + selected.length,
  };
}

/** Inserts text at the caret, replacing any selection. */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  text: string,
): FormatResult {
  const caret = start + text.length;
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  };
}
