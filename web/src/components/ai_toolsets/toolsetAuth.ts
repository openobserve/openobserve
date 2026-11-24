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

export const CLIENT_CREDENTIALS = "oauth_client_credentials";

/** An MCP toolset's OAuth client credentials as the form holds them; all empty is headers only. */
export interface ToolsetAuth {
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  /** Stored keys this form doesn't edit (e.g. `extra_params`), sent back as they are. */
  extra?: Record<string, any>;
}

interface HeaderRow {
  key?: string;
  value?: string;
}

export const emptyAuth = () => ({
  token_url: "",
  client_id: "",
  client_secret: "",
  scope: "",
  extra: {} as Record<string, any>,
});

/** The client id decides: a token URL alone is only what a preset filled in. */
export const usesClientCredentials = (auth: ToolsetAuth | null | undefined): boolean =>
  !!auth?.client_id?.trim();

/** The stored `auth` in the form's shape; any type but client credentials is headers only. */
export function authFromData(stored: Record<string, any> | null | undefined) {
  if (stored?.type !== CLIENT_CREDENTIALS) return emptyAuth();
  const { type: _type, token_url, client_id, client_secret, scope, ...extra } = stored;
  return {
    token_url: token_url ?? "",
    client_id: client_id ?? "",
    client_secret: client_secret ?? "",
    scope: scope ?? "",
    extra,
  };
}

/** The `auth` to send; `undefined` for headers only, as no `auth` means that. */
export function authPayload(auth: ToolsetAuth | null | undefined): Record<string, any> | undefined {
  if (!auth || !usesClientCredentials(auth)) return undefined;
  const scope = auth.scope?.trim();
  return {
    ...(auth.extra ?? {}),
    type: CLIENT_CREDENTIALS,
    token_url: auth.token_url?.trim() ?? "",
    client_id: auth.client_id?.trim() ?? "",
    client_secret: auth.client_secret ?? "",
    ...(scope ? { scope } : {}),
  };
}

export const isAuthorizationHeader = (row: HeaderRow): boolean =>
  (row.key ?? "").trim().toLowerCase() === "authorization";

/** The header rows a request carries: with client credentials, a preset's empty `Authorization` isn't one. */
export const sentHeaderRows = <T extends HeaderRow>(
  rows: T[] | undefined,
  auth: ToolsetAuth | null | undefined,
): T[] =>
  usesClientCredentials(auth)
    ? (rows ?? []).filter((row) => !isAuthorizationHeader(row) || !!row.value)
    : (rows ?? []);

export function isHttpsUrl(url: string | undefined): boolean {
  try {
    return new URL((url ?? "").trim()).protocol === "https:";
  } catch {
    return false;
  }
}

export function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  try {
    return new URL(a ?? "").origin === new URL(b ?? "").origin;
  } catch {
    return false;
  }
}

/** Every field a token request needs is filled in, or none is in use. */
export const authReady = (auth: ToolsetAuth | null | undefined): boolean =>
  usesClientCredentials(auth)
    ? isHttpsUrl(auth?.token_url) && !!auth?.client_secret?.trim()
    : !auth?.client_secret?.trim();
