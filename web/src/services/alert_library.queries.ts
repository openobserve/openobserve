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

import { queryOptions } from "@tanstack/vue-query";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { orgKey } from "@/composables/query/keys";
import type {
  LibrarySuggestQuery,
  LibrarySuggestResponse,
} from "@/utils/alerts/librarySuggest.types";
import alertLibrary from "./alert_library";

/** Under the alerts scope, so saving an alert refreshes what reads "Already set up". */
export const librarySuggestionKeys = {
  one: (org: string, query: LibrarySuggestQuery) =>
    orgKey(org, "alerts", "library-suggestions", query.stream_type, query.stream_name, {
      alert_type: query.alert_type ?? "scheduled",
      limit: query.limit ?? 4,
    }),
};

/** A server without the endpoint answers 404; the form then shows no cards, and asks only once. */
export const librarySuggestionsQuery = (org: string, query: LibrarySuggestQuery) =>
  queryOptions({
    queryKey: librarySuggestionKeys.one(org, query),
    queryFn: async (): Promise<LibrarySuggestResponse> =>
      (await alertLibrary.suggestions(org, query)).data,
    staleTime: MEDIUM_STALE_TIME,
    retry: false,
  });
