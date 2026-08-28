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

/** The subset of each list-API row that the graph reads (rows carry more). */
export interface AlertRow {
  alert_id?: string;
  id?: string;
  name: string;
  destinations?: string[];
  template?: string | null;
  enabled?: boolean;
  folder_id?: string;
}
export interface DestinationRow {
  name: string;
  type?: string;
  template?: string | null;
}
export interface TemplateRow {
  name: string;
  type?: string;
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

  // Build per-relation adjacency maps once (O(edges)) so each traversal below is a
  // handful of O(1) lookups instead of rescanning every edge per node — the earlier
  // nested scans were O(dests × edges) and grew badly on large orgs.
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  const usageBySource = new Map<string, string[]>(); // destination → its alerts
  const usageByTarget = new Map<string, string[]>(); // alert → its destinations
  const templateBySource = new Map<string, string[]>(); // template → destinations
  const templateByTarget = new Map<string, string[]>(); // destination → templates
  const overrideBySource = new Map<string, string[]>(); // template → override alerts
  const overrideByTarget = new Map<string, string[]>(); // alert → override templates
  for (const e of graph.edges) {
    if (e.relation === "usage") {
      push(usageBySource, e.source, e.target);
      push(usageByTarget, e.target, e.source);
    } else if (e.relation === "template") {
      push(templateBySource, e.source, e.target);
      push(templateByTarget, e.target, e.source);
    } else if (e.relation === "override") {
      push(overrideBySource, e.source, e.target);
      push(overrideByTarget, e.target, e.source);
    }
  }

  const ids = new Set<string>();
  const destAlerts = new Map<string, string[]>();
  const addAlertToDest = (destId: string, alertId: string) => push(destAlerts, destId, alertId);

  if (start) {
    ids.add(start);
    if (focus.kind === "destination") {
      for (const tpl of templateByTarget.get(start) ?? []) ids.add(tpl);
      for (const alert of usageBySource.get(start) ?? []) {
        ids.add(alert);
        addAlertToDest(start, alert);
        for (const tpl of overrideByTarget.get(alert) ?? []) ids.add(tpl);
      }
    } else if (focus.kind === "template") {
      for (const dest of templateBySource.get(start) ?? []) {
        ids.add(dest);
        for (const alert of usageBySource.get(dest) ?? []) {
          ids.add(alert);
          addAlertToDest(dest, alert);
        }
      }
      for (const alert of overrideBySource.get(start) ?? []) ids.add(alert);
    } else {
      for (const dest of usageByTarget.get(start) ?? []) {
        ids.add(dest);
        // Record the focused alert against the destination so its chain entry is
        // truthful (not empty); the row badge shows the destination's TOTAL usage.
        addAlertToDest(dest, start);
        for (const tpl of templateByTarget.get(dest) ?? []) ids.add(tpl);
      }
      for (const tpl of overrideByTarget.get(start) ?? []) ids.add(tpl);
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

/** Counts of an entity's chain neighbours, by kind, EXCLUDING the entity itself. */
export interface DepCounts {
  templates: number;
  destinations: number;
  alerts: number;
}

// Per-kind icon + colour for a dependency node — the single source shared by the
// "where used" rows and the list "Used by" column so a kind reads the same in both.
export const depKindIcon = (kind: DepNodeKind): string =>
  kind === "template"
    ? "description"
    : kind === "destination"
      ? "location-on"
      : "shield-alert-outline";

export const depKindColor = (node: Pick<DepNode, "kind" | "orphan" | "missing">): string => {
  if (node.missing) return "text-status-negative";
  if (node.orphan) return "text-status-warning";
  return node.kind === "destination"
    ? "text-info"
    : node.kind === "alert"
      ? "text-status-positive"
      : "text-text-secondary";
};

/** The focus entity's node plus its chain-neighbour counts, in one pass. */
export interface FocusSummary {
  node: DepNode | null;
  counts: DepCounts;
}

// Everything the "Used by" cell needs: the entity's own node (for its
// orphan/missing state) and its chain-neighbour counts (what the popover shows),
// minus the entity itself. Reuses buildFocusChain so the column and the popover
// can never disagree.
export function focusSummary(graph: DepGraph, focus: DepFocus): FocusSummary {
  const chain = buildFocusChain(graph, focus);
  const selfId = chain.focusNode?.id ?? null;
  const notSelf = (n: DepNode) => n.id !== selfId;
  return {
    node: chain.focusNode,
    counts: {
      templates: chain.templates.filter(notSelf).length,
      destinations: chain.destinations.filter(notSelf).length,
      alerts: chain.alerts.filter(notSelf).length,
    },
  };
}

/**
 * The graph one delete later, without refetching it: drops the deleted row and
 * the edges that row was the source of truth for, then re-derives every count and
 * flag. A destination or template that alerts still name survives as a dangling
 * `missing` node — exactly what a rebuild from the server would produce.
 */
export function removeNodeFromGraph(graph: DepGraph, nodeId: string): DepGraph {
  const target = graph.nodes.find((n) => n.id === nodeId);
  if (!target) return graph;

  // An alert row owns every edge pointing at it; a destination row owns only its
  // own template edge; a template row owns none (nothing is derived from one).
  const ownedByDeletedRow = (e: DepEdge) =>
    e.target === nodeId && (target.kind === "alert" || e.relation === "template");

  const edges = graph.edges.filter((e) => !ownedByDeletedRow(e));

  // usageCount is one per outgoing edge, so the surviving edges re-derive it.
  const outgoing = new Map<string, number>();
  const referenced = new Set<string>();
  for (const e of edges) {
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
    referenced.add(e.source);
    referenced.add(e.target);
  }

  // A dangling node exists only because something pointed at it, so it leaves with
  // the last reference — a rebuild would never invent it again.
  const nodes = graph.nodes
    .filter((n) =>
      n.id === nodeId || (n.missing && n.kind !== "alert") ? referenced.has(n.id) : true,
    )
    .map((n) => {
      const usageCount = outgoing.get(n.id) ?? 0;
      const missing = n.id === nodeId ? true : n.missing;
      const orphan = n.kind !== "alert" && !missing && usageCount === 0;
      return n.id === nodeId
        ? { ...n, usageCount, missing, orphan, transport: undefined }
        : { ...n, usageCount, orphan };
    });

  const count = (fn: (n: DepNode) => boolean) => nodes.filter(fn).length;
  return {
    nodes,
    edges,
    stats: {
      templates: count((n) => n.kind === "template" && !n.missing),
      destinations: count((n) => n.kind === "destination" && !n.missing),
      alerts: count((n) => n.kind === "alert"),
      orphanDestinations: count((n) => n.kind === "destination" && n.orphan),
      danglingReferences: count((n) => n.kind !== "alert" && n.missing),
      orphanTemplates: count((n) => n.kind === "template" && n.orphan),
    },
  };
}

/** A node's graph id, so callers can prune one without knowing the id format. */
export const depNodeId = (kind: DepNodeKind, key: string) => `${kind}:${key}`;

const tplId = (name: string) => depNodeId("template", name);
const dstId = (name: string) => depNodeId("destination", name);
const alrId = (id: string) => depNodeId("alert", id);

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

// The graph is identical for every popover in an org and costs three list calls
// (up to the org's full alert list), so build it once and reuse it across opens,
// rows and list pages instead of re-downloading it on every popover open.
// Correctness comes from explicit maintenance — every list page's refresh (post
// add/edit/delete) calls invalidateDependencyGraphCache(), and the impact dialog's
// delete folds itself in via applyDependencyDeletion() — so this TTL only backstops
// changes made in another tab/session; kept long because same-session mutations
// already update the cache immediately.
const GRAPH_TTL_MS = 300_000;
let graphCache: { org: string; graph: DepGraph; at: number } | null = null;

/** Drop the cached graph so the next open refetches (call after a mutation). */
export function invalidateDependencyGraphCache() {
  graphCache = null;
}

/**
 * Fold one delete into the graph every open view is already showing instead of
 * throwing it away: prunes the shared cache (so the next loadGraph is a hit, not
 * three list calls) and returns the pruned graph for the caller's own copy.
 */
export function applyDependencyDeletion(org: string, nodeId: string, current: DepGraph): DepGraph {
  const cached = graphCache?.org === org ? graphCache : null;
  const next = removeNodeFromGraph(cached ? cached.graph : current, nodeId);
  if (cached) graphCache = { ...cached, graph: next };
  return next;
}

export function useDependencyGraph() {
  const graph = ref<DepGraph>(emptyGraph());
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Pure builder — separated from the fetch so it can be unit-tested with fixtures.
  const buildGraph = (
    alerts: AlertRow[],
    destinations: DestinationRow[],
    templates: TemplateRow[],
  ): DepGraph => {
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
    if (graphCache && graphCache.org === org && Date.now() - graphCache.at < GRAPH_TTL_MS) {
      graph.value = graphCache.graph;
      loading.value = false;
      error.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const [alertsRes, destinationsRes, templatesRes] = await Promise.all([
        // v2 list (no folder = every folder). The v1 GET /api/{org}/alerts is not
        // registered in all builds (404), and only v2's item DTO carries the
        // destinations/template fields we cross-reference.
        // NB: this route does NOT paginate — the service never forwards page_num/
        // page_size, so it returns the org's full alert list. That's intentional: a
        // complete graph needs every alert. The leading 1/0 are placeholder args for
        // the shared signature, not a real bound; the per-org cache above keeps this
        // full fetch from repeating on every popover open. The trailing `true` opts
        // in to destinations/template, which the backend omits from the default path.
        alertsService.listByFolderId(
          1,
          0,
          "name",
          false,
          "",
          org,
          undefined,
          undefined,
          undefined,
          true,
        ),
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
      graphCache = { org, graph: graph.value, at: Date.now() };
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
