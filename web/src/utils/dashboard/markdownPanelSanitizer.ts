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

// A private instance keeps the link hook out of every other sanitize call in the app.
export const markdownPanelPurifier = DOMPurify(window);

/** True for an http(s) link on another origin; relative, same-origin and non-web links stay in the tab. */
export const isCrossOriginLink = (href: string, pageHref: string): boolean => {
  try {
    const url = new URL(href, pageHref);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin !== new URL(pageHref).origin;
  } catch {
    return false;
  }
};

/** Sanitize rendered Markdown HTML; cross-origin links open in a new tab, and an authored `target` is still stripped. */
export const sanitizeMarkdownPanel = (html: string): string => markdownPanelPurifier.sanitize(html);

markdownPanelPurifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const href = node.getAttribute("href");
  if (href && isCrossOriginLink(href, window.location.href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
