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
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { RedactedDraft } from "@/utils/drafts/redactDraftSecrets";
import { urlCarriesCredential } from "@/utils/drafts/urlCredentials";

type ValueEntry = { value: string };

/** Blanks a target URL that can hold a credential, the Auth & network and HTTP request header values, the cookie values, the secrets and the secure variables of a check. */
export const redactCheckDraftSecrets = <T extends BrowserCheck>(
  check: T,
  pointerPrefix = "",
  // A tcp, tls or ssh check targets a bare host, which holds no credential.
  { hostTarget = false }: { hostTarget?: boolean } = {},
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
  if (!hostTarget && urlCarriesCredential(check.url ?? "")) {
    data.url = "";
    paths.push(`${pointerPrefix}/url`);
  }
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

type EntryField = {
  name: (check: BrowserCheck, index: number) => string | undefined;
  key: I18nKey;
};

const ENTRY_FIELDS: Record<string, EntryField> = {
  "http/headers": {
    name: (check, index) => (check as { http?: HttpCheckConfig }).http?.headers[index]?.name,
    key: "common.editorDraft.headerField",
  },
  headers: {
    name: (check, index) => check.headers?.[index]?.key,
    key: "common.editorDraft.headerField",
  },
  cookies: {
    name: (check, index) => check.cookies?.[index]?.name,
    key: "common.editorDraft.cookieField",
  },
  secrets: {
    name: (check, index) => check.secrets?.[index]?.name,
    key: "common.editorDraft.secretField",
  },
  variables: {
    name: (check, index) => check.variables?.[index]?.name,
    key: "common.editorDraft.variableField",
  },
};

const ENTRY_PATH = /^\/(http\/headers|headers|cookies|secrets|variables)\/(\d+)\/value$/;

/** Names the fields behind a check's redacted paths; empty when one cannot be named, so the dialog's general note covers them. */
export const describeCheckRedacted = (
  paths: string[],
  check: BrowserCheck,
  t: TranslateFn,
  { pointerPrefix = "", urlLabel }: { pointerPrefix?: string; urlLabel: I18nText },
): I18nText[] => {
  const labels = paths.flatMap((pointer): I18nText[] => {
    const path = pointer.slice(pointerPrefix.length);
    if (path === "/url") return [urlLabel];
    const match = ENTRY_PATH.exec(path);
    const field = match ? ENTRY_FIELDS[match[1]] : undefined;
    const name = match && field ? field.name(check, Number(match[2])) : undefined;
    return field && name ? [t(field.key, { name })] : [];
  });
  return labels.length === paths.length ? labels : [];
};

/** The configure cards' validation key (`auth.password`, `headers.0.value`) for a redacted pointer under `pointerPrefix`. */
export const reentryValidationKey = (path: string, pointerPrefix = ""): string =>
  path
    .slice(pointerPrefix.length + 1)
    .split("/")
    .join(".");
