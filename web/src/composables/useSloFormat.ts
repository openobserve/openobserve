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

import type { SloStatus } from "@/ts/interfaces/slo";

/** The four states a user sees, in the order the list sorts them.
 *
 *  `no_data` is deliberately NOT a flavour of healthy or of breached. An SLO
 *  below the coverage floor is frozen: its alerts neither fire nor resolve,
 *  and showing it as either would be a lie in a direction someone acts on. */
export type SloHealth = "budget_blown" | "at_risk" | "meeting" | "no_data";

export function sloHealth(status: SloStatus | null | undefined): SloHealth {
  if (!status || status.no_data) return "no_data";
  const remaining = status.error_budget_remaining;
  if (remaining === null) return "no_data";
  if (remaining <= 0) return "budget_blown";
  // Burning faster than the budget allows, but not yet out. Worth surfacing
  // separately: it is the window in which someone can still act.
  if ((status.burn_rate ?? 0) > 1) return "at_risk";
  return "meeting";
}

export function healthTone(health: SloHealth): string {
  switch (health) {
    case "budget_blown":
      return "error";
    case "at_risk":
      return "warning";
    case "meeting":
      return "success";
    default:
      return "neutral";
  }
}

export function healthIcon(health: SloHealth): string {
  switch (health) {
    case "budget_blown":
      return "local_fire_department";
    case "at_risk":
      return "trending_down";
    case "meeting":
      return "check_circle";
    default:
      return "help";
  }
}

/** An em dash, not "0" or "—0%".
 *
 *  Used everywhere a derived figure is absent. The distinction matters: a
 *  brand-new SLO has measured nothing, and rendering that as a number invites
 *  someone to read it as a measurement. */
export const ABSENT = "—";

/** SLI to the 3 decimals the target allows (S-2). Fewer would round 99.9994%
 *  and 99.9% to the same string, which is the difference between meeting a
 *  four-nines target and missing it. */
export function formatSli(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT;
  return `${value.toFixed(3)}%`;
}

export function formatTarget(value: number): string {
  // Trailing zeros trimmed: 99.900 reads as noise, 99.9 as a target.
  return `${Number(value.toFixed(3))}%`;
}

/** Signed, because an overspent budget is the number people need most. */
export function formatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT;
  return `${value > 0 ? "" : ""}${value.toFixed(1)}%`;
}

export function formatBurn(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT;
  return `×${value.toFixed(1)}`;
}

export function formatCoverage(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT;
  return `${Math.round(value * 100)}%`;
}

/** `7d` / `30d` / `90d` — the only windows the backend accepts (D31). */
export function formatWindow(secs: number): string {
  const days = Math.round(secs / 86400);
  return `${days}d`;
}

export function formatSlice(secs: number): string {
  return secs === 60 ? "1 min" : `${Math.round(secs / 60)} min`;
}

/** How long until the budget is gone, at the current burn. */
export function formatTimeToExhaust(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || secs <= 0) return ABSENT;
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((secs % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function sliTypeLabel(t: string): string {
  switch (t) {
    case "count":
      return "Count";
    case "time_slice":
      return "Time slice";
    case "alert":
      return "Alert-based";
    default:
      return t;
  }
}

/** Sort worst-budget-first, with frozen SLOs last.
 *
 *  Frozen last on purpose: they are not the worst, they are unknown, and
 *  putting an unknown at the top of a list sorted by severity trains people
 *  to ignore the top of the list. */
export function compareByUrgency(a: SloStatus | null, b: SloStatus | null): number {
  const av = a && !a.no_data ? a.error_budget_remaining : null;
  const bv = b && !b.no_data ? b.error_budget_remaining : null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
}
