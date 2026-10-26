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

const LINK_TAGS = new Set(["a", "area"]);

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

/** Sanitize rendered Markdown HTML without `<style>`, which would restyle the whole app; an authored `target` is still stripped, so only the hook decides where a link opens. */
export const sanitizeMarkdownPanel = (html: string): string =>
  markdownPanelPurifier.sanitize(html, { FORBID_TAGS: ["style"] });

// Authored tokens such as nofollow survive; "opener" would undo the new-tab protection.
const withNoopener = (rel: string | null): string => {
  const tokens = (rel ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && token !== "opener");
  return [...new Set([...tokens, "noopener", "noreferrer"])].join(" ");
};

markdownPanelPurifier.addHook("afterSanitizeAttributes", (node) => {
  // localName, since an SVG anchor's nodeName is lowercase
  if (!LINK_TAGS.has(node.localName)) return;
  const href = node.getAttribute("href") || node.getAttribute("xlink:href");
  if (href && isCrossOriginLink(href, window.location.href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", withNoopener(node.getAttribute("rel")));
  }
});
