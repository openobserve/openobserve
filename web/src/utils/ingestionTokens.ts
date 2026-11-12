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

/** The server reserves this prefix for tokens its own features write with. */
const RESERVED_TOKEN_PREFIX = "_o2_";
/** The creator the server stamps on the tokens it makes itself. */
const SYSTEM_CREATOR = "system";

/** True for an `_o2_` name, which HTTP ingest never accepts whoever made the token. */
export function isReservedIngestionTokenName(name: string | undefined): boolean {
  return !!name?.startsWith(RESERVED_TOKEN_PREFIX);
}

/** True for a token an OpenObserve feature holds; `default` is server-made too, so the name decides as well. */
export function isSystemIngestionToken(token: { name: string; created_by?: string }): boolean {
  return isReservedIngestionTokenName(token.name) && token.created_by === SYSTEM_CREATOR;
}

/** The tokens an ingestion snippet may offer: none with a reserved name. */
export function pickableIngestionTokens<T extends { name: string }>(tokens: T[]): T[] {
  return tokens.filter((token) => !isReservedIngestionTokenName(token.name));
}
