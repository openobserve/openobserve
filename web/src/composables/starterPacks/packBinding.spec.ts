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

import { bindStream, matchField } from "./packBinding";

const sources = {
  groups: [{ id: "k8s-cluster", fields: ["__name__", "k8s_cluster", "cluster_name", "cluster"] }],
  aliases: [["k8s_namespace_name", "namespace", "body_namespace"]],
};

describe("field binding", () => {
  it("keeps an exact name without any binding", () => {
    expect(matchField("k8s_cluster", new Set(["k8s_cluster"]), sources)?.tier).toBe("exact");
    expect(bindStream("s", ["k8s_cluster"], new Set(["k8s_cluster"]), sources)).toEqual([]);
  });

  it("prefers a semantic group, in its order, over an alias list", () => {
    const columns = new Set(["cluster", "cluster_name"]);
    expect(bindStream("s", ["k8s_cluster"], columns, sources)).toEqual([
      {
        stream: "s",
        from: "k8s_cluster",
        to: "cluster_name",
        tier: "semantic",
        group: "k8s-cluster",
      },
    ]);
  });

  it("falls back to the pack's alias list, including the body_ prefix", () => {
    const columns = new Set(["body_namespace"]);
    expect(
      matchField("k8s_namespace_name", columns, { groups: [], aliases: sources.aliases }),
    ).toEqual({ to: "body_namespace", tier: "alias", group: "k8s_namespace_name" });
  });

  it("never binds to __name__", () => {
    expect(matchField("k8s_cluster", new Set(["__name__"]), sources)).toBeNull();
  });

  it("ignores a stored choice of __name__", () => {
    const columns = new Set(["__name__", "cluster_name"]);
    const chosen = { "s/k8s_cluster": "__name__" };
    expect(bindStream("s", ["k8s_cluster"], columns, sources, chosen)[0].to).toBe("cluster_name");
  });

  it("lets the user's choice win", () => {
    const columns = new Set(["cluster_name", "site"]);
    const chosen = { "s/k8s_cluster": "site" };
    expect(bindStream("s", ["k8s_cluster"], columns, sources, chosen)[0]).toMatchObject({
      to: "site",
      tier: "chosen",
    });
  });
});
