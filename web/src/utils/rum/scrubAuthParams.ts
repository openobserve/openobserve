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

// The SSO callback lands on /web/cb#id_token=…&access_token=…, and RUM records
// that URL verbatim, so the sign-in tokens end up in the RUM stream.
const AUTH_PARAM = /([?#&](?:id_token|access_token|refresh_token|code)=)[^&#]*/g;

const SEP = String.raw`(?:/|%2F|%252F)`;

// A share token is the whole credential of a shared chat, so no URL carries it into telemetry, encoded or not.
const SHARE_PATH = new RegExp(
  String.raw`(${SEP}ai${SEP}(?:public|shared)${SEP}|${SEP}api${SEP}public${SEP}ai_chats${SEP})[^/?#&%\s]+`,
  "gi",
);

/** The RUM event fields that can hold a URL besides the view's. */
export interface ShareScrubbable {
  resource?: { url?: string };
  error?: { resource?: { url?: string } };
  action?: { target?: { name?: string } };
}

/** Replace sign-in token values in a URL's query or hash with "redacted", keeping every other parameter. */
export function scrubAuthParams(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(AUTH_PARAM, "$1redacted");
}

/** Replace the token of every shared-chat page or API path in `text` with ":token". */
export function scrubSharePath<T extends string | undefined>(text: T): T {
  if (!text) return text;
  return text.replace(SHARE_PATH, "$1:token") as T;
}

/** Scrubs share tokens from a RUM event's resource, error resource and action target, in place. */
export function scrubShareTokens(event: ShareScrubbable): void {
  if (event.resource?.url) event.resource.url = scrubSharePath(event.resource.url);
  if (event.error?.resource?.url)
    event.error.resource.url = scrubSharePath(event.error.resource.url);
  if (event.action?.target?.name)
    event.action.target.name = scrubSharePath(event.action.target.name);
}
