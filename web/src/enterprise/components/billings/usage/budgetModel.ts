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

/** One entry of the org setting `budget_config`; the backend stores the threshold in dollars. */
export interface BudgetConfig {
  org_id: string;
  total_budget_amount: number;
  warn_at_amount: number;
  /** Email alerts are off while true. */
  paused: boolean;
}

export type BudgetTone = "ok" | "warn" | "over";

/** A new budget warns at this share until the user picks another. */
export const DEFAULT_WARN_PERCENT = 80;

export function budgetFor(
  configs: BudgetConfig[] | null | undefined,
  orgId: string,
): BudgetConfig | null {
  return (configs ?? []).find((config) => config.org_id === orgId) ?? null;
}

export function withBudget(
  configs: BudgetConfig[] | null | undefined,
  entry: BudgetConfig,
): BudgetConfig[] {
  const others = (configs ?? []).filter((config) => config.org_id !== entry.org_id);
  // A cleared budget leaves the list: stored as $0 it would be a $0 warn line, crossed every hour.
  return entry.total_budget_amount > 0 ? [...others, entry] : others;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function sameCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/** The two warn fields stay linked through the percent, so a new budget keeps the same share. */
export function warnAmountFor(percent: number, total: number): number {
  return total > 0 ? cents((total * clampPercent(percent)) / 100) : 0;
}

export function warnPercentFor(amount: number, total: number): number {
  return total > 0 ? clampPercent((amount / total) * 100) : DEFAULT_WARN_PERCENT;
}

/** Below this, a warn line rounds to $0, which the hourly budget job treats as always crossed. */
export const MIN_WARN_PERCENT = 1;

/** A typed warn percent; an empty field or one under 1% keeps the current one. */
export function nextWarnPercent(value: unknown, current: number): number {
  const n = Number(value);
  return value !== "" && value != null && n >= MIN_WARN_PERCENT ? clampPercent(n) : current;
}

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

export function budgetTone(amount: number, total: number, warnAt: number): BudgetTone {
  if (total <= 0) return "ok";
  if (amount >= total) return "over";
  return amount >= warnAt ? "warn" : "ok";
}

/** The cycle day spend reaches the budget at today's average pace; null when it does not this cycle. */
export function budgetReachedDay(
  spent: number,
  day: number,
  total: number,
  totalDays: number,
): number | null {
  if (total <= 0 || day <= 0 || spent <= 0) return null;
  const reached = Math.ceil(total / (spent / day));
  return reached <= totalDays ? reached : null;
}

/** A super org's overall budget: the whole group's bill, beside one entry per org. */
export const TOTAL_BUDGET_ID = "total";

export type BudgetStatus = "none" | BudgetTone;

/** Like `budgetTone`, but says so when there is no budget to be over. */
export function budgetStatus(amount: number, total: number, warnAt: number): BudgetStatus {
  return total > 0 ? budgetTone(amount, total, warnAt) : "none";
}

/** A budget as the page edits it: the warn line is a percent until it is saved. */
export interface BudgetDraft {
  budget: number;
  warnPercent: number;
  alertsOn: boolean;
}

export function draftOf(config: BudgetConfig | null): BudgetDraft {
  return config
    ? {
        budget: config.total_budget_amount,
        warnPercent: warnPercentFor(config.warn_at_amount, config.total_budget_amount),
        alertsOn: !config.paused,
      }
    : { budget: 0, warnPercent: DEFAULT_WARN_PERCENT, alertsOn: true };
}

export function configOf(orgId: string, draft: BudgetDraft): BudgetConfig {
  return {
    org_id: orgId,
    total_budget_amount: draft.budget,
    warn_at_amount: warnAmountFor(draft.warnPercent, draft.budget),
    paused: !draft.alertsOn,
  };
}

/** Two drafts save the same config, so an edit typed back to its old value is not a change. */
export function sameBudget(a: BudgetDraft, b: BudgetDraft): boolean {
  const x = configOf("", a);
  const y = configOf("", b);
  return (
    x.total_budget_amount === y.total_budget_amount &&
    sameCents(x.warn_at_amount, y.warn_at_amount) &&
    x.paused === y.paused
  );
}

export function superBudgetConfigs(
  total: BudgetDraft,
  orgs: Record<string, BudgetDraft>,
): BudgetConfig[] {
  const entries = Object.entries(orgs)
    .filter(([, draft]) => draft.budget > 0)
    .map(([orgId, draft]) => configOf(orgId, draft));
  return total.budget > 0 ? [configOf(TOTAL_BUDGET_ID, total), ...entries] : entries;
}
