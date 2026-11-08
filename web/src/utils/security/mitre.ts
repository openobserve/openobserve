// Copyright 2026 OpenObserve Inc.

// Sigma tags spell tactics inconsistently (`defense_evasion` / `defense-evasion`), so they are normalised.

export const ATTACK_TACTICS = [
  "reconnaissance",
  "resource_development",
  "initial_access",
  "execution",
  "persistence",
  "privilege_escalation",
  "defense_evasion",
  "credential_access",
  "discovery",
  "lateral_movement",
  "collection",
  "command_and_control",
  "exfiltration",
  "impact",
] as const;

export type AttackTactic = (typeof ATTACK_TACTICS)[number];

const KNOWN = new Set<string>(ATTACK_TACTICS);

/** `Defense-Evasion` / `defense_evasion` → `defense_evasion`; null when not a tactic. */
export function normalizeTactic(value: string | null | undefined): AttackTactic | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return KNOWN.has(key) ? (key as AttackTactic) : null;
}

/** Link to the technique page; sub-techniques use a path segment, not a dot. */
export function techniqueUrl(id: string): string {
  const [base, sub] = id.toUpperCase().split(".");
  return sub
    ? `https://attack.mitre.org/techniques/${base}/${sub}/`
    : `https://attack.mitre.org/techniques/${base}/`;
}

export interface TacticCoverage {
  tactic: AttackTactic;
  /** Enabled rules that cover this tactic. */
  rules: number;
  firings: number;
}

/** A rule tagged with two tactics counts toward both, as the matrix reads a multi-tactic technique. */
export function tacticCoverage(
  rules: { tactics: string[]; enabled: boolean }[],
  firings: { tactics: string[] }[],
): TacticCoverage[] {
  const ruleCount = new Map<AttackTactic, number>();
  const firingCount = new Map<AttackTactic, number>();
  const bump = (map: Map<AttackTactic, number>, tactics: string[]) => {
    const seen = new Set<AttackTactic>();
    for (const raw of tactics) {
      const tactic = normalizeTactic(raw);
      if (tactic && !seen.has(tactic)) {
        seen.add(tactic);
        map.set(tactic, (map.get(tactic) ?? 0) + 1);
      }
    }
  };
  for (const rule of rules) if (rule.enabled) bump(ruleCount, rule.tactics);
  for (const firing of firings) bump(firingCount, firing.tactics);
  return ATTACK_TACTICS.map((tactic) => ({
    tactic,
    rules: ruleCount.get(tactic) ?? 0,
    firings: firingCount.get(tactic) ?? 0,
  }));
}

/** `T1078.004` → `T1078`; a base technique is its own parent. */
export function parentTechnique(id: string): string {
  return id.trim().toUpperCase().split(".")[0];
}

/** Heat step for a firing count, so the matrix reads hot-to-cold at a glance. */
export function heatLevel(firings: number): 0 | 1 | 2 | 3 {
  if (firings <= 0) return 0;
  if (firings < 5) return 1;
  if (firings < 20) return 2;
  return 3;
}
