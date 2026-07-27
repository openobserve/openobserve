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

import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";

const VRL_PROMPTS = [
  'Write a VRL function. e.g. .status = "active"',
  'Write a VRL function. e.g. if .level == "error" { .alert = true }',
  "Write a VRL function. e.g. del(.sensitive_field)",
  "Write a VRL function. e.g. .count = int!(.count) + 1",
  "Write a VRL function. e.g. .message = downcase!(string!(.message))",
];

const JS_PROMPTS = [
  'Write a JS function. e.g. row.status = "active";',
  'Write a JS function. e.g. if (row.level === "error") row.alert = true;',
  "Write a JS function. e.g. delete row.sensitive_field;",
  "Write a JS function. e.g. row.count = parseInt(row.count) + 1;",
];

/** Typewriter placeholder for VRL function editors. */
export function useVrlPlaceholder() {
  return useTypewriterPlaceholder(VRL_PROMPTS);
}

/** Typewriter placeholder for JavaScript function editors. */
export function useJsPlaceholder() {
  return useTypewriterPlaceholder(JS_PROMPTS);
}
