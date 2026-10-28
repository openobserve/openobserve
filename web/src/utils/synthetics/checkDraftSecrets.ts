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

import type { BrowserCheck, HttpCheckConfig } from "@/types/synthetics";
import type { RedactedDraft } from "@/utils/drafts/redactDraftSecrets";

type ValueEntry = { value: string };

/** Blanks the Auth & network and HTTP request header values, the cookie values, the secrets and the secure variables of a check. */
export const redactCheckDraftSecrets = <T extends BrowserCheck>(
  check: T,
  pointerPrefix = "",
): RedactedDraft<T> => {
  const paths: string[] = [];
  const blank = <E extends ValueEntry>(
    field: string,
    list: E[],
    isSecret: (entry: E) => boolean = () => true,
  ): E[] =>
    list.map((entry, index) => {
      if (typeof entry.value !== "string" || entry.value === "" || !isSecret(entry)) return entry;
      paths.push(`${pointerPrefix}/${field}/${index}/value`);
      return { ...entry, value: "" };
    });

  const data: T = { ...check };
  // Custom headers and cookies on this card exist to carry credentials, whatever they are named.
  if (check.headers) data.headers = blank("headers", check.headers);
  if (check.cookies) data.cookies = blank("cookies", check.cookies);
  if (check.secrets) data.secrets = blank("secrets", check.secrets);
  if (check.variables) data.variables = blank("variables", check.variables, (v) => !!v.secure);
  // An HTTP check's own request headers carry credentials just as often, whatever they are named.
  const http = (check as { http?: HttpCheckConfig }).http;
  if (http?.headers?.length) {
    (data as { http?: HttpCheckConfig }).http = {
      ...http,
      headers: blank("http/headers", http.headers),
    };
  }
  return { data, paths };
};

/** The configure cards' validation key (`auth.password`, `headers.0.value`) for a redacted pointer under `pointerPrefix`. */
export const reentryValidationKey = (path: string, pointerPrefix = ""): string =>
  path
    .slice(pointerPrefix.length + 1)
    .split("/")
    .join(".");
