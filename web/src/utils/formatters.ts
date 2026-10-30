// Copyright 2026 OpenObserve Inc.

import i18n from "@/locales";
import { APP_LOCALE_TO_BCP47 } from "@/locales/numberFormat";
import { gt } from "@/types/i18n";

export const b64EncodeUnicode = (str: string) => {
  try {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(`0x${p1}`));
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, ".");
  } catch (e) {
    console.log("Error: getBase64Encode: error while encoding.");
    return null;
  }
};

export const b64DecodeUnicode = (str: string) => {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "=")), function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
  } catch (e) {
    console.log("Error: getBase64Decode: error while decoding.");
    return undefined;
  }
};

export const b64DecodeUnicodeSafe = (str: string, fallback = ""): string => {
  if (!str) return fallback;
  return b64DecodeUnicode(str) ?? fallback;
};

const isBase64Encoded = (str: string): boolean => {
  if (!str || typeof str !== "string") return false;

  const base64Pattern = /^[A-Za-z0-9\-_.]+$/;

  if (!base64Pattern.test(str)) return false;

  try {
    const decoded = b64DecodeUnicode(str);
    return decoded !== undefined && decoded !== null && decoded !== str;
  } catch (e) {
    return false;
  }
};

export const smartDecodeVrlFunction = (vrlFunction: string | null | undefined): string => {
  if (!vrlFunction) return "";

  try {
    const firstDecode = b64DecodeUnicode(vrlFunction);

    if (!firstDecode) return vrlFunction;

    if (isBase64Encoded(firstDecode)) {
      const secondDecode = b64DecodeUnicode(firstDecode);
      return secondDecode || firstDecode;
    }

    return firstDecode;
  } catch (e) {
    console.error("Error decoding VRL function:", e);
    return vrlFunction;
  }
};

export const b64EncodeStandard = (str: string) => {
  try {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1: any) {
        return String.fromCharCode(parseInt(`0x${p1}`));
      }),
    );
  } catch (e) {
    console.log("Error: getBase64Encode: error while encoding.");
    return undefined;
  }
};

export const b64DecodeStandard = (str: string) => {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str), function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
  } catch (e) {
    console.log("Error: getBase64Decode: error while decoding.");
    return undefined;
  }
};

export const convertToTitleCase = (str: string) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export const truncateText = (text: string, maxLength: number): string => {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 1, 0))}…`;
};

// True when `num / divisor` would print as 1000.0 or more at one decimal, so the
// value belongs in the next unit up (999 950 is "1.0M", not "1000.0K").
const roundsToNextUnit = (num: number, divisor: number) =>
  Number((num / divisor).toFixed(1)) >= 1000;

export const formatLargeNumber = (number: number) => {
  if (number === undefined || number === null) return "";

  if (number >= 1000000000 || roundsToNextUnit(number, 1000000)) {
    return (number / 1000000000).toFixed(1) + "B";
  } else if (number >= 1000000 || roundsToNextUnit(number, 1000)) {
    return (number / 1000000).toFixed(1) + "M";
  } else if (number >= 1000) {
    return (number / 1000).toFixed(1) + "K";
  } else {
    return number.toString();
  }
};

/**
 * Compact record/event count, as shown on the Home → Usage tiles: exact below
 * 100 000, then K/M/B/T with one decimal ("2.9B"). Shared so every surface that
 * prints an event count prints the SAME string — Home and the Streams page must
 * not disagree about the size of the same number.
 */
export const formatEventCount = (num: number): string => {
  if (!Number.isFinite(num)) return "";
  if (num < 100000) return num.toString();

  const units = ["", "K", "M", "B", "T"];
  let tier = Math.floor(Math.log10(num) / 3);

  if (tier < units.length - 1 && roundsToNextUnit(num, Math.pow(10, tier * 3))) tier++;
  if (tier >= units.length) tier = units.length - 1;

  const scaled = num / Math.pow(10, tier * 3);
  return scaled.toFixed(1).replace(/\.0$/, "") + units[tier];
};

export const formatSizeFromMB = (sizeInMB: string | number) => {
  let size = parseFloat(String(sizeInMB));

  if (isNaN(size)) {
    return "0 MB";
  }

  const units = ["KB", "MB", "GB", "TB", "PB"];
  let index = 1;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }

  let new_size = size.toFixed(2);
  if (new_size == "0.00" && size > 0) {
    new_size = "0.01";
  }

  return `${new_size} ${units[index]}`;
};

export const addCommasToNumber = (number: number) => {
  if (number === null || number === undefined) return "0";
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const formatTimeWithSuffix = (us: number) => {
  if (!us || us === 0) {
    return "0us";
  }

  if (us >= 1000 * 1000 * 60) {
    return `${(us / 1000 / 1000 / 60).toFixed(2)}m`;
  }

  if (us >= 1000 * 1000) {
    return `${(us / 1000 / 1000).toFixed(2)}s`;
  }

  if (us >= 1000) {
    return `${(us / 1000).toFixed(2)}ms`;
  }

  return `${us.toFixed(2)}us`;
};

export function formatDuration(ms: number) {
  if (!ms || ms === 0) return gt("common.secShort", { count: 0 });
  const seconds = (ms / 1000).toFixed(2);
  const minutes = (Number(seconds) / 60).toFixed(2);
  const hours = (Number(minutes) / 60).toFixed(2);
  const days = (Number(hours) / 24).toFixed(2);

  if (ms > 86400000) return gt("common.daysHrShort", { days, hours });
  if (ms > 3600000) return gt("common.hrShort", { count: hours });
  if (ms > 60000) return gt("common.minShort", { count: minutes });
  return gt("common.secShort", { count: seconds });
}

export const durationFormatter = (durationInSeconds: number): string => {
  let formattedDuration;

  if (durationInSeconds < 0) {
    formattedDuration = gt("common.invalidDuration");
  } else if (durationInSeconds < 60) {
    formattedDuration = `${durationInSeconds}s`;
  } else if (durationInSeconds < 3600) {
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${minutes > 0 ? `${minutes}m ` : ""}${
      seconds > 0 ? `${seconds}s` : ""
    }`.trim();
  } else if (durationInSeconds < 86400) {
    const hours = Math.floor(durationInSeconds / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${hours > 0 ? `${hours}h ` : ""}${
      minutes > 0 ? `${minutes}m ` : ""
    }${seconds > 0 ? `${seconds}s` : ""}`.trim();
  } else {
    const days = Math.floor(durationInSeconds / 86400);
    const hours = Math.floor((durationInSeconds % 86400) / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${days > 0 ? `${days}d ` : ""}${
      hours > 0 ? `${hours}h ` : ""
    }${minutes > 0 ? `${minutes}m ` : ""}${seconds > 0 ? `${seconds}s` : ""}`.trim();
  }

  return formattedDuration;
};

export const maskText = (text: string) => {
  return text;
};

export const convertToCamelCase = (str: string) => {
  if (!str) {
    return "";
  }

  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/** Display symbol for a model-pricing tier-condition operator. */
export function operatorSymbol(op: string): string {
  const map: Record<string, string> = {
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    eq: "=",
    neq: "≠",
  };
  return map[op] || op;
}

/** Attribute rule → `openai.response.service_tier +1 is one of flex, priority`, labelled through `t`. */
export function formatTierRule(
  rule: { keys?: string[]; op?: string; values?: string[]; value?: number | null },
  t: (_key: string) => string,
): string {
  const keys = (rule?.keys ?? []).map((k) => String(k ?? "").trim()).filter(Boolean);
  const key = keys.length > 1 ? `${keys[0]} +${keys.length - 1}` : (keys[0] ?? "");
  const op = rule?.op ?? "in";
  const labels: Record<string, string> = {
    in: "modelPricing.ruleOpIn",
    not_in: "modelPricing.ruleOpNotIn",
    exists: "modelPricing.ruleOpExists",
    not_exists: "modelPricing.ruleOpNotExists",
  };
  if (op === "exists" || op === "not_exists") return `${key} ${t(labels[op])}`;
  if (op === "in" || op === "not_in") {
    return `${key} ${t(labels[op])} ${(rule?.values ?? []).join(", ")}`;
  }
  return `${key} ${operatorSymbol(op)} ${rule?.value ?? ""}`;
}

/**
 * Minutes past UTC midnight → `HH:MM`. 1440 renders as `24:00` so a range
 * ending at midnight labels its end rather than wrapping back to `00:00`.
 */
export function minuteOfDayToHhmm(minute: number): string {
  if (minute === 1440) return "24:00";
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Recurring UTC windows → `"01:00–04:00, 06:00–10:00 UTC"`. */
export function formatUtcWindows(
  windows: Array<{ start_minute: number; end_minute: number }>,
): string {
  if (!windows?.length) return "";
  const ranges = windows
    .map((w) => `${minuteOfDayToHhmm(w.start_minute)}–${minuteOfDayToHhmm(w.end_minute)}`)
    .join(", ");
  return `${ranges} UTC`;
}

// Constructing an Intl.DateTimeFormat is the expensive part and these run on every
// render. `null` caches a timezone the runtime rejects, so it is not retried.
const hhmmFormatters = new Map<string, Intl.DateTimeFormat | null>();
const abbrFormatters = new Map<string, Intl.DateTimeFormat | null>();
// The assistant formatters read the UI locale from i18n and the org zone from the caller, never `navigator.language`.
const orgTimeFormatters = new Map<string, Intl.DateTimeFormat | null>();
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const DAY_MS = 86_400_000;
// The store imports this module (directly and via zincutils), so it registers its zone here; importing it would cycle.
let orgTimeZoneSource: () => string | undefined = () => undefined;

type ElapsedSymbol = "ms" | "s" | "min" | "h";

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat | null>,
  timeZone: string,
  build: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat | null {
  const cached = cache.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = build();
  } catch {
    formatter = null;
  }
  cache.set(timeZone, formatter);
  return formatter;
}

/**
 * A UTC minute-of-day rendered as `HH:MM` in the given IANA timezone (today's
 * offset — good enough for a conversion hint; DST shifts it by design).
 * Returns "" for an unknown timezone.
 */
export function utcMinuteToTzHhmm(minute: number, timeZone: string): string {
  const formatter = cachedFormatter(
    hhmmFormatters,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
  );
  if (!formatter) return "";
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(m / 60), m % 60),
  );
  return formatter.format(d);
}

/** Short display name for an IANA timezone at `at` (default now), e.g. "GMT+5:30" or "PST". */
export function timezoneAbbr(timeZone: string, at: Date = new Date()): string {
  const formatter = cachedFormatter(
    abbrFormatters,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "short",
      }),
  );
  if (!formatter) return timeZone;
  const parts = formatter.formatToParts(at);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * Recurring UTC windows converted into the given timezone —
 * `"06:30–09:30, 11:30–15:30 GMT+5:30"`. Returns "" when there is nothing to
 * show: no windows, an unknown timezone, or a timezone equivalent to UTC
 * (where the conversion would just repeat the UTC line).
 */
export function formatUtcWindowsInTz(
  windows: Array<{ start_minute: number; end_minute: number }>,
  timeZone: string,
): string {
  if (!windows?.length || !timeZone) return "";
  const ranges = windows.map((w) => {
    const start = utcMinuteToTzHhmm(w.start_minute, timeZone);
    const end = utcMinuteToTzHhmm(w.end_minute, timeZone);
    if (!start || !end) return "";
    return `${start}–${end}`;
  });
  if (ranges.some((r) => !r)) return "";
  const utcRanges = windows.map(
    (w) => `${minuteOfDayToHhmm(w.start_minute % 1440)}–${minuteOfDayToHhmm(w.end_minute % 1440)}`,
  );
  if (ranges.join(", ") === utcRanges.join(", ")) return "";
  return `${ranges.join(", ")} ${timezoneAbbr(timeZone)}`;
}

/**
 * Re-exported, not reimplemented: `@/utils/zincutils` barrels this module, so
 * this is how the many `import { convertUnixToDateFormat } from "@/utils/zincutils"`
 * call sites resolve. The implementation lives in `@/utils/date` — there is
 * exactly one.
 */
export { convertUnixToDateFormat } from "@/utils/date";

/**
 * Compact duration for a MICROSECOND span, e.g. `4m 12s`.
 *
 * Lives here, not in `utils/oncall.ts`, because "how long has this been open"
 * has to read identically on a page, an incident and an alert history row — the
 * moment two modules own a duration formatter they drift.
 *
 * Rounds toward zero and drops empty leading units. Negative spans (clock skew
 * across nodes) render as `—` rather than a negative duration.
 */
export const formatMicrosDuration = (micros: number): string => {
  if (!Number.isFinite(micros) || micros < 0) return "—";
  const totalSeconds = Math.floor(micros / 1_000_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
};

/** Supplies the org zone that `formatOrgTime` and `formatOrgRange` use when no `timeZone` is passed. */
export function setOrgTimeZoneSource(source: () => string | undefined): void {
  orgTimeZoneSource = source;
}

/** The Intl locale of the UI language; an unknown code is tried as-is before falling back to en-US. */
export function uiIntlLocale(): string {
  const current = i18n.global.locale as unknown as string | { value: string };
  const code = typeof current === "string" ? current : current.value;
  const mapped = APP_LOCALE_TO_BCP47[code];
  if (mapped) return mapped;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([code]).length ? code : "en-US";
  } catch {
    return "en-US";
  }
}

/** Minute-precision time in the org zone: "13:57" today, weekday this week, date older; `absolute` is the tooltip form. */
export function formatOrgTime(
  ts: number,
  opts: {
    /** `second` is for row timestamps, where two rows in one minute must still differ. */
    precision?: "minute" | "second";
    showZone?: boolean;
    timeZone?: string;
    absolute?: boolean;
    now?: number;
  } = {},
): string {
  const locale = uiIntlLocale();
  const tz = opts.timeZone ?? orgTimeZone();
  if (opts.absolute) return absoluteOrgTime(ts, tz, locale);
  const now = opts.now ?? Date.now();
  const time = orgParts(ts, tz, locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(opts.precision === "second" && { second: "2-digit" }),
  });
  const day = dayDistance(ts, now, tz);
  const zone = opts.showZone ? ` ${zoneName(ts, tz, locale)}` : "";
  if (day === 0) return `${time}${zone}`;
  if (day > 0 && day < 7) {
    return `${orgParts(ts, tz, locale, { weekday: "short" })} ${time}${zone}`;
  }
  const sameYear = orgYear(ts, tz) === orgYear(now, tz);
  const date = orgParts(ts, tz, locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date} ${time}${zone}`;
}

/** A calendar day in the org zone and UI locale ("1 Nov"), for renewal dates. */
export function formatOrgDay(ts: number): string {
  return orgParts(ts, orgTimeZone(), uiIntlLocale(), { day: "numeric", month: "short" });
}

/** "2026-11-01" in the org zone, for text pasted outside the app. */
export function formatOrgIsoDay(ts: number): string {
  return orgParts(ts, orgTimeZone(), "en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Calendar days between `ts` and `now` in the org zone (0 = same day), never a 24 h span. */
export function orgDayDistance(ts: number, now: number, timeZone: string = orgTimeZone()): number {
  return dayDistance(ts, now, timeZone);
}

/** "13:42–13:58 GMT+5:30": one zone, always named, en dash between the ends. */
export function formatOrgRange(from: number, to: number, opts: { timeZone?: string } = {}): string {
  const locale = uiIntlLocale();
  const tz = opts.timeZone ?? orgTimeZone();
  const zone = zoneName(to, tz, locale);
  const clock = (ts: number) => orgParts(ts, tz, locale, { hour: "2-digit", minute: "2-digit" });
  if (dayDistance(from, to, tz) === 0) return `${clock(from)}–${clock(to)} ${zone}`;
  const dated = (ts: number) =>
    `${orgParts(ts, tz, locale, { day: "numeric", month: "short" })} ${clock(ts)}`;
  return `${dated(from)} – ${dated(to)} ${zone}`;
}

/** "just now", then the short `Intl.RelativeTimeFormat` style of the UI locale ("3 min. ago" in en-US, "3 min ago" in en-GB). */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const seconds = Math.round((ts - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return gt("common.justNow");
  const rtf = new Intl.RelativeTimeFormat(uiIntlLocale(), { numeric: "auto", style: "short" });
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < DAY_MS / 1000) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < (30 * DAY_MS) / 1000) return rtf.format(Math.round(seconds / 86_400), "day");
  if (abs < (365 * DAY_MS) / 1000) return rtf.format(Math.round(seconds / 2_592_000), "month");
  return rtf.format(Math.round(seconds / 31_536_000), "year");
}

/** "380 ms", "12 s", "1 min 4 s"; named apart from the older `formatDuration`, whose callers keep their output. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const number = new Intl.NumberFormat(uiIntlLocale(), { maximumFractionDigits: 0 });
  // SI symbols are language-neutral, unlike Intl's short units ("12 sec", "12 Sek.").
  const unit = (value: number, symbol: ElapsedSymbol) => `${number.format(value)} ${symbol}`;
  // Round before choosing the unit, so 999.6 ms reads "1 s", never "1,000 ms".
  const wholeMs = Math.round(ms);
  if (wholeMs < 1000) return unit(wholeMs, "ms");
  const totalSeconds = Math.floor(wholeMs / 1000);
  if (totalSeconds < 60) return unit(totalSeconds, "s");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes ? `${unit(hours, "h")} ${unit(minutes, "min")}` : unit(hours, "h");
  return seconds ? `${unit(minutes, "min")} ${unit(seconds, "s")}` : unit(minutes, "min");
}

/** Locale digit grouping for a whole count; the caller pluralises the noun with the same count. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat(uiIntlLocale(), { maximumFractionDigits: 0 }).format(n);
}

/** "2.3 MB" in binary steps with at most one decimal. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  let value = n;
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index++;
  }
  const digits = index === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(uiIntlLocale(), { maximumFractionDigits: digits }).format(
    value,
  );
  return `${number} ${BYTE_UNITS[index]}`;
}

function orgFormatter(locale: string, tz: string, options: Intl.DateTimeFormatOptions) {
  return cachedFormatter(
    orgTimeFormatters,
    `${locale}|${tz}|${JSON.stringify(options)}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: tz, hourCycle: "h23", ...options }),
  );
}

function orgParts(
  ts: number,
  tz: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return orgFormatter(locale, tz, options)?.format(new Date(ts)) ?? "";
}

/** The org's IANA zone, else the browser's. */
export function orgTimeZone(): string {
  return orgTimeZoneSource() || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function orgYear(ts: number, tz: string): number {
  return Number(orgParts(ts, tz, "en-US", { year: "numeric" }));
}

function orgDayNumber(ts: number, tz: string): number {
  const parts = orgFormatter("en-US", tz, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })?.formatToParts(new Date(ts));
  const get = (type: string) => Number(parts?.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS;
}

function dayDistance(ts: number, now: number, tz: string): number {
  return orgDayNumber(now, tz) - orgDayNumber(ts, tz);
}

function zoneName(ts: number, tz: string, locale: string): string {
  const parts = orgFormatter(locale, tz, { timeZoneName: "short" })?.formatToParts(new Date(ts));
  return parts?.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

function absoluteOrgTime(ts: number, tz: string, locale: string): string {
  const parts = orgFormatter("en-US", tz, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })?.formatToParts(new Date(ts));
  const get = (type: string) => parts?.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${zoneName(ts, tz, locale)}`;
}
