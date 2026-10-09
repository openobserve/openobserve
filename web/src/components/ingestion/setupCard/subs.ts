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

import { maskSecret } from "@/composables/useCredentialSnippet";
import type { CardSubstitutions } from "./types";

/** Placeholder shown in masked code while the token is not known yet. */
export const MASKED_TOKEN = "••••••••••••••••••••••••••••";

/**
 * Returns `url` only if it's a safe http(s)/mailto link, else "#". External
 * content (manifest / md frontmatter) can supply these hrefs, and Vue does NOT
 * sanitize `:href` — so this blocks `javascript:` / `data:` URL XSS on click.
 */
export function safeHttpUrl(url?: string): string {
  if (!url) return "#";
  try {
    const proto = new URL(url, window.location.origin).protocol;
    return proto === "http:" || proto === "https:" || proto === "mailto:" ? url : "#";
  } catch {
    return "#";
  }
}

/** Replace {url}/{org}/{token} in a code template with the given values. */
export function applySubs(template: string, subs: CardSubstitutions): string {
  return template
    .replaceAll("{url}", subs.url)
    .replaceAll("{org}", subs.org)
    .replaceAll("{token}", subs.token);
}

/** The masked counterpart of applySubs: the token keeps its first and last four characters, as on every snippet. */
export function applySubsMasked(template: string, subs: CardSubstitutions): string {
  return applySubs(template, {
    ...subs,
    token: subs.token ? maskSecret(subs.token) : MASKED_TOKEN,
  });
}
