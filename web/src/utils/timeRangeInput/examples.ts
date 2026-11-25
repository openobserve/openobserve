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

import { floorOf } from "./check";
import { US_PER_DAY, US_PER_MIN } from "./civil";
import { compiledOf } from "./packs/schema";
import type { ParseContext, TimeRangeParseResult } from "./types";
import { wallAt } from "./zone";

const UNIVERSAL = ["15m", "1h", "now-30m"];
const COUNT = 3;
let last: { key: string; pack: object; examples: string[] } | undefined;

/** The pack's native examples, then universal ones, keeping only those `valid` under `ctx`. */
export function examplesFor(
  ctx: Omit<ParseContext, "text">,
  parse: (ctx: ParseContext) => TimeRangeParseResult,
): string[] {
  const pack = compiledOf(ctx.pack);
  const { maxEndUs, minStartUs, retentionStartUs } = ctx.limits;
  // The implicit Unix-epoch retention floor is a fixed bound for a now within two days of it.
  const epoch = Math.abs(ctx.nowUs) < 2 * US_PER_DAY ? 0 : undefined;
  const fixed = maxEndUs ?? minStartUs ?? retentionStartUs ?? epoch;
  // Examples are spans ending now or yesterday, so without fixed bounds only the local date changes them.
  const day = wallAt(ctx.zone, ctx.nowUs);
  // Spans are whole minutes, so a bound flips them only where now minus it is a whole minute.
  const near = (b: number): number =>
    Math.floor((ctx.nowUs - b) / US_PER_MIN) * 2 + ((ctx.nowUs - b) % US_PER_MIN === 0 ? 0 : 1);
  const bounds = [maxEndUs, minStartUs, floorOf(ctx.limits)].filter((b) => b !== undefined);
  const when = [day.y, day.mo, day.d, ...(fixed === undefined ? [] : bounds.map(near))];
  const key = JSON.stringify([when, ctx.zone, ctx.units, ctx.kinds, ctx.limits, ctx.source]);
  // One-entry memo: an invalid parse per keystroke must not re-parse every example.
  if (last && last.key === key && last.pack === ctx.pack) return [...last.examples];
  const out: string[] = [];
  for (const text of [...(pack?.examples ?? []), ...UNIVERSAL]) {
    if (out.length >= COUNT) break;
    if (!out.includes(text) && parse({ ...ctx, text }).state === "valid") out.push(text);
  }
  last = { key, pack: ctx.pack, examples: out };
  return [...out];
}
