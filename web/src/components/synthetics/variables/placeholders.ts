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

/** Every `{{NAME}}` in `text`, case preserved because substitution is an exact key lookup. */
export function placeholderNames(text: string): string[] {
  const names: string[] = [];
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) names.push(match[1]);
  return names;
}

/** Replaces bound `{{NAME}}`s; an unbound one stays verbatim, as the probe leaves it. */
export function substitutePlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match,
  );
}

/** The server's `validate_http_url` for a templated URL: names stand in for a token, no scheme reads as https. */
export function isHttpUrlTemplate(value: string): boolean {
  if (/\s/.test(value)) return false;
  const tokens = Object.fromEntries(placeholderNames(value).map((name) => [name, "placeholder"]));
  const probe = substitutePlaceholders(value, tokens);
  if (probe.includes("{{")) return false;
  try {
    const url = new URL(probe.includes("://") ? probe : `https://${probe}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Names `text` references that none of `known` defines, each once in order of appearance. */
export function unboundPlaceholders(text: string, known: ReadonlySet<string>): string[] {
  return [...new Set(placeholderNames(text))].filter((name) => !known.has(name));
}
