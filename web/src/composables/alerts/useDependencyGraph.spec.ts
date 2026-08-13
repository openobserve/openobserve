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
import { useDependencyGraph } from "@/composables/alerts/useDependencyGraph";
import type { DepNode } from "@/composables/alerts/useDependencyGraph";

const { buildGraph } = useDependencyGraph();

const byName = (nodes: DepNode[], name: string, kind: DepNode["kind"]) =>
  nodes.find((n) => n.name === name && n.kind === kind)!;

describe("useDependencyGraph.buildGraph", () => {
  it("links Template → Destination → Alert by name", () => {
    const { nodes, edges, stats } = buildGraph(
      [
        {
          alert_id: "a1",
          name: "cpu",
          destinations: ["slack"],
          enabled: true,
          folder_id: "default",
        },
      ],
      [{ name: "slack", type: "http", template: "tpl" }],
      [{ name: "tpl", type: "http" }],
    );

    expect(stats).toMatchObject({ templates: 1, destinations: 1, alerts: 1 });
    // Destination shows its alert usage; template feeds the destination.
    expect(byName(nodes, "slack", "destination").usageCount).toBe(1);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "template",
          source: "template:tpl",
          target: "destination:slack",
        }),
        expect.objectContaining({
          relation: "usage",
          source: "destination:slack",
          target: "alert:a1",
        }),
      ]),
    );
  });

  it("flags an unused destination and an orphan template", () => {
    const { nodes, stats } = buildGraph(
      [],
      [{ name: "pager", type: "http", template: undefined }],
      [{ name: "lonely", type: "email" }],
    );

    expect(byName(nodes, "pager", "destination").orphan).toBe(true);
    expect(byName(nodes, "lonely", "template").orphan).toBe(true);
    expect(stats.orphanDestinations).toBe(1);
    expect(stats.orphanTemplates).toBe(1);
  });

  it("flags a dangling destination reference (alert points at a missing destination)", () => {
    const { nodes, stats } = buildGraph(
      [{ alert_id: "a1", name: "disk", destinations: ["ghost"], enabled: true }],
      [],
      [],
    );

    const ghost = byName(nodes, "ghost", "destination");
    expect(ghost.missing).toBe(true);
    expect(ghost.orphan).toBe(false);
    expect(stats.danglingReferences).toBe(1);
  });

  it("draws a dashed override edge when the alert sets its own template", () => {
    const { edges } = buildGraph(
      [
        {
          alert_id: "a1",
          name: "mem",
          destinations: ["slack"],
          template: "override-tpl",
          enabled: true,
        },
      ],
      [{ name: "slack", type: "http", template: "dest-tpl" }],
      [
        { name: "override-tpl", type: "http" },
        { name: "dest-tpl", type: "http" },
      ],
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "override",
          source: "template:override-tpl",
          target: "alert:a1",
        }),
      ]),
    );
  });

  it("counts one destination shared by two alerts", () => {
    const { nodes } = buildGraph(
      [
        { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true },
        { alert_id: "a2", name: "mem", destinations: ["slack"], enabled: true },
      ],
      [{ name: "slack", type: "http" }],
      [],
    );

    expect(byName(nodes, "slack", "destination").usageCount).toBe(2);
  });
});
