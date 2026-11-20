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

// Writes the Intl-derived half of each time-range locale pack to
// src/utils/timeRangeInput/packs/generated/<key>.ts. `--check` exits 1 when a file would change.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(WEB, "src/utils/timeRangeInput/packs/generated");

// Same keys and BCP 47 tags as localeFileMap in src/locales/index.ts.
export const LOCALES = {
  "en-us": "en-US",
  ar: "ar-SA",
  "zh-cn": "zh-CN",
  "tr-turk": "tr-TR",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  pt: "pt-PT",
  "zh-tw": "zh-TW",
  ru: "ru-RU",
  pl: "pl-PL",
  vi: "vi-VN",
  th: "th-TH",
};

const UNITS = [
  ["s", "second"],
  ["m", "minute"],
  ["h", "hour"],
  ["d", "day"],
  ["w", "week"],
  ["M", "month"],
  ["y", "year"],
];
const AUTO = [
  ["d", "day", [-2, -1, 0, 1, 2]],
  ["w", "week", [-1, 0, 1]],
  ["M", "month", [-1, 0, 1]],
  ["q", "quarter", [-1, 0]],
  ["y", "year", [-1, 0]],
];
const STYLES = ["long", "short", "narrow"];
const SAMPLE = Date.UTC(2026, 10, 15, 12);
const BIDI = /[‎‏؜]/g;

const clean = (s) => s.replace(BIDI, "").replace(/\s+/g, " ").trim();
const uniq = (xs) => [...new Set(xs)];

function counts(tag) {
  const rules = new Intl.PluralRules(tag);
  const seen = new Map();
  for (let n = 1; n <= 200; n++) if (!seen.has(rules.select(n))) seen.set(rules.select(n), n);
  return uniq([1, 2, ...seen.values()]);
}

function relative(tag) {
  const ago = {};
  const fixed = [];
  for (const [key, unit] of UNITS) {
    const templates = [];
    for (const style of STYLES) {
      const rtf = new Intl.RelativeTimeFormat(`${tag}-u-nu-latn`, { numeric: "always", style });
      for (const n of counts(tag)) {
        const parts = rtf.formatToParts(-n, unit);
        const text = clean(parts.map((p) => (p.type === "integer" ? "{n}" : p.value)).join(""));
        if (/^[-+]/.test(text)) continue;
        if (text.includes("{n}")) templates.push(text);
        else fixed.push([key, n, text]);
      }
    }
    ago[key] = uniq(templates);
  }
  const auto = [];
  for (const [key, unit, offsets] of AUTO) {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    for (const offset of offsets) {
      const word = clean(rtf.format(offset, unit));
      // Sentence case: the word doubles as the reading's name, as the rail labels it.
      if (!/\d/.test(word))
        auto.push([key, offset, word.replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase(tag))]);
    }
  }
  return { ago, fixed: uniq(fixed.map((f) => JSON.stringify(f))).map((f) => JSON.parse(f)), auto };
}

function pattern(parts) {
  const out = [];
  for (const part of parts) {
    if (part.type === "year") out.push("{y}");
    else if (part.type === "month") out.push(/^\d+$/.test(part.value) ? "{m}" : "{month}");
    else if (part.type === "day") out.push("{d}");
    else if (part.type === "literal" || part.type === "era") out.push(part.value);
    else return null;
  }
  return clean(out.join(""));
}

// Pinned, so a host whose ICU defaults a locale to another calendar (ar-SA on ICU 74)
// still writes the same tables.
function calendarOf(era) {
  return era === "buddhist" ? "buddhist" : "gregory";
}

function dates(tag, era) {
  const fmt = (options, calendar = calendarOf(era)) =>
    new Intl.DateTimeFormat(tag, {
      timeZone: "UTC",
      calendar,
      numberingSystem: "latn",
      ...options,
    });
  const numericParts = fmt({ year: "numeric", month: "numeric", day: "numeric" }).formatToParts(
    SAMPLE,
  );
  const order = numericParts
    .filter((p) => ["year", "month", "day"].includes(p.type))
    .map((p) => p.type[0])
    .join("");
  const forms = [];
  for (const month of ["long", "short"]) {
    forms.push(pattern(fmt({ year: "numeric", month, day: "numeric" }).formatToParts(SAMPLE)));
    forms.push(pattern(fmt({ month, day: "numeric" }).formatToParts(SAMPLE)));
    if (era === "buddhist") {
      forms.push(
        pattern(
          fmt({ era: "short", year: "numeric", month, day: "numeric" }).formatToParts(SAMPLE),
        ),
      );
    }
  }
  if (era === "roc") {
    const roc = pattern(
      fmt({ year: "numeric", month: "long", day: "numeric" }, "roc").formatToParts(SAMPLE),
    );
    if (roc) forms.push(roc.replace("{y}", "{ry}"));
  }
  const numeric = pattern(numericParts);
  // Year-first numeric dates (`2026/1/5`) have no hand scanner, so they match as date patterns.
  if (order[0] === "y") forms.push(numeric);
  return {
    dateOrder: order,
    numeric: [numeric],
    dates: uniq(forms.filter(Boolean)),
  };
}

function names(tag, era) {
  const calendar = calendarOf(era);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const at = Date.UTC(2026, m, 15, 12);
    const variants = [];
    for (const width of ["long", "short"]) {
      const inDate = new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        calendar,
        numberingSystem: "latn",
        day: "numeric",
        month: width,
      });
      const alone = new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        calendar,
        numberingSystem: "latn",
        month: width,
      });
      variants.push(
        ...inDate
          .formatToParts(at)
          .filter((p) => p.type === "month")
          .map((p) => p.value),
      );
      variants.push(
        ...alone
          .formatToParts(at)
          .filter((p) => p.type === "month")
          .map((p) => p.value),
      );
    }
    months.push(uniq(variants.map(clean).filter((v) => !/^\d+$/.test(v))));
  }
  const weekdays = [];
  for (let d = 0; d < 7; d++) {
    const at = Date.UTC(2026, 10, 15 + d, 12);
    const variants = [];
    for (const width of ["long", "short"]) {
      const f = new Intl.DateTimeFormat(tag, { timeZone: "UTC", calendar, weekday: width });
      variants.push(clean(f.format(at)));
    }
    weekdays.push(uniq(variants).filter((v) => [...v].length > 1));
  }
  const hour = new Intl.DateTimeFormat(tag, {
    timeZone: "UTC",
    calendar,
    numberingSystem: "latn",
    hour: "numeric",
    hour12: true,
  });
  const period = (h) =>
    hour
      .formatToParts(Date.UTC(2026, 0, 1, h))
      .filter((p) => p.type === "dayPeriod")
      .map((p) => clean(p.value));
  return { months, weekdays, meridiem: [uniq(period(9)), uniq(period(15))] };
}

function firstDay(tag) {
  const locale = new Intl.Locale(tag);
  const info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
  return info.firstDay % 7;
}

export function tablesFor(key) {
  const tag = LOCALES[key];
  const era = key === "th" ? "buddhist" : key === "zh-tw" ? "roc" : undefined;
  return {
    icu: process.versions.icu,
    bcp47: tag,
    firstDay: firstDay(tag),
    ...dates(tag, era),
    ...names(tag, era),
    ...relative(tag),
  };
}

async function render(key) {
  const body = JSON.stringify(tablesFor(key), null, 2);
  const source = [
    "// Generated by web/scripts/gen-time-range-intl.mjs; do not edit by hand.",
    'import type { GeneratedTables } from "../schema";',
    "",
    `const tables: GeneratedTables = ${body};`,
    "",
    "export default tables;",
    "",
  ].join("\n");
  const config = (await prettier.resolveConfig(join(OUT, `${key}.ts`))) ?? {};
  return prettier.format(source, { ...config, plugins: [], parser: "typescript" });
}

/** The ICU version a committed tables file was generated with; prettier leaves its key unquoted. */
export function committedIcu(source) {
  return /"?icu"?: "([^"]+)"/.exec(source)?.[1];
}

async function main() {
  const check = process.argv.includes("--check");
  let drift = 0;
  if (!check) mkdirSync(OUT, { recursive: true });
  for (const key of Object.keys(LOCALES)) {
    const file = join(OUT, `${key}.ts`);
    const next = await render(key);
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current === next) continue;
    const icu = committedIcu(current);
    if (check && icu && icu !== process.versions.icu) {
      console.warn(`gen-time-range-intl: ${key}.ts was generated with ICU ${icu}; skipped`);
      continue;
    }
    if (check) {
      drift++;
      console.error(`gen-time-range-intl: ${key}.ts is out of date`);
    } else {
      writeFileSync(file, next);
    }
  }
  if (check && drift > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
