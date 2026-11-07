// Copyright 2026 OpenObserve Inc.
//
// attackMatrix.ts — the ATT&CK matrix as this org can actually see it.
//
// Rows are the techniques the shipped Sigma catalog and the org's own SIEM
// detections carry; columns are the tactics those same rules tag them with.
// Nothing is looked up from a separate ATT&CK dataset, so a technique appears
// under a tactic only because a rule says so, and names are not invented: the
// matrix shows technique ids and links out for the rest.

import { ATTACK_TACTICS, normalizeTactic, type AttackTactic } from "./mitre";

export interface MatrixRule {
  id?: string;
  title: string;
  level?: string;
  techniques: string[];
  tactics: string[];
}

export interface MatrixDetection {
  name: string;
  enabled: boolean;
  sigmaId: string;
  level: string;
  techniques: string[];
  tactics: string[];
}

export interface MatrixFiring {
  name: string;
  timeMs: number;
  techniques: string[];
}

/** firing > covered > available: the strongest thing true of a technique. */
export type TechniqueState = "firing" | "covered" | "available";

export interface TechniqueCell<R extends MatrixRule = MatrixRule> {
  id: string;
  tactics: AttackTactic[];
  /** Catalog rules written for this technique. */
  catalogRules: R[];
  /** The org's SIEM detections tagged with it, enabled or not. */
  detections: MatrixDetection[];
  enabledCount: number;
  firings: number;
  lastFiredMs: number | null;
  state: TechniqueState;
}

export interface MatrixColumn<R extends MatrixRule = MatrixRule> {
  tactic: AttackTactic;
  cells: TechniqueCell<R>[];
}

export interface AttackMatrix<R extends MatrixRule = MatrixRule> {
  columns: MatrixColumn<R>[];
  /** Techniques no rule assigns to a known tactic — listed, never dropped. */
  unmapped: TechniqueCell<R>[];
  cells: Map<string, TechniqueCell<R>>;
}

const normTechnique = (id: string) => id.trim().toUpperCase();

/** `T1078.004` → `T1078`; a base technique is its own parent. */
export function parentTechnique(id: string): string {
  return normTechnique(id).split(".")[0];
}

export function buildAttackMatrix<R extends MatrixRule>(
  catalog: R[],
  detections: MatrixDetection[],
  firings: MatrixFiring[],
): AttackMatrix<R> {
  const cells = new Map<string, TechniqueCell<R> & { tacticSet: Set<AttackTactic> }>();
  const cell = (raw: string) => {
    const id = normTechnique(raw);
    let entry = cells.get(id);
    if (!entry) {
      entry = {
        id,
        tactics: [],
        tacticSet: new Set(),
        catalogRules: [],
        detections: [],
        enabledCount: 0,
        firings: 0,
        lastFiredMs: null,
        state: "available",
      };
      cells.set(id, entry);
    }
    return entry;
  };
  const addTactics = (entry: { tacticSet: Set<AttackTactic> }, tactics: string[]) => {
    for (const raw of tactics) {
      const tactic = normalizeTactic(raw);
      if (tactic) entry.tacticSet.add(tactic);
    }
  };

  for (const rule of catalog) {
    for (const tech of rule.techniques) {
      const entry = cell(tech);
      entry.catalogRules.push(rule);
      addTactics(entry, rule.tactics);
    }
  }
  for (const det of detections) {
    for (const tech of det.techniques) {
      const entry = cell(tech);
      entry.detections.push(det);
      if (det.enabled) entry.enabledCount += 1;
      addTactics(entry, det.tactics);
    }
  }
  for (const firing of firings) {
    for (const tech of new Set(firing.techniques.map(normTechnique))) {
      const entry = cells.get(tech);
      if (!entry) continue;
      entry.firings += 1;
      entry.lastFiredMs = Math.max(entry.lastFiredMs ?? 0, firing.timeMs);
    }
  }

  const finished: TechniqueCell<R>[] = [...cells.values()].map(({ tacticSet, ...entry }) => ({
    ...entry,
    tactics: ATTACK_TACTICS.filter((t) => tacticSet.has(t)),
    state: entry.firings > 0 ? "firing" : entry.enabledCount > 0 ? "covered" : "available",
  }));
  const byId = new Map(finished.map((c) => [c.id, c]));

  const rank: Record<TechniqueState, number> = { firing: 0, covered: 1, available: 2 };
  const order = (a: TechniqueCell<R>, b: TechniqueCell<R>) =>
    rank[a.state] - rank[b.state] || b.firings - a.firings || a.id.localeCompare(b.id);

  return {
    columns: ATTACK_TACTICS.map((tactic) => ({
      tactic,
      cells: finished.filter((c) => c.tactics.includes(tactic)).sort(order),
    })),
    unmapped: finished.filter((c) => !c.tactics.length).sort(order),
    cells: byId,
  };
}

export interface MatrixSummary {
  tacticsCovered: number;
  tacticsTotal: number;
  techniquesCovered: number;
  techniquesTotal: number;
  techniquesFiring: number;
  gaps: number;
}

export function summarizeMatrix<R extends MatrixRule>(matrix: AttackMatrix<R>): MatrixSummary {
  const all = [...matrix.cells.values()];
  const covered = all.filter((c) => c.enabledCount > 0);
  return {
    tacticsCovered: matrix.columns.filter((col) => col.cells.some((c) => c.enabledCount > 0))
      .length,
    tacticsTotal: matrix.columns.length,
    techniquesCovered: covered.length,
    techniquesTotal: all.length,
    techniquesFiring: all.filter((c) => c.firings > 0).length,
    gaps: all.length - covered.length,
  };
}

/** Heat step for a firing count, so the matrix reads hot-to-cold at a glance. */
export function heatLevel(firings: number): 0 | 1 | 2 | 3 {
  if (firings <= 0) return 0;
  if (firings < 5) return 1;
  if (firings < 20) return 2;
  return 3;
}
