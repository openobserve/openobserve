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

import type { CardSubstitutions } from "./types";

/**
 * The `.env` body a setup card hands out: the per-org url, org and Basic-auth
 * token, then any `extra` entries the caller adds (e.g. the web URL for links).
 */
export function buildEnvFile(subs: CardSubstitutions, extra: Record<string, string> = {}): string {
  return (
    `OPENOBSERVE_URL=${subs.url}\n` +
    `OPENOBSERVE_ORG=${subs.org}\n` +
    `OPENOBSERVE_AUTH_TOKEN=Basic ${subs.token}\n` +
    Object.entries(extra)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
}

/** Save the per-org `.env` as a browser download. */
export function downloadEnvFile(subs: CardSubstitutions, extra: Record<string, string> = {}): void {
  const blob = new Blob([buildEnvFile(subs, extra)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ".env";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
