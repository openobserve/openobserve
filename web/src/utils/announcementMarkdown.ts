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
import { marked } from "marked";

const ALLOWED_TAGS = ["strong", "em", "b", "i", "code", "del", "a"];

const SAFE_HREF = /^https?:\/\//i;

/** One line of operator-authored markdown as safe inline HTML: emphasis, code and http(s) links only. */
export function renderBannerMessage(message: string): string {
  const html = marked.parseInline(message.replace(/\s*\n\s*/g, " "), { async: false });
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ["href"] });

  // A per-call pass rather than a DOMPurify hook, since hooks are global to every caller in the app.
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (!SAFE_HREF.test(href)) {
      link.replaceWith(...Array.from(link.childNodes));
      return;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });

  return template.innerHTML;
}

/** The message with its markdown removed, for places that show it as plain text. */
export function bannerMessageText(message: string): string {
  const template = document.createElement("template");
  template.innerHTML = renderBannerMessage(message);
  return template.content.textContent ?? "";
}

export type MessageFormat = "bold" | "italic" | "code" | "link";

export interface FormattedText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const WRAPPERS: Record<Exclude<MessageFormat, "link">, string> = {
  bold: "**",
  italic: "_",
  code: "`",
};

/** Applies a toolbar format to the selection; the returned selection is what the author types over next. */
export function applyMessageFormat(
  value: string,
  start: number,
  end: number,
  format: MessageFormat,
  placeholder: string,
): FormattedText {
  const selected = value.slice(start, end) || placeholder;
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (format === "link") {
    const url = "https://";
    const text = `[${selected}](${url})`;
    const urlStart = before.length + selected.length + 3;
    return {
      value: before + text + after,
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    };
  }

  const mark = WRAPPERS[format];
  return {
    value: before + mark + selected + mark + after,
    selectionStart: before.length + mark.length,
    selectionEnd: before.length + mark.length + selected.length,
  };
}

/** Inserts text at the caret, replacing any selection. */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  text: string,
): FormattedText {
  const caret = start + text.length;
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  };
}
