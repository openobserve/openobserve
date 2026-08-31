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

// Release notes are authored as markdown so a highlight can carry a list, a
// code token, or a link without the manifest growing a schema for each.
//
// The manifest is fetched content, so the output is sanitized before it reaches
// `v-html` — DOMPurify is the same guard the AI setup cards and the dashboard
// markdown panel use.

import DOMPurify from "dompurify";
import { Marked } from "marked";

// A private instance, so these options never leak into the app-wide `marked`
// singleton. `breaks` stays off: release copy is prose, and a soft wrap in the
// source should not become a <br>.
const marked = new Marked({ gfm: true, breaks: false });

/**
 * Sanitized HTML for a block of release copy.
 *
 * Links are forced to open out-of-app: a highlight pointing at the docs must not
 * navigate the dialog's own frame away from the product.
 */
export function renderNotes(markdown: string): string {
  if (!markdown?.trim()) return "";

  const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }), {
    ADD_ATTR: ["target", "rel"],
  });

  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

/**
 * Sanitized HTML for a single line, with the wrapping `<p>` stripped.
 *
 * For copy that has to sit inside an existing block — a list row, a summary
 * line — where a block-level paragraph would add margin the layout did not ask
 * for.
 */
export function renderNotesInline(markdown: string): string {
  if (!markdown?.trim()) return "";

  return DOMPurify.sanitize(marked.parseInline(markdown, { async: false }));
}
