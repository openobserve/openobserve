// Prototype risk-graph builder for the Entities view. Mirrors the model in
// design doc 19 (base risk -> propagation -> attack-path to crown jewels), run
// over synthesized relationships until the `_o2_entity_edges` stream and the
// scheduled graph job exist. Pure and deterministic so the view is stable.

export type RiskKind = "user" | "ip" | "host";
export type RiskTier = "critical" | "high" | "medium" | "low";

export interface RiskRowInput {
  value: string;
  events: number;
  failures: number;
  failureEvents: number;
  peers: number;
  streams: string[];
}

export interface RiskNode {
  id: string;
  label: string;
  kind: RiskKind | "asset";
  crownJewel: boolean;
  /** Intrinsic risk, 0..100 (doc 19 §2.1 b(v)). */
  base: number;
  /** Propagated risk after diffusion, 0..100 (doc 19 §3.1 R). */
  propagated: number;
  /** Reachability-weighted criticality downstream, 0..100 (doc 19 §3.3 Blast). */
  blast: number;
  /** Attack-path risk toward a crown jewel, 0..100 (doc 19 §3.2 AR). */
  attack: number;
  /** Composite Risk★, 0..100 (doc 19 §3.4). */
  score: number;
  tier: RiskTier;
}

export interface RiskEdge {
  source: string;
  target: string;
  type: string;
  /** Traversal probability, 0..1 (doc 19 §2.2 p(e)). */
  p: number;
  /** On the most dangerous entry->crown-jewel path. */
  onPath: boolean;
}

export interface RiskGraph {
  nodes: RiskNode[];
  edges: RiskEdge[];
  crownJewels: string[];
  /** Node ids along the single most dangerous path, entry -> crown jewel. */
  topPath: string[];
}

const TIER_THRESHOLDS: [RiskTier, number][] = [
  ["critical", 80],
  ["high", 60],
  ["medium", 35],
  ["low", 0],
];

export function tierOf(score: number): RiskTier {
  for (const [tier, min] of TIER_THRESHOLDS) if (score >= min) return tier;
  return "low";
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

// Intrinsic risk from the signals the Entities view already carries: failure
// rate dominates, breadth of peers and raw activity contribute. Stands in for
// doc 19's b(v) (findings + intel + UEBA) until those feeds are wired.
function baseRisk(row: RiskRowInput): number {
  const failureRate = row.failureEvents > 0 ? row.failures / row.failureEvents : 0;
  const peerSpread = Math.log10(1 + row.peers) / Math.log10(1 + 200); // 0..~1
  const activity = Math.log10(1 + row.events) / Math.log10(1 + 1_000_000); // 0..~1
  return clamp(100 * (0.6 * failureRate + 0.28 * peerSpread + 0.12 * activity));
}

const CROWN_JEWELS: { id: string; label: string }[] = [
  { id: "asset:prod-db", label: "prod-db" },
  { id: "asset:identity-store", label: "identity-store" },
];
const HUB = { id: "asset:jump-host", label: "jump-host" };

// Synthesize a small, deterministic topology so the graph shows multi-hop paths
// toward crown jewels. The riskiest entities get stronger edges; a shared hub
// node creates entity -> hub -> crown-jewel paths.
function buildTopology(entities: RiskNode[]): RiskEdge[] {
  const edges: RiskEdge[] = [];
  const ranked = [...entities].sort((a, b) => b.base - a.base);
  ranked.forEach((e, i) => {
    const strength = clamp(e.base, 5, 95) / 100;
    edges.push({
      source: e.id,
      target: HUB.id,
      type: "connects-to",
      p: 0.3 + 0.6 * strength,
      onPath: false,
    });
    // Lateral movement between the two riskiest peers of the same kind.
    if (i > 0 && i < 4) {
      edges.push({
        source: ranked[i - 1].id,
        target: e.id,
        type: "authenticates-to",
        p: 0.25 + 0.4 * strength,
        onPath: false,
      });
    }
  });
  edges.push({
    source: HUB.id,
    target: CROWN_JEWELS[0].id,
    type: "accesses",
    p: 0.85,
    onPath: false,
  });
  edges.push({
    source: HUB.id,
    target: CROWN_JEWELS[1].id,
    type: "assumes",
    p: 0.7,
    onPath: false,
  });
  return edges;
}

// One-sided personalized-PageRank-style diffusion (doc 19 §3.1), simplified to a
// fixed round count. Risk flows along edge direction from predecessors.
function propagate(
  nodes: RiskNode[],
  edges: RiskEdge[],
  d = 0.85,
  rounds = 20,
): Map<string, number> {
  const idx = new Map(nodes.map((n) => [n.id, n]));
  const outWeight = new Map<string, number>();
  for (const e of edges) outWeight.set(e.source, (outWeight.get(e.source) ?? 0) + e.p);
  let r = new Map(nodes.map((n) => [n.id, n.base]));
  for (let k = 0; k < rounds; k++) {
    const next = new Map(nodes.map((n) => [n.id, (1 - d) * (idx.get(n.id) as RiskNode).base]));
    for (const e of edges) {
      const ow = outWeight.get(e.source) ?? 1;
      const contrib = d * (e.p / ow) * (r.get(e.source) ?? 0);
      next.set(e.target, (next.get(e.target) ?? 0) + contrib);
    }
    r = next;
  }
  return r;
}

// Max-product shortest path (doc 19 §3.2): Dijkstra on -log p from the exposed
// entries to any crown jewel; returns the single best path and its edge set.
function bestAttackPath(
  nodes: RiskNode[],
  edges: RiskEdge[],
  entries: string[],
  targets: Set<string>,
): { path: string[]; prob: number } {
  const adj = new Map<string, { to: string; p: number }[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push({ to: e.target, p: e.p });
  }
  const dist = new Map<string, number>(); // -log product; lower is better
  const prev = new Map<string, string>();
  const pq: { id: string; d: number }[] = [];
  for (const s of entries) {
    dist.set(s, 0);
    pq.push({ id: s, d: 0 });
  }
  let best: { id: string; d: number } | null = null;
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift()!;
    if (cur.d > (dist.get(cur.id) ?? Infinity)) continue;
    if (targets.has(cur.id)) {
      best = cur;
      break;
    }
    for (const { to, p } of adj.get(cur.id) ?? []) {
      const nd = cur.d + -Math.log(Math.max(p, 1e-6));
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, cur.id);
        pq.push({ id: to, d: nd });
      }
    }
  }
  if (!best) return { path: [], prob: 0 };
  const path: string[] = [];
  let at: string | undefined = best.id;
  while (at) {
    path.unshift(at);
    at = prev.get(at);
  }
  return { path, prob: Math.exp(-best.d) };
}

export function buildRiskGraph(rows: RiskRowInput[], kind: RiskKind, limit = 40): RiskGraph {
  const entities: RiskNode[] = rows
    .map((row) => {
      const base = baseRisk(row);
      return {
        id: `${kind}:${row.value}`,
        label: row.value,
        kind,
        crownJewel: false,
        base,
        propagated: base,
        blast: 0,
        attack: 0,
        score: base,
        tier: tierOf(base),
      } satisfies RiskNode;
    })
    .sort((a, b) => b.base - a.base)
    .slice(0, limit);

  if (!entities.length) return { nodes: [], edges: [], crownJewels: [], topPath: [] };

  const assets: RiskNode[] = [
    {
      id: HUB.id,
      label: HUB.label,
      kind: "asset",
      crownJewel: false,
      base: 20,
      propagated: 20,
      blast: 0,
      attack: 0,
      score: 20,
      tier: "low",
    },
    ...CROWN_JEWELS.map(
      (c) =>
        ({
          id: c.id,
          label: c.label,
          kind: "asset",
          crownJewel: true,
          base: 30,
          propagated: 30,
          blast: 100,
          attack: 0,
          score: 30,
          tier: "medium",
        }) satisfies RiskNode,
    ),
  ];
  const nodes = [...entities, ...assets];
  const edges = buildTopology(entities);

  const r = propagate(nodes, edges);
  for (const n of nodes) n.propagated = clamp(r.get(n.id) ?? n.base);

  const crownIds = new Set(CROWN_JEWELS.map((c) => c.id));
  const entries = entities.slice(0, Math.max(1, Math.ceil(entities.length / 4))).map((n) => n.id);
  const { path } = bestAttackPath(nodes, edges, entries, crownIds);
  const pathSet = new Set(path);
  for (const e of edges) {
    if (
      pathSet.has(e.source) &&
      pathSet.has(e.target) &&
      path.indexOf(e.target) === path.indexOf(e.source) + 1
    ) {
      e.onPath = true;
    }
  }

  // Blast: criticality reachable downstream (one hop into assets here).
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let blast = byId.get(n.id)!.crownJewel ? 100 : 0;
    for (const e of edges) {
      if (e.source === n.id && byId.get(e.target)?.crownJewel) blast = Math.max(blast, 100 * e.p);
    }
    n.blast = clamp(blast);
  }

  // Attack-path risk per node: on the top path it inherits the path strength.
  for (const n of nodes) {
    if (pathSet.has(n.id)) n.attack = clamp(70 + 30 * (n.blast / 100));
  }

  for (const n of nodes) {
    n.score = clamp(0.4 * n.base + 0.3 * n.propagated + 0.2 * n.attack + 0.1 * n.blast);
    n.tier = tierOf(n.score);
  }

  return { nodes, edges, crownJewels: [...crownIds], topPath: path };
}
