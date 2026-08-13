/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Builds the notification dependency graph (Template → Destination → Alert) by
// cross-referencing the three existing list APIs client-side. There is no
// reverse-lookup endpoint: the linkage lives only in `alert.destinations`
// (destination NAMES), `alert.template` (an alert-level template override) and a
// destination's own `template`. We fetch all three lists and match by name.
//
// The alert list DTO now carries `destinations` + `template` (an additive field
// on ListAlertsResponseBodyItem), so the whole graph is three list calls with no
// per-alert detail fetch.
//
// Output is an abstract, layout-free model (nodes carry kind + flags, edges carry
// the relation) so it stays unit-testable; the view owns positioning + rendering.

import { ref } from "vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";

export type DepNodeKind = "template" | "destination" | "alert";

/** One entity to focus the graph on (its dependency chain), used by the popup. */
export type DepFocus = { kind: DepNodeKind; name?: string; alertId?: string };

export type DepRelation = "usage" | "template" | "override";

export interface DepNode {
  /** `${kind}:${name}` — stable across rebuilds; alerts key on their id. */
  id: string;
  kind: DepNodeKind;
  /** Display name; also the join key for destinations/templates. */
  name: string;
  /** Destination/template transport kind (http | email | sns | action). */
  transport?: string;
  /** Destinations: how many alerts deliver to it. Templates: dest + override refs. */
  usageCount: number;
  /** A destination with no alerts, or a template referenced by nothing. */
  orphan: boolean;
  /**
   * A destination NAME referenced by an alert but absent from the destination
   * list (broken alert), or a template referenced but not defined. This state is
   * otherwise invisible today — it only surfaces as a runtime notification miss.
   */
  missing: boolean;
  /** Alert-only: enabled flag, for a muted look on disabled alerts. */
  enabled?: boolean;
  /** Alert-only: id + folder, so the view can deep-link to the alert. */
  alertId?: string;
  folderId?: string;
}

export interface DepEdge {
  id: string;
  source: string;
  target: string;
  relation: DepRelation;
}

export interface DepGraph {
  nodes: DepNode[];
  edges: DepEdge[];
  stats: {
    templates: number;
    destinations: number;
    alerts: number;
    orphanDestinations: number;
    danglingReferences: number;
    orphanTemplates: number;
  };
}

/** A destination in a focus chain, with the alerts it feeds. */
export type ChainDestination = DepNode & { alerts: DepNode[] };

/** One entity's dependency chain, grouped for the compact panel. */
export interface FocusChain {
  focusNode: DepNode | null;
  templates: DepNode[];
  destinations: ChainDestination[];
  /** Flat list of every alert in the chain (paginated by the panel). */
  alerts: DepNode[];
}

// Resolve one entity's dependency chain from the full graph, traversed
// DIRECTIONALLY so a shared template pulls in only the focused branch (never
// sibling destinations). Pure + exported so the panel stays thin and testable.
export function buildFocusChain(graph: DepGraph, focus: DepFocus): FocusChain {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  let start: string | null = null;
  if (focus.kind === "alert") {
    const n = graph.nodes.find(
      (x) => x.kind === "alert" && (x.alertId === focus.alertId || x.name === focus.name),
    );
    start = n?.id ?? null;
  } else {
    const id = `${focus.kind}:${focus.name}`;
    start = graph.nodes.some((x) => x.id === id) ? id : null;
  }

  const ids = new Set<string>();
  const destAlerts = new Map<string, string[]>();
  const addAlertToDest = (destId: string, alertId: string) => {
    if (!destAlerts.has(destId)) destAlerts.set(destId, []);
    destAlerts.get(destId)!.push(alertId);
  };

  if (start) {
    ids.add(start);
    const edges = graph.edges;
    if (focus.kind === "destination") {
      for (const e of edges) if (e.relation === "template" && e.target === start) ids.add(e.source);
      for (const e of edges)
        if (e.relation === "usage" && e.source === start) {
          ids.add(e.target);
          addAlertToDest(start, e.target);
        }
      const alertIds = destAlerts.get(start) ?? [];
      for (const a of alertIds)
        for (const e of edges) if (e.relation === "override" && e.target === a) ids.add(e.source);
    } else if (focus.kind === "template") {
      const dests: string[] = [];
      for (const e of edges)
        if (e.relation === "template" && e.source === start) {
          ids.add(e.target);
          dests.push(e.target);
        }
      for (const d of dests)
        for (const e of edges)
          if (e.relation === "usage" && e.source === d) {
            ids.add(e.target);
            addAlertToDest(d, e.target);
          }
      for (const e of edges) if (e.relation === "override" && e.source === start) ids.add(e.target);
    } else {
      const dests: string[] = [];
      for (const e of edges)
        if (e.relation === "usage" && e.target === start) {
          ids.add(e.source);
          dests.push(e.source);
        }
      for (const d of dests)
        for (const e of edges) if (e.relation === "template" && e.target === d) ids.add(e.source);
      for (const e of edges) if (e.relation === "override" && e.target === start) ids.add(e.source);
    }
  }

  const chain = graph.nodes.filter((n) => ids.has(n.id));
  return {
    focusNode: start ? (byId.get(start) ?? null) : null,
    templates: chain.filter((n) => n.kind === "template"),
    destinations: chain
      .filter((n) => n.kind === "destination")
      .map((d) => ({
        ...d,
        alerts: (destAlerts.get(d.id) ?? []).map((id) => byId.get(id)!).filter(Boolean),
      })),
    alerts: chain.filter((n) => n.kind === "alert"),
  };
}

const tplId = (name: string) => `template:${name}`;
const dstId = (name: string) => `destination:${name}`;
const alrId = (id: string) => `alert:${id}`;

const emptyGraph = (): DepGraph => ({
  nodes: [],
  edges: [],
  stats: {
    templates: 0,
    destinations: 0,
    alerts: 0,
    orphanDestinations: 0,
    danglingReferences: 0,
    orphanTemplates: 0,
  },
});

export function useDependencyGraph() {
  const graph = ref<DepGraph>(emptyGraph());
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Pure builder — separated from the fetch so it can be unit-tested with fixtures.
  const buildGraph = (alerts: any[], destinations: any[], templates: any[]): DepGraph => {
    const nodes = new Map<string, DepNode>();
    const edges: DepEdge[] = [];

    const templateNode = (name: string): DepNode => {
      const id = tplId(name);
      let node = nodes.get(id);
      if (!node) {
        node = { id, kind: "template", name, usageCount: 0, orphan: false, missing: true };
        nodes.set(id, node);
      }
      return node;
    };
    const destinationNode = (name: string): DepNode => {
      const id = dstId(name);
      let node = nodes.get(id);
      if (!node) {
        node = { id, kind: "destination", name, usageCount: 0, orphan: false, missing: true };
        nodes.set(id, node);
      }
      return node;
    };

    // Seed the DEFINED templates + destinations first, so `missing` starts false
    // for anything that actually exists; still-missing nodes below are dangling
    // references discovered only through an alert/destination pointing at them.
    for (const tpl of templates) {
      const node = templateNode(tpl.name);
      node.missing = false;
      node.transport = tpl.type;
    }
    for (const dst of destinations) {
      const node = destinationNode(dst.name);
      node.missing = false;
      node.transport = dst.type;
      // Destination's default template (used unless an alert overrides it).
      if (dst.template) {
        const tpl = templateNode(dst.template);
        tpl.usageCount += 1;
        edges.push({
          id: `e:tpl:${dst.template}->dst:${dst.name}`,
          source: tpl.id,
          target: node.id,
          relation: "template",
        });
      }
    }

    // Alerts are the demand side: each `destinations` name is a usage edge, and an
    // `alert.template` is a dashed override edge straight to the template.
    for (const alert of alerts) {
      const id = alrId(alert.alert_id ?? alert.id ?? alert.name);
      const alertNode: DepNode = {
        id,
        kind: "alert",
        name: alert.name,
        usageCount: 0,
        orphan: false,
        missing: false,
        enabled: alert.enabled !== false,
        alertId: alert.alert_id ?? alert.id,
        folderId: alert.folder_id,
      };
      nodes.set(id, alertNode);

      for (const destName of alert.destinations ?? []) {
        const dst = destinationNode(destName);
        dst.usageCount += 1;
        edges.push({
          id: `e:dst:${destName}->alr:${id}`,
          source: dst.id,
          target: id,
          relation: "usage",
        });
      }

      if (alert.template) {
        const tpl = templateNode(alert.template);
        tpl.usageCount += 1;
        edges.push({
          id: `e:tpl:${alert.template}->alr:${id}`,
          source: tpl.id,
          target: id,
          relation: "override",
        });
      }
    }

    // Derive the flag states now that every reference has been counted.
    let orphanDestinations = 0;
    let danglingReferences = 0;
    let orphanTemplates = 0;
    for (const node of nodes.values()) {
      if (node.kind === "destination") {
        node.orphan = !node.missing && node.usageCount === 0;
        if (node.orphan) orphanDestinations += 1;
        if (node.missing) danglingReferences += 1;
      } else if (node.kind === "template") {
        node.orphan = !node.missing && node.usageCount === 0;
        if (node.orphan) orphanTemplates += 1;
        if (node.missing) danglingReferences += 1;
      }
    }

    return {
      nodes: [...nodes.values()],
      edges,
      stats: {
        templates: templates.length,
        destinations: destinations.length,
        alerts: alerts.length,
        orphanDestinations,
        danglingReferences,
        orphanTemplates,
      },
    };
  };

  const loadGraph = async (org: string) => {
    loading.value = true;
    error.value = null;
    try {
      const [alertsRes, destinationsRes, templatesRes] = await Promise.all([
        // v2 list (no folder = every folder). The v1 GET /api/{org}/alerts is not
        // registered in all builds (404), and only v2's item DTO carries the
        // destinations/template fields we cross-reference.
        alertsService.listByFolderId(1, 100000, "name", false, "", org),
        destinationService.list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: org,
          module: "alert",
        }),
        templateService.list({ org_identifier: org }),
      ]);

      const alerts = alertsRes.data?.list ?? alertsRes.data ?? [];
      const destinations = destinationsRes.data ?? [];
      const templates = templatesRes.data ?? [];

      graph.value = buildGraph(alerts, destinations, templates);
    } catch (err: any) {
      error.value = err?.response?.data?.message || err?.message || "unknown";
      graph.value = emptyGraph();
    } finally {
      loading.value = false;
    }
  };

  return { graph, loading, error, loadGraph, buildGraph };
}

export default useDependencyGraph;
