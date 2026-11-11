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

import { vi } from "vitest";

/**
 * A `@/services/searchStream` stand-in that answers through the spec's own `@/services/search` mock,
 * so one set of SQL-keyed responses serves both transports. The whole result arrives as one streamed part.
 *
 *   vi.mock("@/services/searchStream", async () =>
 *     (await import("@/test/unit/helpers/searchStreamMock")).searchStreamViaSearchMock(),
 *   );
 */
export async function searchStreamViaSearchMock() {
  const { default: searchService } = await import("@/services/search");
  return {
    default: {
      search: vi.fn(
        async (params: any, searchType?: string, onRows?: (rows: unknown[]) => void) => {
          const res: any = await searchService.search(params, searchType);
          onRows?.(res?.data?.hits ?? []);
          return res;
        },
      ),
    },
  };
}
