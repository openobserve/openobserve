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

import { localeFromUnit, resolveNumberLocale } from "@/locales/numberFormat";
import { formatUnitValue, getUnitLadder, getUnitValue } from "./convertDataIntoUnitValue";

export type ParseUnitResult =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "not-a-number" | "out-of-range" }
  | { ok: false; reason: "unknown-suffix"; suffix: string };

export interface UnitInputHints {
  example: string;
  suffixes: string[];
}

type LadderStep = { unit: string; divisor: number };
type Separators = { decimal: string; digits: Record<string, string> };

// Mirrors the locales getUnitValue formats each currency with.
const CURRENCIES: Record<string, { symbol: string; locale: string }> = {
  "currency-dollar": { symbol: "$", locale: "en-US" },
  "currency-euro": { symbol: "€", locale: "de-DE" },
  "currency-pound": { symbol: "£", locale: "en-GB" },
  "currency-yen": { symbol: "¥", locale: "ja-JP" },
  "currency-rupee": { symbol: "₹", locale: "en-IN" },
};

const TIME_KEYS = new Set([
  "nanoseconds",
  "microseconds",
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days",
]);
const BINARY_BYTE_KEYS = new Set(["bytes", "kilobytes", "megabytes", "bps"]);
const SI_BYTE_KEYS = new Set(["bytes-si", "kilobytes-si", "megabytes-si", "bps-si"]);
const BIT_KEYS = new Set(["bits", "bits-per-sec"]);
const DATA_RATE_KEYS = new Set(["bps", "bps-si", "bits-per-sec"]);

// Lower-case spellings people type, mapped to the ladder label they mean.
const TIME_ALIASES: Record<string, string> = {
  nsec: "ns",
  nanosecond: "ns",
  nanoseconds: "ns",
  us: "μs",
  µs: "μs",
  usec: "μs",
  microsecond: "μs",
  microseconds: "μs",
  msec: "ms",
  millisecond: "ms",
  milliseconds: "ms",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  day: "D",
  days: "D",
  mo: "M",
  month: "M",
  months: "M",
  yr: "Y",
  yrs: "Y",
  year: "Y",
  years: "Y",
};
const SI_BYTE_ALIASES: Record<string, string> = { byte: "B", bytes: "B" };
const BINARY_BYTE_ALIASES: Record<string, string> = {
  ...SI_BYTE_ALIASES,
  kib: "KB",
  mib: "MB",
  gib: "GB",
  tib: "TB",
  pib: "PB",
};
const BIT_PREFIXES: Record<string, string> = { k: "k", m: "M", g: "G", t: "T", p: "P" };

const PLAIN: Separators = { decimal: ".", digits: {} };
const LEAD = /^([+\-\u2212]?)\s*([$\u20ac\u00a3\u00a5\u20b9]?)\s*([+\-\u2212]?)\s*/;
const NUMBER_HEAD = /^[0-9.,'\u00a0\u202f\u2019\u066c]+/;
const GROUP_MARKS = /['\u00a0\u202f\u2019\u066c]/g;
const separatorCache = new Map<string, Separators>();

const squash = (text: string) => text.replace(/\s+/g, "");
const tidy = (value: number) => Number(value.toPrecision(15));

const numbersLadder = (): readonly LadderStep[] => getUnitLadder("numbers") ?? [];

const separatorsFor = (locale: string): Separators => {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  let result = PLAIN;
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
    const ascii = "1234567890";
    const native = new Intl.NumberFormat(locale, { useGrouping: false }).format(1234567890);
    const digits: Record<string, string> = {};
    if (native.length === ascii.length) {
      [...native].forEach((ch, i) => {
        if (ch !== ascii[i]) digits[ch] = ascii[i];
      });
    }
    result = { decimal, digits };
  } catch {
    result = PLAIN;
  }
  separatorCache.set(locale, result);
  return result;
};

const separatorsForUnit = (key: string): Separators => {
  if (CURRENCIES[key]) return separatorsFor(CURRENCIES[key].locale);
  const pinned = localeFromUnit(key);
  if (key === "locale" || pinned !== null) return separatorsFor(resolveNumberLocale(pinned));
  return PLAIN;
};

const normaliseNumber = (chunk: string, decimal: string): string | null => {
  const text = chunk.replace(GROUP_MARKS, "");
  if (decimal === ",") {
    if (!text.includes(",")) return text;
    if (!/^(\d{1,3}(\.\d{3})+|\d*),\d*$/.test(text)) return null;
    return text.replace(/\./g, "").replace(",", ".");
  }
  if (!text.includes(",")) return text;
  if (!/^\d{1,3}(,\d{2,3})+(\.\d*)?$/.test(text)) return null;
  return text.replace(/,/g, "");
};

const readNumber = (input: string, separators: Separators) => {
  let text = input;
  if (Object.keys(separators.digits).length) {
    text = [...text].map((ch) => separators.digits[ch] ?? ch).join("");
  }
  if (separators.decimal !== "." && separators.decimal !== ",") {
    text = text.split(separators.decimal).join(".");
  }
  const head = NUMBER_HEAD.exec(text);
  if (!head) return null;
  let rest = text.slice(head[0].length);
  const exponent = /^[eE][+-]?\d+/.exec(rest);
  if (exponent) rest = rest.slice(exponent[0].length);
  const normal = normaliseNumber(head[0], separators.decimal === "," ? "," : ".");
  if (normal === null || !/^(\d+\.?\d*|\.\d+)$/.test(normal)) return null;
  return { value: Number(normal + (exponent ? exponent[0] : "")), rest: rest.trim() };
};

const aliasesFor = (key: string): Record<string, string> => {
  if (TIME_KEYS.has(key)) return TIME_ALIASES;
  if (BINARY_BYTE_KEYS.has(key)) return BINARY_BYTE_ALIASES;
  if (SI_BYTE_KEYS.has(key)) return SI_BYTE_ALIASES;
  return {};
};

const commonSuffix = (labels: string[]): string => {
  if (!labels.length) return "";
  let suffix = labels[0];
  labels.forEach((label) => {
    while (suffix && !label.endsWith(suffix)) suffix = suffix.slice(1);
  });
  return suffix;
};

const stripRate = (text: string, key: string): string => {
  const perSecond = text.replace(/\/s(ec)?$/i, "");
  if (perSecond !== text || !DATA_RATE_KEYS.has(key)) return perSecond;
  return text.replace(/ps$/i, "");
};

const findStep = (key: string, labels: string[], suffix: string): number => {
  const exact = labels.indexOf(suffix);
  if (exact !== -1) return exact;
  const lower = suffix.toLowerCase();
  const loose = labels.flatMap((label, i) => (label.toLowerCase() === lower ? [i] : []));
  if (loose.length === 1) return loose[0];
  const alias = aliasesFor(key)[lower];
  if (alias !== undefined) return labels.indexOf(alias);
  // "Mb" is megabits only with a lower-case b; "MB" stays bytes and is refused.
  const bitForm = BIT_KEYS.has(key) ? /^([kKmMgGtTpP]?)b$/.exec(suffix) : null;
  if (bitForm) return labels.indexOf(`${BIT_PREFIXES[bitForm[1].toLowerCase()] ?? ""}bit`);
  return -1;
};

const matchLadder = (key: string, ladder: readonly LadderStep[], suffix: string) => {
  const rated = ladder.every((step) => /\/s$/.test(step.unit));
  const labels = ladder.map((step) => {
    const label = squash(step.unit);
    return rated ? label.replace(/\/s$/, "") : label;
  });
  const typed = rated ? stripRate(squash(suffix), key) : squash(suffix);
  if (!typed) return 1;
  const shared = commonSuffix(labels);
  const candidates = [typed];
  if (shared && !typed.toLowerCase().endsWith(shared.toLowerCase())) {
    candidates.push(typed + shared);
  }
  for (const candidate of candidates) {
    const index = findStep(key, labels, candidate);
    if (index !== -1) return ladder[index].divisor;
  }
  return undefined;
};

const resolveMultiplier = (
  key: string,
  suffix: string,
  leadSymbol: string,
  unitCustom: string,
): number | undefined => {
  let rest = suffix;
  const currency = CURRENCIES[key];
  if (currency) {
    let symbol = leadSymbol;
    if (!symbol && rest.endsWith(currency.symbol)) {
      symbol = currency.symbol;
      rest = rest.slice(0, -currency.symbol.length).trim();
    }
    if (symbol && symbol !== currency.symbol) return undefined;
    return matchLadder("numbers", numbersLadder(), rest);
  }
  if (leadSymbol) return undefined;
  if (!rest) return 1;
  if (key === "percent") return rest === "%" ? 1 : undefined;
  if (key === "percent-1") return rest === "%" ? 0.01 : undefined;
  if (key === "custom") {
    const own = squash(unitCustom).toLowerCase();
    return own && squash(rest).toLowerCase() === own ? 1 : undefined;
  }
  return matchLadder(key, getUnitLadder(key) ?? numbersLadder(), rest);
};

/** Reads a typed threshold such as "500 ms" or "4 GB" as the raw number of the panel unit. */
export const parseUnitInput = (
  text: string,
  unit?: string | null,
  unitCustom?: string | null,
): ParseUnitResult => {
  const input = String(text ?? "").trim();
  if (!input) return { ok: false, reason: "empty" };
  const key = unit || "default";
  const lead = LEAD.exec(input);
  const leadText = lead ? lead[0] : "";
  const negative = !!lead && [lead[1], lead[3]].some((sign) => sign === "-" || sign === "\u2212");
  const number = readNumber(input.slice(leadText.length), separatorsForUnit(key));
  if (!number) return { ok: false, reason: "not-a-number" };
  const multiplier = resolveMultiplier(key, number.rest, lead?.[2] ?? "", unitCustom ?? "");
  if (multiplier === undefined) {
    return { ok: false, reason: "unknown-suffix", suffix: `${lead?.[2] ?? ""}${number.rest}` };
  }
  const value = tidy(number.value * multiplier);
  if (!Number.isFinite(value)) return { ok: false, reason: "not-a-number" };
  return { ok: true, value: negative ? -value : value };
};

/** Reads a percentage-mode threshold: 0 to 100, with or without "%". */
export const parsePercentInput = (text: string): ParseUnitResult => {
  const input = String(text ?? "")
    .trim()
    .replace(/\s*%$/, "");
  if (!input) return { ok: false, reason: "empty" };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(input)) return { ok: false, reason: "not-a-number" };
  const value = Number(input);
  if (!(value >= 0 && value <= 100)) return { ok: false, reason: "out-of-range" };
  return { ok: true, value };
};

/** The shortest unit-formatted text that reads back to exactly `value`, for an input field. */
export const formatUnitInput = (
  value: number,
  unit?: string | null,
  unitCustom?: string | null,
): string => {
  const key = unit || "default";
  for (let decimals = 0; decimals <= 6; decimals++) {
    const text = String(formatUnitValue(getUnitValue(value, key, unitCustom ?? "", decimals)));
    const parsed = parseUnitInput(text, key, unitCustom);
    if (parsed.ok && parsed.value === value) return text;
  }
  return String(value);
};

/** A typing example and the suffixes the panel unit accepts, for placeholders and errors. */
export const unitInputHints = (
  unit?: string | null,
  unitCustom?: string | null,
): UnitInputHints => {
  const key = unit || "default";
  const currency = CURRENCIES[key];
  if (currency) return { example: `${currency.symbol}100`, suffixes: [currency.symbol] };
  if (key === "percent" || key === "percent-1") return { example: "90%", suffixes: ["%"] };
  if (key === "custom") {
    return unitCustom
      ? { example: `500 ${unitCustom}`, suffixes: [unitCustom] }
      : { example: "500", suffixes: [] };
  }
  if (TIME_KEYS.has(key)) {
    const examples: Record<string, string> = {
      seconds: "30 s",
      minutes: "5 min",
      hours: "1.5 h",
      days: "2 d",
    };
    return {
      example: examples[key] ?? "500 ms",
      suffixes: ["ns", "μs", "ms", "s", "min", "h", "d"],
    };
  }
  if (BINARY_BYTE_KEYS.has(key) || SI_BYTE_KEYS.has(key)) {
    const kilo = BINARY_BYTE_KEYS.has(key) ? "KB" : "kB";
    const rate = DATA_RATE_KEYS.has(key) ? "/s" : "";
    return {
      example: `${rate ? 10 : 4} ${rate ? "MB" : "GB"}${rate}`,
      suffixes: [kilo, "MB", "GB"].map((label) => `${label}${rate}`),
    };
  }
  if (BIT_KEYS.has(key)) {
    const rate = DATA_RATE_KEYS.has(key) ? "/s" : "";
    return {
      example: `100 Mbit${rate}`,
      suffixes: ["kbit", "Mbit", "Gbit"].map((label) => `${label}${rate}`),
    };
  }
  const ladder = getUnitLadder(key);
  const own = ladder?.find((step) => step.divisor === 1)?.unit.trim();
  if (ladder && own) {
    return { example: `2K${own.startsWith("/") ? "" : " "}${own}`, suffixes: ["K", "M", own] };
  }
  return { example: "500", suffixes: ["K", "M", "B"] };
};
