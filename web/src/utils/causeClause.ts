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

/** Turns a server message into a clause that reads after "Couldn't pause:", lowercased unless it opens with an acronym or a mixed-case name. */
export function toCauseClause(message: string): string {
  const text = message.trim().replace(/[\s.!]+$/, "");
  const first = text.match(/^[^\s:,;]+/)?.[0] ?? "";
  // A capital past the first letter marks an acronym (SSRF) or a name (OpenObserve), whose case is part of it.
  if (/[A-Z]/.test(first.slice(1))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
