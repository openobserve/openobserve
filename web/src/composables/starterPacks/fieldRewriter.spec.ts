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

import { describe, expect, it } from "vitest";

import { queryRenames, renamePromqlLabels, renameSqlColumns } from "./fieldRewriter";
import { StreamRewriteError } from "./streamRewriter";

const renames = [{ from: "k8s_cluster", to: "cluster_name" }];

describe("renamePromqlLabels", () => {
  it("renames label lists and matchers but not names or values", () => {
    expect(
      renamePromqlLabels(
        `sum by(k8s_cluster)(k8s_cluster_total{k8s_cluster="k8s_cluster", a='b'}) / on(k8s_cluster) x`,
        renames,
      ),
    ).toBe(
      `sum by(cluster_name)(k8s_cluster_total{cluster_name="k8s_cluster", a='b'}) / on(cluster_name) x`,
    );
  });

  it("refuses a label inside a string argument it cannot reach", () => {
    const query = `label_replace(up, "a", "$1", "k8s_cluster", "(.*)")`;
    expect(() => renamePromqlLabels(query, renames)).toThrow(StreamRewriteError);
  });
});

describe("renameSqlColumns", () => {
  it("renames columns but keeps variables, strings and tables", async () => {
    const sql = `SELECT count(distinct(k8s_cluster)) AS c FROM "k8s_cluster" WHERE k8s_cluster IN (\${k8s_cluster}) AND a = 'k8s_cluster'`;
    const result = await renameSqlColumns(sql, renames);
    expect(result).toContain("cluster_name IN");
    expect(result).toContain("${k8s_cluster}");
    expect(result).toContain(`'k8s_cluster'`);
    expect(result).toContain(`FROM "k8s_cluster"`);
  });
});

describe("queryRenames", () => {
  const binding = (stream: string, to: string) => ({
    stream,
    from: "k8s_cluster",
    to,
    tier: "alias" as const,
  });

  it("agrees when every stream read uses the same spelling", () => {
    const rows = [binding("a", "cluster"), binding("b", "cluster")];
    expect(queryRenames(["a", "b"], rows, "q")).toEqual([{ from: "k8s_cluster", to: "cluster" }]);
  });

  it("refuses streams that spell a field differently", () => {
    expect(() => queryRenames(["a", "b"], [binding("a", "cluster")], "k8s_cluster")).toThrow(
      StreamRewriteError,
    );
  });
});
