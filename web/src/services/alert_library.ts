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

import http from "./http";
import type {
  LibrarySuggestQuery,
  LibrarySuggestResponse,
} from "@/utils/alerts/librarySuggest.types";

const alertLibrary = {
  /** Ready-made alerts and starters that fit one stream (B-2); a search runs server-side, not here. */
  suggestions: (org_identifier: string, query: LibrarySuggestQuery) =>
    http().get<LibrarySuggestResponse>(
      `/api/${encodeURIComponent(org_identifier)}/alerts/library/suggestions`,
      // The form says what failed in place, so a denial raises no app-wide toast.
      { params: query, silentForbidden: true } as Record<string, unknown>,
    ),
};

export default alertLibrary;
