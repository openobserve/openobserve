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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import apiKeys from "./api_keys";
import { apiKeyKeys } from "./api_keys.querykeys";

/** A credential list — memory only, never persisted. */
export const rumTokensQuery = (org: string) =>
  queryOptions({
    queryKey: apiKeyKeys.rumTokens(org),
    queryFn: async () => (await apiKeys.listRUMTokens(org)).data,
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createRumTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => apiKeys.createRUMToken(org),
    meta: { invalidates: [apiKeyKeys.all(org)], silentError: true },
  });
