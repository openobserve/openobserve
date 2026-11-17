// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { getIntlLocale } from "@/locales";

// Largest unit first, so a span reads in the largest unit it reaches.
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

/** "2 minutes ago" for an epoch in milliseconds, in the app's locale. */
export const relativeTimeText = (epochMs: number, now: number): string => {
  const ageMs = Math.abs(now - epochMs);
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => ageMs >= ms) ?? RELATIVE_UNITS[5];
  return new Intl.RelativeTimeFormat(getIntlLocale()).format(
    Math.round((epochMs - now) / size),
    unit,
  );
};
