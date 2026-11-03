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

// Webhook hosts whose path or subdomain carries the token.
const SECRET_WEBHOOK_HOST =
  /(^|\.)(hooks\.slack(-gov)?\.com|discord(app)?\.com|webhook\.office\.com|outlook\.office\.com|logic\.azure\.com|api\.telegram\.org|hooks\.zapier\.com|maker\.ifttt\.com|m\.pipedream\.net|make\.com)$/i;

// A long path segment with a digit (Mattermost or Rocket.Chat hook keys), or a Telegram `bot<id>:` token.
const TOKEN_SEGMENT = /^(?=.*\d)[\w:-]{20,}$|^bot\d/i;

const parseUrl = (url: string): URL | null => {
  for (const text of [url, `https://${url}`]) {
    try {
      return new URL(text);
    } catch {
      continue;
    }
  }
  return null;
};

/** Whether `url` can hold a credential: userinfo, a query string, a token-like path segment or a webhook host that keys by path. */
export const urlCarriesCredential = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const parsed = parseUrl(trimmed);
  if (!parsed) return /[@?]/.test(trimmed);
  return (
    !!(parsed.username || parsed.password || parsed.search) ||
    SECRET_WEBHOOK_HOST.test(parsed.hostname) ||
    parsed.pathname.split("/").some((segment) => TOKEN_SEGMENT.test(segment))
  );
};
