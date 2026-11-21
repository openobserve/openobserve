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

import { classify } from "./classify";
import type { Env } from "./combine";
import { examplesFor } from "./examples";
import { normalize, rawSpan } from "./normalize";
import * as en from "./packs/en-us";
import {
  brandPack,
  compilePack,
  compiledOf,
  type GeneratedTables,
  type LocalePack,
} from "./packs/schema";
import { BudgetExceeded } from "./phrases";
import { completionReadings, finalize } from "./policy";
import type { ParseContext, TimeRangePack, TimeRangeParseResult, TimeRangeLocale } from "./types";
import { isZone } from "./zone";

export { formatTimeRangeInput, type FormattableRange } from "./format";
export { checkTimeRange, type TimeRangeCheck, type TimeRangeCheckResult } from "./check";
export type {
  AmbiguityReason,
  BlockReason,
  InputForm,
  InvalidReason,
  InputSource,
  ParseContext,
  RangeLimits,
  RelativeUnit,
  TimeRangePack,
  TimeRangeParseResult,
  TimeRangeReading,
  TimeRangeLocale,
  ZoneNote,
} from "./types";

interface PackModule {
  pack: LocalePack;
  tables: GeneratedTables;
}

export const EN_US_TIME_RANGE_PACK: TimeRangePack = brandPack(compilePack(en.pack, en.tables));

const lazyPacks = import.meta.glob<PackModule>([
  "./packs/*.ts",
  "!./packs/schema.ts",
  "!./packs/en-us.ts",
]);
const loading = new Map<TimeRangeLocale, Promise<TimeRangePack>>();

/** Compiles a locale pack once; the promise rejects when the chunk cannot load. */
export function loadTimeRangeLocale(locale: TimeRangeLocale): Promise<TimeRangePack> {
  if (locale === "en-us") return Promise.resolve(EN_US_TIME_RANGE_PACK);
  let pending = loading.get(locale);
  if (!pending) {
    const load = lazyPacks[`./packs/${locale}.ts`];
    pending = load
      ? load().then((mod) => brandPack(compilePack(mod.pack, mod.tables, en.pack)))
      : Promise.reject(new Error(`No time range pack for ${locale}`));
    pending.catch(() => loading.delete(locale));
    loading.set(locale, pending);
  }
  return pending;
}

function parse(ctx: ParseContext, withExamples: boolean): TimeRangeParseResult {
  const examples = (): string[] => (withExamples ? examplesFor(ctx, (c) => parse(c, false)) : []);
  const pack = compiledOf(ctx.pack);
  if (!pack || !isZone(ctx.zone) || !Number.isInteger(ctx.nowUs)) {
    return { state: "invalid", reason: "unreadable", examples: [] };
  }
  if (!Number.isSafeInteger(ctx.nowUs))
    return { state: "invalid", reason: "out-of-range", examples: [] };
  const norm = normalize(ctx.text, pack.bcp47, pack.script, pack.hooks);
  if (norm === "empty") return { state: "empty" };
  if (norm === "too-long") return { state: "invalid", reason: "too-long", examples: examples() };
  const env: Env = { nowUs: ctx.nowUs, zone: ctx.zone, pack, units: ctx.units };
  let classified: ReturnType<typeof classify>;
  try {
    classified = classify(norm, env);
  } catch (error) {
    if (error instanceof BudgetExceeded)
      return { state: "invalid", reason: "unreadable", examples: examples() };
    throw error;
  }
  const { outcome, scan } = classified;
  if (outcome.t === "incomplete") {
    return { state: "incomplete", completions: completionReadings(outcome.drafts, ctx, "phrase") };
  }
  // Several readings with no stated reason would be a silent pick, so they read as unreadable.
  const why =
    outcome.t === "drafts" ? (outcome.why ?? outcome.drafts.find((d) => d.why)?.why) : undefined;
  const settled = outcome.t === "drafts" && (outcome.drafts.length < 2 || why !== undefined);
  const result = settled ? finalize(outcome.drafts, why, outcome.form, ctx, env) : null;
  if (result && result.state !== "invalid") return result;
  const fallback = settled || env.overflow ? "out-of-range" : "unreadable";
  const reason =
    result?.reason ??
    (outcome.t === "invalid" && !(outcome.reason === "unreadable" && env.overflow)
      ? outcome.reason
      : fallback);
  // A zero-length or reversed range was read in full, so the whole input is the span to fix.
  const from = result || reason === "reversed" ? 0 : Math.min(scan.furthest, norm.text.length);
  const at = rawSpan(ctx.text, norm.text, from, norm.text.length);
  return { state: "invalid", reason, examples: examples(), at };
}

/** Reads typed or pasted text as a time range; pure, never throws, one of six states. */
export function parseTimeRangeInput(ctx: ParseContext): TimeRangeParseResult {
  try {
    return parse(ctx, true);
  } catch {
    return { state: "invalid", reason: "unreadable", examples: [] };
  }
}

/** Native examples to show as input hints and with an invalid result; each one is `valid` under `ctx`. */
export function getInputExamples(ctx: Omit<ParseContext, "text">): string[] {
  try {
    return examplesFor(ctx, (c) => parse(c, false));
  } catch {
    return [];
  }
}
