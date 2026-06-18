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

import type { CardSubstitutions } from "../renderMarkdown";

/** Placeholder shown in masked code instead of the base64 token. */
export const MASKED_TOKEN = "••••••••••••••••••••••••••••";

/** Replace {url}/{org}/{token} in a code template with the given values. */
export function applySubs(template: string, subs: CardSubstitutions): string {
  return template
    .replaceAll("{url}", subs.url)
    .replaceAll("{org}", subs.org)
    .replaceAll("{token}", subs.token);
}

/** The masked counterpart of applySubs — same template, token hidden. */
export function applySubsMasked(
  template: string,
  subs: CardSubstitutions,
): string {
  return applySubs(template, { ...subs, token: MASKED_TOKEN });
}
