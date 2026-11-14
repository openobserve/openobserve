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

const MICROS_PER_DAY = 86_400_000_000;

/** The longest guard the server accepts, in days. */
export const MAX_RANGE_GUARD_DAYS = 3650;

/** Where the "Set it in Settings" link for the fiscal year start goes. */
export const ORG_SETTINGS_ROUTE = { name: "organizationSettings" } as const;

export interface OrgTimeRangeConfig {
  /** 1 to 12; null until an admin sets it, and `FY` is not read. */
  fiscalYearStartMonth: number | null;
  /** null when the org has no range guard. */
  rangeGuardDays: number | null;
}

/** Reads the org's time range settings from `organizationData.organizationSettings`. */
export const readOrgTimeRangeSettings = (settings: unknown): OrgTimeRangeConfig => {
  const source = (settings ?? {}) as Record<string, unknown>;
  const month = wholeNumber(source.fiscal_year_start_month);
  const days = wholeNumber(source.range_guard_days);
  return {
    fiscalYearStartMonth: month !== null && month >= 1 && month <= 12 ? month : null,
    rangeGuardDays: days !== null && days >= 1 && days <= MAX_RANGE_GUARD_DAYS ? days : null,
  };
};

/** True only when the org has a guard and the range is longer than it. */
export const rangeExceedsGuard = (
  startUs: number,
  endUs: number,
  guardDays: number | null,
): boolean => guardDays !== null && endUs - startUs > guardDays * MICROS_PER_DAY;

const wholeNumber = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};
