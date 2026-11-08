// Edges are inferred from risk rank until observed entity relationships exist.

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
  kind: RiskKind;
  /** Intrinsic risk, 0..100. */
  base: number;
  /** Risk after diffusion over the inferred edges, 0..100. */
  propagated: number;
  /** Composite of base and propagated risk, 0..100. */
  score: number;
  tier: RiskTier;
}

export interface RiskEdge {
  source: string;
  target: string;
  /** Traversal weight, 0..1. */
  p: number;
}

export interface RiskGraph {
  nodes: RiskNode[];
  edges: RiskEdge[];
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

function baseRisk(row: RiskRowInput): number {
  const failureRate = row.failureEvents > 0 ? row.failures / row.failureEvents : 0;
  const peerSpread = Math.log10(1 + row.peers) / Math.log10(1 + 200); // 0..~1
  const activity = Math.log10(1 + row.events) / Math.log10(1 + 1_000_000); // 0..~1
  return clamp(100 * (0.6 * failureRate + 0.28 * peerSpread + 0.12 * activity));
}

// Chains the four riskiest entities in rank order; these edges are not observed relationships.
function buildRankEdges(ranked: RiskNode[]): RiskEdge[] {
  const edges: RiskEdge[] = [];
  for (let i = 1; i < Math.min(4, ranked.length); i++) {
    const strength = clamp(ranked[i].base, 5, 95) / 100;
    edges.push({ source: ranked[i - 1].id, target: ranked[i].id, p: 0.25 + 0.4 * strength });
  }
  return edges;
}

// Personalized-PageRank-style diffusion, simplified to a fixed round count.
function propagate(
  nodes: RiskNode[],
  edges: RiskEdge[],
  d = 0.85,
  rounds = 20,
): Map<string, number> {
  const outWeight = new Map<string, number>();
  for (const e of edges) outWeight.set(e.source, (outWeight.get(e.source) ?? 0) + e.p);
  let r = new Map(nodes.map((n) => [n.id, n.base]));
  for (let k = 0; k < rounds; k++) {
    const next = new Map(nodes.map((n) => [n.id, (1 - d) * n.base]));
    for (const e of edges) {
      const ow = outWeight.get(e.source) ?? 1;
      const contrib = d * (e.p / ow) * (r.get(e.source) ?? 0);
      next.set(e.target, (next.get(e.target) ?? 0) + contrib);
    }
    r = next;
  }
  return r;
}

export function buildRiskGraph(rows: RiskRowInput[], kind: RiskKind, limit = 40): RiskGraph {
  const nodes: RiskNode[] = rows
    .map((row) => {
      const base = baseRisk(row);
      return {
        id: `${kind}:${row.value}`,
        label: row.value,
        kind,
        base,
        propagated: base,
        score: base,
        tier: tierOf(base),
      } satisfies RiskNode;
    })
    .sort((a, b) => b.base - a.base)
    .slice(0, limit);

  const edges = buildRankEdges(nodes);
  const r = propagate(nodes, edges);
  for (const n of nodes) {
    n.propagated = clamp(r.get(n.id) ?? n.base);
    n.score = clamp((0.4 * n.base + 0.3 * n.propagated) / 0.7);
    n.tier = tierOf(n.score);
  }

  return { nodes, edges };
}
