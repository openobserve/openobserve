// Copyright 2026 OpenObserve Inc.

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

export const formatLargeNumber = (number: number) => {
  if (number === undefined || number === null) return "";

  if (number >= 1000000000) {
    return (number / 1000000000).toFixed(1) + "B";
  } else if (number >= 1000000) {
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

/** Short display name for an IANA timezone, e.g. "GMT+5:30" or "PST". */
export function timezoneAbbr(timeZone: string): string {
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
  const parts = formatter.formatToParts(new Date());
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
