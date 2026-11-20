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

import {
  computed,
  getCurrentInstance,
  onActivated,
  onDeactivated,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from "vue";

import { localeFileMap } from "@/locales";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";

import {
  EN_US_TIME_RANGE_PACK,
  getInputExamples,
  loadTimeRangeLocale,
  parseTimeRangeInput,
  type InputSource,
  type ParseContext,
  type TimeRangeLocale,
  type TimeRangePack,
  type TimeRangeParseResult,
} from "@/utils/timeRangeInput";

const US_PER_MS = 1000;
const US_PER_S = 1_000_000;
const ANNOUNCE_DELAY_MS = 300;
const EXAMPLE_COUNT = 3;
const FORMATTER_CACHE_LIMIT = 64;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Everything the parser needs from the picker except the text, the pack and the clock. */
export type PickerParseContext = Omit<ParseContext, "text" | "pack" | "nowUs" | "source"> & {
  locale: string;
};

export interface TimeRangeInputOptions {
  context: () => PickerParseContext;
}

// The parser takes whole µs only, and a patched or high-resolution clock can return a fraction of a ms.
const nowMicros = () => Math.floor(Date.now()) * US_PER_MS;

/** Maps an app locale (a `localeFileMap` key) to its parser pack; unknown ones read as English. */
export function timeRangeLocaleOf(appLocale: string): TimeRangeLocale {
  const key = appLocale.toLowerCase();
  return Object.hasOwn(localeFileMap, key) ? (key as TimeRangeLocale) : "en-us";
}

async function packFor(appLocale: string): Promise<TimeRangePack> {
  try {
    return await loadTimeRangeLocale(timeRangeLocaleOf(appLocale));
  } catch {
    return EN_US_TIME_RANGE_PACK;
  }
}

/** Reads text pasted onto the picker panel with the same parser and limits as the bar. */
export async function readPickerText(
  text: string,
  ctx: PickerParseContext,
  source: InputSource = "paste",
): Promise<TimeRangeParseResult> {
  const { locale, ...rest } = ctx;
  const pack = await packFor(locale);
  return parseTimeRangeInput({ ...rest, text, pack, source, nowUs: nowMicros() });
}

/** "1 hr 30 min": the two largest whole units of the span, in the app locale. */
export function formatSpan(spanUs: number, intlLocale: string): string {
  const seconds = Math.max(0, Math.round(spanUs / US_PER_S));
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "day"],
    [Math.floor((seconds % 86_400) / 3600), "hour"],
    [Math.floor((seconds % 3600) / 60), "minute"],
    [seconds % 60, "second"],
  ];
  const shown = parts.filter(([value]) => value > 0).slice(0, 2);
  if (shown.length === 0) return unitText(0, "second", intlLocale);
  return shown.map(([value, unit]) => unitText(value, unit, intlLocale)).join(" ");
}

// Oldest-first eviction keeps a long session that cycles zones or locales from growing the cache.
function cachedFormat<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  if (cache.size >= FORMATTER_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, made);
  return made;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  return cachedFormat(dateFormats, key, () => new Intl.DateTimeFormat(locale, options));
}

function unitText(value: number, unit: string, intlLocale: string): string {
  return cachedFormat(
    numberFormats,
    `${intlLocale}|${unit}`,
    () => new Intl.NumberFormat(intlLocale, { style: "unit", unit, unitDisplay: "short" }),
  ).format(value);
}

function dayKey(us: number, zone: string): string {
  return dateFormat("en-CA", { timeZone: zone, dateStyle: "short" }).format(
    new Date(Math.floor(us / US_PER_MS)),
  );
}

/** One instant in the picker zone: the day only when it is not today, the year only when it is not this year. */
export function formatInstant(
  us: number,
  zone: string,
  intlLocale: string,
  nowUs: number,
  withDay = dayKey(us, zone) !== dayKey(nowUs, zone),
): string {
  const at = new Date(Math.floor(us / US_PER_MS));
  const yearFormat = dateFormat("en-CA", { timeZone: zone, year: "numeric" });
  const sameYear =
    yearFormat.format(at) === yearFormat.format(new Date(Math.floor(nowUs / US_PER_MS)));
  const withSeconds = Math.floor(us / US_PER_S) % 60 !== 0;
  return dateFormat(intlLocale, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(withSeconds ? { second: "2-digit" } : {}),
    ...(withDay
      ? {
          weekday: "short",
          day: "numeric",
          month: "short",
          ...(sameYear ? {} : { year: "numeric" }),
        }
      : {}),
  }).format(at);
}

/** "Wed, Nov 18, 14:17 → 14:32": the end repeats the day only when it differs from the start's. */
export function formatRangeText(
  startUs: number,
  endUs: number,
  zone: string,
  intlLocale: string,
  nowUs: number,
): string {
  const start = formatInstant(startUs, zone, intlLocale, nowUs);
  const end = formatInstant(
    endUs,
    zone,
    intlLocale,
    nowUs,
    dayKey(endUs, zone) !== dayKey(startUs, zone),
  );
  return `${start} → ${end}`;
}

/** Text, parse result and locale pack of the typed bar; the parse runs on every change. */
export function useTimeRangeInput(opts: TimeRangeInputOptions) {
  const text = ref("");
  const source = ref<InputSource>("typed");
  const nowUs = ref(nowMicros());
  const pack = shallowRef<TimeRangePack>(EN_US_TIME_RANGE_PACK);
  // The locale whose load produced the current pack; a failed load leaves English in its place.
  const packLocale = ref<TimeRangeLocale>("en-us");
  const ready = computed(() => packLocale.value === timeRangeLocaleOf(opts.context().locale));
  const announcing = ref(false);
  // Text over the cap is refused whole, so the bar keeps its earlier text and only reports too-long.
  const refused = ref(false);
  const active = ref(true);
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  let packRequest = 0;

  watch(
    () => opts.context().locale,
    async (locale) => {
      const request = ++packRequest;
      const next = await packFor(locale);
      // A slower earlier load must not replace the pack of the locale picked after it.
      if (request !== packRequest) return;
      pack.value = next;
      packLocale.value = timeRangeLocaleOf(locale);
    },
    { immediate: true },
  );

  const parseContext = (): Omit<ParseContext, "text"> => {
    const { locale: _locale, ...rest } = opts.context();
    return { ...rest, pack: pack.value, source: source.value, nowUs: nowUs.value };
  };

  const result = computed<TimeRangeParseResult>(() =>
    refused.value
      ? { state: "invalid", reason: "too-long", examples: getInputExamples(parseContext()) }
      : parseTimeRangeInput({ ...parseContext(), text: text.value }),
  );

  const examples = computed(() => getInputExamples(parseContext()).slice(0, EXAMPLE_COUNT));

  // A range refused for ending after now becomes valid once now passes its end.
  let futureTick: ReturnType<typeof setInterval> | null = null;
  const stopFutureTick = () => {
    if (futureTick !== null) clearInterval(futureTick);
    futureTick = null;
  };
  watch(
    () => active.value && result.value.state === "blocked" && result.value.reason === "future",
    (future) => {
      stopFutureTick();
      if (!future) return;
      nowUs.value = nowMicros();
      futureTick = setInterval(() => (nowUs.value = nowMicros()), US_PER_S / US_PER_MS);
    },
    { immediate: true },
  );
  // A view kept alive behind another route must not keep the clock running.
  if (getCurrentInstance()) {
    onActivated(() => (active.value = true));
    onDeactivated(() => (active.value = false));
  }

  const stopAnnounceTimer = () => {
    if (announceTimer !== null) clearTimeout(announceTimer);
    announceTimer = null;
  };

  /** Reads `next`, or with `null` refuses an oversize paste and reports too-long over the kept text. */
  const setText = (next: string | null, from: InputSource = "typed") => {
    nowUs.value = nowMicros();
    source.value = from;
    refused.value = next === null || next.length > MAX_RANGE_TEXT_UNITS;
    if (next !== null && !refused.value) text.value = next;
    stopAnnounceTimer();
    announcing.value = true;
    announceTimer = setTimeout(() => {
      announcing.value = false;
      announceTimer = null;
    }, ANNOUNCE_DELAY_MS);
  };

  const clear = () => {
    stopAnnounceTimer();
    announcing.value = false;
    refused.value = false;
    source.value = "typed";
    text.value = "";
  };

  onScopeDispose(() => {
    stopAnnounceTimer();
    stopFutureTick();
  });

  return { text, source, result, examples, nowUs, pack, ready, announcing, setText, clear };
}
