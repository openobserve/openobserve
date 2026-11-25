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

import { US_PER_DAY, US_PER_H, US_PER_S } from "./civil";
import type { BlockReason, RangeLimits } from "./types";

/** A range to check. µs limits win over hours and days; a span or retention limit <= 0 is no limit. */
export interface TimeRangeCheck extends Partial<RangeLimits> {
  startUs: number;
  endUs: number;
  nowUs: number;
  maxSpanHours?: number;
  retentionDays?: number;
}

export type TimeRangeCheckResult =
  | { ok: true; endUs: number }
  | {
      ok: false;
      reason: BlockReason | "out-of-range" | "zero-length" | "reversed";
      fix?: { startUs: number; endUs: number };
    };

export const DEFAULT_SKEW_US = 5 * US_PER_S;

export function floorOf(limits: RangeLimits): number {
  return Math.max(limits.retentionStartUs ?? 0, 0);
}

/** The span limit; one <= 0 is no limit. */
export function spanOf(l: RangeLimits): number {
  return l.maxSpanUs !== undefined && l.maxSpanUs > 0 ? l.maxSpanUs : 0;
}

/** An end at most the skew after now is now, so a clock a few seconds ahead is not the future. */
export function clampSkew(startUs: number, endUs: number, nowUs: number, l: RangeLimits): number {
  const late = endUs > nowUs && endUs <= nowUs + (l.skewUs ?? DEFAULT_SKEW_US);
  return !l.allowFuture && late && nowUs > startUs ? nowUs : endUs;
}

/** Every rule the range breaks, each checked on its own; the first is the one reported. */
export function blockReasons(
  startUs: number,
  endUs: number,
  nowUs: number,
  l: RangeLimits,
): BlockReason[] {
  const bound = nowUs + (l.skewUs ?? DEFAULT_SKEW_US);
  const reasons: BlockReason[] = [];
  if (!l.allowFuture && (startUs > bound || endUs > bound)) reasons.push("future");
  if (l.maxEndUs !== undefined && endUs > l.maxEndUs) reasons.push("after-max");
  if (l.minStartUs !== undefined && startUs < l.minStartUs) reasons.push("before-min");
  if (endUs <= floorOf(l)) reasons.push("retention");
  if (spanOf(l) && endUs - startUs > spanOf(l)) reasons.push("max-span");
  return reasons;
}

/** The fix candidate: the end pulled back to now or the max end, the start up to the min or the span. */
export function fixRange(
  startUs: number,
  endUs: number,
  reasons: BlockReason[],
  nowUs: number,
  l: RangeLimits,
): [number, number] {
  let end = endUs;
  if (reasons.includes("future") || reasons.includes("after-max")) {
    end = Math.min(end, l.allowFuture ? Infinity : nowUs, l.maxEndUs ?? Infinity);
  }
  const start = Math.max(
    startUs,
    l.minStartUs ?? -Infinity,
    spanOf(l) ? end - spanOf(l) : -Infinity,
  );
  return [start, end];
}

/** The validity gate the parser's policy step uses, for any caller holding a µs range. */
export function checkTimeRange(input: TimeRangeCheck): TimeRangeCheckResult {
  const { startUs, nowUs } = input;
  const hours = input.maxSpanHours ?? 0;
  const days = input.retentionDays ?? 0;
  if (![startUs, input.endUs, nowUs].every(Number.isSafeInteger))
    return { ok: false, reason: "out-of-range" };
  if (startUs >= input.endUs)
    return { ok: false, reason: startUs === input.endUs ? "zero-length" : "reversed" };
  const limits: RangeLimits = {
    ...input,
    allowFuture: input.allowFuture === true,
    maxSpanUs: input.maxSpanUs ?? (hours > 0 ? Math.round(hours * US_PER_H) : undefined),
    retentionStartUs:
      input.retentionStartUs ?? (days > 0 ? nowUs - Math.round(days * US_PER_DAY) : undefined),
  };
  const endUs = clampSkew(startUs, input.endUs, nowUs, limits);
  const reasons = blockReasons(startUs, endUs, nowUs, limits);
  if (reasons.length === 0) return { ok: true, endUs };
  const [s, e] = fixRange(startUs, endUs, reasons, nowUs, limits);
  const fixed =
    [s, e].every(Number.isSafeInteger) && s < e && blockReasons(s, e, nowUs, limits).length === 0;
  return { ok: false, reason: reasons[0], ...(fixed ? { fix: { startUs: s, endUs: e } } : {}) };
}
