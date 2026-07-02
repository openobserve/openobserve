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

// Own Marked instance so we never touch the app-wide `marked` config. GFM gives
// headings, tables, code fences, bold, lists — what LLM responses use.
const md = new Marked({ gfm: true, breaks: false });

/**
 * Render an LLM message's markdown to sanitized HTML for `v-html`. Pair with the
 * `.markdown-body` class (see `markdownBody.scss`) for the element styling.
 * Returns "" for empty input. DOMPurify sanitizes against XSS.
 */
export function renderMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  return DOMPurify.sanitize(md.parse(content) as string);
}
