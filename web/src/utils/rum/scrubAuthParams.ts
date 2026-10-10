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

/** Replace sign-in token values in a URL's query or hash with "redacted", keeping every other parameter. */
export function scrubAuthParams(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(AUTH_PARAM, "$1redacted");
}
