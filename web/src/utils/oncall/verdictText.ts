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

/** Longest first sentence an announcement reads out. */
const MAX_SENTENCE_CHARS = 300;

// The engine writes "severity promoted P3 → P1: …"; a clamped line adds "(the agent asked for …".
const APPLIED_PROMOTION = /^severity promoted \S+ → (P[1-5])\b(?! \(the agent asked for)/;

/** The level an applied, unclamped promotion line moved to; `null` for refused, clamped or unknown lines. */
export function appliedPromotionOf(body: string): string | null {
  return APPLIED_PROMOTION.exec(body.slice(0, 200))?.[1] ?? null;
}

/** The first sentence of a verdict, bounded for a screen-reader announcement. */
export function firstSentenceOf(body: string): string {
  const text = body.trim().slice(0, MAX_SENTENCE_CHARS);
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}
