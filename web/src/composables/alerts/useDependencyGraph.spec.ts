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
import {
  useDependencyGraph,
  buildFocusChain,
  focusSummary,
  depKindIcon,
  depKindColor,
} from "@/composables/alerts/useDependencyGraph";
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

describe("buildFocusChain", () => {
  // slack ← tpl-http, used by cpu + mem; pager ← tpl-http too (sibling branch).
  const graph = buildGraph(
    [
      { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true },
      { alert_id: "a2", name: "mem", destinations: ["slack"], enabled: true },
      { alert_id: "a3", name: "disk", destinations: ["pager"], enabled: true },
    ],
    [
      { name: "slack", type: "http", template: "tpl-http" },
      { name: "pager", type: "http", template: "tpl-http" },
    ],
    [{ name: "tpl-http", type: "http" }],
  );

  it("destination focus = its template + its alerts, NOT sibling destinations", () => {
    const chain = buildFocusChain(graph, { kind: "destination", name: "slack" });
    expect(chain.focusNode?.name).toBe("slack");
    expect(chain.templates.map((n) => n.name)).toEqual(["tpl-http"]);
    expect(chain.alerts.map((n) => n.name).sort()).toEqual(["cpu", "mem"]);
    // The shared template must NOT drag in 'pager' or its alert 'disk'.
    expect(chain.destinations.map((n) => n.name)).toEqual(["slack"]);
    expect(chain.alerts.map((n) => n.name)).not.toContain("disk");
  });

  it("template focus = destinations using it + their alerts", () => {
    const chain = buildFocusChain(graph, { kind: "template", name: "tpl-http" });
    expect(chain.destinations.map((n) => n.name).sort()).toEqual(["pager", "slack"]);
    expect(chain.alerts.map((n) => n.name).sort()).toEqual(["cpu", "disk", "mem"]);
    // The destination carries its own alert count.
    expect(chain.destinations.find((d) => d.name === "slack")?.alerts.length).toBe(2);
  });

  it("alert focus = its destination + that destination's template", () => {
    const chain = buildFocusChain(graph, { kind: "alert", alertId: "a1", name: "cpu" });
    expect(chain.focusNode?.name).toBe("cpu");
    expect(chain.destinations.map((n) => n.name)).toEqual(["slack"]);
    expect(chain.templates.map((n) => n.name)).toEqual(["tpl-http"]);
    const slack = chain.destinations.find((d) => d.name === "slack")!;
    // The destination's badge shows its TOTAL usage (cpu + mem), not just the
    // focused alert — so it never renders a misleading "0 alerts" on alert focus.
    expect(slack.usageCount).toBe(2);
    // …and its chain entry now records the focused alert rather than being empty.
    expect(slack.alerts.map((n) => n.name)).toEqual(["cpu"]);
  });
});

describe("focusSummary", () => {
  const graph = buildGraph(
    [
      { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true },
      { alert_id: "a2", name: "mem", destinations: ["slack"], enabled: false },
      { alert_id: "a3", name: "disk", destinations: ["pager"], enabled: true },
    ],
    [
      { name: "slack", type: "http", template: "tpl-http" },
      { name: "pager", type: "http", template: "tpl-http" },
      { name: "lonely", type: "email" },
    ],
    [{ name: "tpl-http", type: "http" }],
  );

  it("counts a destination's neighbours (alerts + template), excluding itself", () => {
    const { node, counts } = focusSummary(graph, { kind: "destination", name: "slack" });
    expect(node?.name).toBe("slack");
    expect(counts).toEqual({ templates: 1, destinations: 0, alerts: 2 });
  });

  it("counts a template's neighbours (destinations + alerts), excluding itself", () => {
    const { counts } = focusSummary(graph, { kind: "template", name: "tpl-http" });
    expect(counts).toEqual({ templates: 0, destinations: 2, alerts: 3 });
  });

  it("counts an alert's neighbours (destination + template), excluding itself", () => {
    const { counts } = focusSummary(graph, { kind: "alert", alertId: "a1", name: "cpu" });
    expect(counts).toEqual({ templates: 1, destinations: 1, alerts: 0 });
  });

  it("marks an orphan destination (no alerts) and keeps zero counts", () => {
    const { node, counts } = focusSummary(graph, { kind: "destination", name: "lonely" });
    expect(node?.orphan).toBe(true);
    expect(counts.alerts).toBe(0);
  });
});

describe("dependency kind helpers", () => {
  it("maps each kind to its icon", () => {
    expect(depKindIcon("template")).toBe("description");
    expect(depKindIcon("destination")).toBe("location-on");
    expect(depKindIcon("alert")).toBe("shield-alert-outline");
  });

  it("colours by state first, then kind", () => {
    expect(depKindColor({ kind: "destination", orphan: false, missing: true })).toBe(
      "text-status-negative",
    );
    expect(depKindColor({ kind: "destination", orphan: true, missing: false })).toBe(
      "text-status-warning",
    );
    expect(depKindColor({ kind: "destination", orphan: false, missing: false })).toBe("text-info");
    expect(depKindColor({ kind: "alert", orphan: false, missing: false })).toBe(
      "text-status-positive",
    );
    expect(depKindColor({ kind: "template", orphan: false, missing: false })).toBe(
      "text-text-secondary",
    );
  });
});
