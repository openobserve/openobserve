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

import { describe, it, expect } from "vitest";
import { mapChart } from "./dashboardAutoQueryBuilder";
import { parseWhereClauseToFilter } from "@/utils/query/sqlUtils";

// SQL -> builder filter -> SQL, with the real parser (issue 16022).
const panel = (conditions: any[]) => ({
  data: {
    queries: [
      {
        fields: {
          stream: "logs",
          name: {
            alias: "n",
            column: "service_name",
            functionName: null,
            args: [{ type: "field", value: { field: "service_name" } }],
          },
          value_for_maps: {
            alias: "cnt",
            column: "count",
            functionName: "count",
            args: [{ type: "field", value: { field: "id" } }],
          },
          filter: { conditions },
        },
        joins: [],
        config: { limit: 100 },
      },
    ],
  },
  layout: { currentQueryIndex: 0 },
  meta: {
    streamFields: {
      groupedFields: [
        {
          stream_alias: null,
          schema: [
            { name: "service_name", type: "Utf8" },
            { name: "id", type: "Int64" },
          ],
        },
      ],
    },
  },
});

const roundTrip = async (where: string) => {
  const filter = await parseWhereClauseToFilter(where);
  return mapChart(panel(filter.conditions));
};

describe("Visualize keeps empty-string filters from SQL", () => {
  it("keeps != '' after IS NOT NULL", async () => {
    expect(await roundTrip("service_name IS NOT NULL AND service_name != ''")).toContain(
      "WHERE service_name IS NOT NULL AND service_name <> '' GROUP BY",
    );
  });

  it("keeps a lone != ''", async () => {
    expect(await roundTrip("service_name != ''")).toContain("WHERE service_name <> '' GROUP BY");
  });

  it("keeps = ''", async () => {
    expect(await roundTrip("service_name = ''")).toContain("WHERE service_name = '' GROUP BY");
  });

  it("does not flag a non-empty literal", async () => {
    const filter = await parseWhereClauseToFilter("service_name != 'api'");
    expect(filter.conditions[0].emptyLiteral).toBeUndefined();
  });
});
