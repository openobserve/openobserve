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

// A public dashboard's slug is its bearer secret: anyone holding the page URL
// (/web/public/dashboards/<slug>) or its API URL (/api/public_dashboards/<slug>/…)
// can read the dashboard, so neither may reach telemetry.
const PUBLIC_SLUG = /(\/(?:public\/dashboards|api\/public_dashboards)\/)[^/?#\s]+/g;

/**
 * Replace the secrets a URL can carry with "redacted": sign-in token values in its
 * query or hash, and a public dashboard slug in its path. Everything else is kept.
 * Safe on any text that embeds a URL, such as a network error message.
 */
export function scrubAuthParams(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(AUTH_PARAM, "$1redacted").replace(PUBLIC_SLUG, "$1redacted");
}
