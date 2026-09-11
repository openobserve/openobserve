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

/**
 * Every `{{NAME}}` a piece of text references, as written.
 *
 * The mirror of the server's `placeholder_names`. Case is preserved rather than
 * folded, because substitution is an exact key lookup on both sides -
 * `{{base_url}}` does not resolve a variable stored as `BASE_URL`, so folding
 * it here would hide a typo the run will surface as literal text.
 */
export function placeholderNames(text: string): string[] {
  const names: string[] = [];
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) names.push(match[1]);
  return names;
}
