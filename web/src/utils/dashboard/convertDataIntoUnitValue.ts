import { getNumberLocale, localeFromUnit, resolveNumberLocale } from "@/locales/numberFormat";

const units: any = {
  bytes: [
    { unit: "B", divisor: 1 },
    { unit: "KB", divisor: 1024 },
    { unit: "MB", divisor: 1024 * 1024 },
    { unit: "GB", divisor: 1024 * 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
  ],
  seconds: [
    { unit: "ns", divisor: 0.000000001 },
    { unit: "μs", divisor: 0.000001 },
    { unit: "ms", divisor: 0.001 },
    { unit: "s", divisor: 1 },
    { unit: "m", divisor: 60 },
    { unit: "h", divisor: 3600 },
    { unit: "D", divisor: 86400 },
    { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
  ],
  microseconds: [
    { unit: "ns", divisor: 0.001 },
    { unit: "μs", divisor: 1 },
    { unit: "ms", divisor: 1000 },
    { unit: "s", divisor: 1000000 },
    { unit: "m", divisor: 60 * 1000000 },
    { unit: "h", divisor: 3600 * 1000000 },
    { unit: "D", divisor: 86400 * 1000000 },
    { unit: "M", divisor: 2592000 * 1000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000000 }, // Assuming 365 days in a year
  ],
  milliseconds: [
    { unit: "ns", divisor: 0.000001 },
    { unit: "μs", divisor: 0.001 },
    { unit: "ms", divisor: 1 },
    { unit: "s", divisor: 1000 },
    { unit: "m", divisor: 60 * 1000 },
    { unit: "h", divisor: 3600 * 1000 },
    { unit: "D", divisor: 86400 * 1000 },
    { unit: "M", divisor: 2592000 * 1000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000 }, // Assuming 365 days in a year
  ],
  nanoseconds: [
    { unit: "ns", divisor: 1 },
    { unit: "μs", divisor: 1000 },
    { unit: "ms", divisor: 1000000 },
    { unit: "s", divisor: 1000000000 },
    { unit: "m", divisor: 60 * 1000000000 },
    { unit: "h", divisor: 3600 * 1000000000 },
    { unit: "D", divisor: 86400 * 1000000000 },
    { unit: "M", divisor: 2592000 * 1000000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000000000 }, // Assuming 365 days in a year
  ],
  bps: [
    { unit: "B/s", divisor: 1 },
    { unit: "KB/s", divisor: 1024 },
    { unit: "MB/s", divisor: 1024 * 1024 },
    { unit: "GB/s", divisor: 1024 * 1024 * 1024 },
    { unit: "TB/s", divisor: 1024 * 1024 * 1024 * 1024 },
    { unit: "PB/s", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
  ],
  kilobytes: [
    { unit: "B", divisor: 1 / 1024 },
    { unit: "KB", divisor: 1 },
    { unit: "MB", divisor: 1024 },
    { unit: "GB", divisor: 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 },
  ],
  megabytes: [
    { unit: "B", divisor: 1 / (1024 * 1024) },
    { unit: "KB", divisor: 1 / 1024 },
    { unit: "MB", divisor: 1 },
    { unit: "GB", divisor: 1024 },
    { unit: "TB", divisor: 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 },
  ],
  numbers: [
    { unit: "", divisor: 1 },
    { unit: "K", divisor: 1e3 },
    { unit: "M", divisor: 1e6 },
    { unit: "B", divisor: 1e9 },
    { unit: "T", divisor: 1e12 },
    { unit: "Q", divisor: 1e15 },
  ],
};

type UnitStep = { unit: string; divisor: number };

const DECIMAL_STEPS = [1, 1e3, 1e6, 1e9, 1e12, 1e15];
const SI_BYTE_LABELS = ["B", "kB", "MB", "GB", "TB", "PB"];
const SI_BIT_LABELS = ["bit", "kbit", "Mbit", "Gbit", "Tbit", "Pbit"];
const HERTZ_LABELS = ["Hz", "kHz", "MHz", "GHz", "THz"];
const IEC_RATE_LABELS = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s", "PiB/s"];

const CURRENCY_LOCALES: Record<string, string> = {
  "currency-dollar": "en-US",
  "currency-euro": "de-DE",
  "currency-pound": "en-GB",
  "currency-yen": "ja-JP",
  "currency-rupee": "en-IN",
  "currency-yuan": "zh-CN",
  "currency-won": "ko-KR",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "currency-dollar": "$",
  "currency-euro": "€",
  "currency-pound": "£",
  "currency-yen": "¥",
  "currency-rupee": "₹",
  "currency-yuan": "¥",
  "currency-won": "₩",
};

const TEMPERATURE_SUFFIXES: Record<string, string> = { celsius: "°C", fahrenheit: "°F" };

// Largest unit first, so "from now" names the coarsest whole step (90s reads as 1m).
const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

// `own` is the step the input is in; its divisor must stay exactly 1 so zero keeps the panel's unit.
const decimalLadder = (labels: string[], own = 0): UnitStep[] =>
  labels.map((unit, index) => ({ unit, divisor: DECIMAL_STEPS[index] / DECIMAL_STEPS[own] }));

const timeLadder = (ownSeconds: number): UnitStep[] =>
  units.seconds.map(({ unit, divisor }: UnitStep) => ({ unit, divisor: divisor / ownSeconds }));

// Named rates carry their leading space in the suffix because callers join value and unit with nothing between.
const rateLadder = (suffix: string): UnitStep[] =>
  units.numbers.map(({ unit, divisor }: UnitStep) => ({ unit: `${unit}${suffix}`, divisor }));

Object.assign(units, {
  "bytes-si": decimalLadder(SI_BYTE_LABELS),
  "kilobytes-si": decimalLadder(SI_BYTE_LABELS, 1),
  "megabytes-si": decimalLadder(SI_BYTE_LABELS, 2),
  bits: decimalLadder(SI_BIT_LABELS),
  "bps-si": decimalLadder(SI_BYTE_LABELS.map((label) => `${label}/s`)),
  "bits-per-sec": decimalLadder(SI_BIT_LABELS.map((label) => `${label}/s`)),
  "req-per-sec": rateLadder(" req/s"),
  "ops-per-sec": rateLadder(" ops/s"),
  "events-per-sec": rateLadder(" events/s"),
  "req-per-min": rateLadder(" req/min"),
  "ops-per-min": rateLadder(" ops/min"),
  "events-per-min": rateLadder(" events/min"),
  "per-sec": rateLadder("/s"),
  "per-min": rateLadder("/min"),
  hertz: decimalLadder(HERTZ_LABELS),
  "bytes-per-sec": IEC_RATE_LABELS.map((unit, index) => ({ unit, divisor: 1024 ** index })),
  minutes: timeLadder(60),
  hours: timeLadder(3600),
  days: timeLadder(86400),
});

const TEXT_UNITS = new Set(["datetime", "from-now", "boolean"]);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Epoch milliseconds from seconds, milliseconds, microseconds or nanoseconds, told apart by magnitude. */
export const epochToMillis = (value: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude < 1e11) return value * 1000;
  if (magnitude < 1e14) return value;
  if (magnitude < 1e17) return value / 1000;
  return value / 1e6;
};

const toEpochMillis = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return epochToMillis(numeric);
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const formatLocalDateTime = (millis: number): string => {
  const d = new Date(millis);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
};

const formatFromNow = (millis: number, now = Date.now()): string => {
  const seconds = Math.round((millis - now) / 1000);
  const [unit, size] = RELATIVE_STEPS.find(([, step]) => Math.abs(seconds) >= step) ?? [
    "second",
    1,
  ];
  // -0 reads "0s ago" where 0 would read "in 0s".
  const amount = Math.trunc(seconds / size) || -0;
  return new Intl.RelativeTimeFormat(getNumberLocale(), {
    style: "narrow",
    numeric: "always",
  }).format(amount, unit);
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric !== 0;
};

/** Text for the units that do not scale a number; null when the unit is numeric or the value cannot be read. */
const formatTextUnit = (value: unknown, unit: string): string | null => {
  if (!TEXT_UNITS.has(unit)) return null;
  if (unit === "boolean") {
    const flag = toBoolean(value);
    return flag === null ? null : String(flag);
  }
  const millis = toEpochMillis(value);
  if (millis === null) return null;
  return unit === "datetime" ? formatLocalDateTime(millis) : formatFromNow(millis);
};

/**
 * Converts a value to a specific unit of measurement.
 *
 * @param {any} value - The value to be converted.
 * @param {string} unit - The unit of measurement to convert to.
 * @param {string} customUnit - (optional) A custom unit of measurement.
 * @return {object} An object containing the converted value and unit.
 */
export const getUnitValue = (
  value: any,
  unit: string,
  customUnit: string,
  decimals: number = 2,
) => {
  const pinnedLocale = localeFromUnit(unit);
  // console.time("getUnitValue:");
  let formattedValue;
  if (CURRENCY_LOCALES[unit]) {
    const numericValue = parseFloat(value) || 0;
    const formattedNumber = numericValue.toFixed(decimals);

    formattedValue = new Intl.NumberFormat(CURRENCY_LOCALES[unit], {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(formattedNumber));
  }

  const textValue = formatTextUnit(value, unit);
  if (textValue !== null) return { value: textValue, unit: "" };

  // value sign: positive = 1, negative = -1
  const sign = Math.sign(value);
  // abs value
  const absValue = Math.abs(value);

  if (Number.isNaN(absValue) || Number.isNaN(sign)) {
    return { value: value, unit: "" };
  }

  // if value is missing use - as a placeholder
  if (isNaN(value) || value === "") {
    return { value: value === "" ? "-" : value, unit: "" };
  }

  switch (pinnedLocale === null ? unit : "locale") {
    case "numbers":
    case "bytes":
    case "seconds":
    case "microseconds":
    case "milliseconds":
    case "nanoseconds":
    case "kilobytes":
    case "bps":
    case "megabytes":
    case "bytes-si":
    case "kilobytes-si":
    case "megabytes-si":
    case "bits":
    case "bps-si":
    case "bits-per-sec":
    case "req-per-sec":
    case "ops-per-sec":
    case "events-per-sec":
    case "req-per-min":
    case "ops-per-min":
    case "events-per-min":
    case "per-sec":
    case "per-min":
    case "minutes":
    case "hours":
    case "days":
    case "hertz":
    case "bytes-per-sec": {
      // start with last index
      let unitIndex = units[unit].length - 1;
      // while the value is smaller than the divisor
      while (unitIndex > 0 && absValue < units[unit][unitIndex].divisor) {
        unitIndex--;
      }
      // zero has nothing to scale, so it stays in the panel's own unit (divisor 1)
      if (absValue === 0) {
        const ownUnit = units[unit].findIndex((entry: { divisor: number }) => entry.divisor === 1);
        if (ownUnit !== -1) {
          unitIndex = ownUnit;
        }
      }

      // calculate the final value: sign * absValue / divisor
      const finalValue = ((sign * absValue) / units[unit][unitIndex].divisor).toFixed(decimals);
      const finalUnit = units[unit][unitIndex].unit;

      // console.timeEnd("getUnitValue:");
      return { value: finalValue, unit: finalUnit };
    }
    case "custom": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: `${customUnit ?? ""}`,
      };
    }
    case "locale": {
      const num = Number(value);
      if (Number.isNaN(num)) return { value: value, unit: "" };
      return {
        value: new Intl.NumberFormat(resolveNumberLocale(pinnedLocale), {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(num),
        unit: "",
      };
    }
    case "percent-1": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${(parseFloat(value) * 100)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "percent": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "celsius":
    case "fahrenheit": {
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: TEMPERATURE_SUFFIXES[unit],
      };
    }
    case "currency-pound":
    case "currency-dollar":
    case "currency-euro":
    case "currency-yen":
    case "currency-rupee":
    case "currency-yuan":
    case "currency-won": {
      return {
        value: `${formattedValue}`,
        unit: CURRENCY_SYMBOLS[unit],
      };
    }
    case "default":
    default: {
      return {
        value: isNaN(value) ? value : value === "" ? "-" : ((+value)?.toFixed(decimals) ?? 0),
        unit: "",
      };
    }
  }
};

/**
 * Formats a unit value.
 *
 * @param {any} obj - The object containing the value and unit.
 * @return {string} The formatted unit value.
 */
export const formatUnitValue = (obj: any) => {
  const { unit } = obj;

  if (Object.values(CURRENCY_SYMBOLS).includes(unit)) {
    return `${obj.unit}${obj.value}`;
  }
  return `${obj.value}${obj.unit}`;
};
