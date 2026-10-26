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
import {
  escapeHtmlValue,
  processVariableContent,
} from "@/utils/dashboard/variables/variablesUtils";

/** Render panel Markdown to sanitized HTML; variable values go in after parsing, as escaped text, so they never add markup. */
export const renderMarkdownPanel = (
  content: string,
  variablesData: any,
  context?: { tabId?: string; panelId?: string },
): string => {
  const nonce = Math.random().toString(36).slice(2);
  const values: string[] = [];
  const withTokens = processVariableContent(content, variablesData, context, (value) => {
    values.push(escapeHtmlValue(value));
    return `o2var${nonce}x${values.length - 1}x`;
  });
  const html = (marked(withTokens ?? "") as string).replace(
    new RegExp(`o2var${nonce}x(\\d+)x`, "g"),
    (_, index) => values[Number(index)],
  );
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["style"] });
};
