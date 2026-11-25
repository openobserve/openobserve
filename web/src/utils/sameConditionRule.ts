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

const isEmptyRule = (rule: any): boolean =>
  rule === null ||
  rule === undefined ||
  (Array.isArray(rule) && rule.length === 0) ||
  (rule?.filterType === "group" && !rule.conditions?.length);

const sortedKeys = (_key: string, value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, (value as Record<string, unknown>)[key]]),
      )
    : value;

/** Two saved condition rules say the same thing; no rule and an empty group count as one. */
export const sameConditionRule = (a: unknown, b: unknown): boolean =>
  (isEmptyRule(a) && isEmptyRule(b)) ||
  JSON.stringify(a ?? null, sortedKeys) === JSON.stringify(b ?? null, sortedKeys);
