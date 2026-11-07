// Copyright 2026 OpenObserve Inc.
//
// mitre.ts — the ATT&CK Enterprise tactics, in kill-chain order.
//
// Sigma tags carry tactics as free-form words (`attack.defense_evasion`, and in
// older rules `attack.defense-evasion`), so they are normalised to one spelling
// before they are counted. The order is the matrix's own left-to-right order,
// which is what an analyst expects a coverage row to read as.

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
  /** Firings in the window from rules that cover this tactic. */
  firings: number;
}

/**
 * Rules and firings per tactic. A rule tagged with two tactics counts toward
 * both, which is how the matrix itself reads a multi-tactic technique.
 */
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
