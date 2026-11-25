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

/** A wall-clock time with microseconds; months are 1..12. */
export interface Civil {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  us: number;
}

export const US_PER_S = 1_000_000;
export const US_PER_MIN = 60 * US_PER_S;
export const US_PER_H = 60 * US_PER_MIN;
export const US_PER_DAY = 24 * US_PER_H;
export const MIN_YEAR = 1000;
export const MAX_YEAR = 9999;

export function daysFromCivil(y: number, mo: number, d: number): number {
  const yy = mo <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (mo + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days: number): { y: number; mo: number; d: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (mo <= 2 ? 1 : 0), mo, d };
}

export function daysInMonth(y: number, mo: number): number {
  return daysFromCivil(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - daysFromCivil(y, mo, 1);
}

export function isValidDate(y: number, mo: number, d: number): boolean {
  return (
    Number.isInteger(y) &&
    y >= MIN_YEAR &&
    y <= MAX_YEAR &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, mo)
  );
}

/** Wall clock minus `offsetUs`, in microseconds; NaN when the result is unsafe. */
export function wallUs(c: Civil, offsetUs = 0): number {
  // The offset comes off the day term first, so every later partial sum stays below the result.
  const us =
    daysFromCivil(c.y, c.mo, c.d) * US_PER_DAY -
    offsetUs +
    c.h * US_PER_H +
    c.mi * US_PER_MIN +
    c.s * US_PER_S +
    c.us;
  return Number.isSafeInteger(us) ? us : NaN;
}

/** The wall clock `offsetUs` after the instant `us`. */
export function civilOfWall(us: number, offsetUs = 0): Civil {
  // The offset joins the in-day remainder, so a near-limit `us` never takes an unsafe, rounded sum.
  const base = Math.floor(us / US_PER_DAY);
  const within = us - base * US_PER_DAY + offsetUs;
  const days = base + Math.floor(within / US_PER_DAY);
  let rest = within - Math.floor(within / US_PER_DAY) * US_PER_DAY;
  const date = civilFromDays(days);
  const h = Math.floor(rest / US_PER_H);
  rest -= h * US_PER_H;
  const mi = Math.floor(rest / US_PER_MIN);
  rest -= mi * US_PER_MIN;
  const s = Math.floor(rest / US_PER_S);
  return { ...date, h, mi, s, us: rest - s * US_PER_S };
}

export function dayStart(y: number, mo: number, d: number): Civil {
  return { y, mo, d, h: 0, mi: 0, s: 0, us: 0 };
}

export function addDays(c: Civil, n: number): Civil {
  const date = civilFromDays(daysFromCivil(c.y, c.mo, c.d) + n);
  return { ...c, ...date };
}

/** Adds months, clamping the day to the target month's end (Mar 31 less a month is Feb 28). */
export function addMonths(c: Civil, n: number): Civil {
  const total = c.y * 12 + (c.mo - 1) + n;
  const y = Math.floor(total / 12);
  const mo = total - y * 12 + 1;
  return { ...c, y, mo, d: Math.min(c.d, daysInMonth(y, mo)) };
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(y: number, mo: number, d: number): number {
  return (((daysFromCivil(y, mo, d) + 4) % 7) + 7) % 7;
}

export function weekStartOf(c: Civil, firstDay: number): Civil {
  const back = (weekdayOf(c.y, c.mo, c.d) - firstDay + 7) % 7;
  return addDays(dayStart(c.y, c.mo, c.d), -back);
}

export function sameDate(a: Civil, b: Civil): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d;
}
