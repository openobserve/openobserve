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

import type { LocalePack } from "./schema";

export { default as tables } from "./generated/ar";

const LETTER_FOLD: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ى: "ي",
  ة: "ه",
  ؤ: "و",
  ئ: "ي",
};
const MARKS = new Set(["\u200e", "\u200f", "\u061c"]);

function dateChar(ch: string | undefined): boolean {
  const c = ch?.codePointAt(0) ?? -1;
  return (
    ch === "/" ||
    ch === "." ||
    ch === "-" ||
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x660 && c <= 0x669) ||
    (c >= 0x6f0 && c <= 0x6f9)
  );
}

// Intl writes direction marks beside the separators of numeric dates; one between two digits, or by
// a sign that follows no digit (`:-‏1`), stays and fails.
function dropDateMarks(nfkc: string): string {
  const cps = [...nfkc];
  const sep = (ch: string | undefined) => ch === "/" || ch === "." || ch === "-";
  const digit = (ch: string | undefined) => dateChar(ch) && !sep(ch);
  return cps
    .filter(
      (ch, i) =>
        !(
          MARKS.has(ch) &&
          ((sep(cps[i - 1]) && digit(cps[i - 2]) && digit(cps[i + 1])) ||
            (sep(cps[i + 1]) && digit(cps[i + 2]) && digit(cps[i - 1])))
        ),
    )
    .join("");
}

export const pack: LocalePack = {
  key: "ar",
  bcp47: "ar-SA",
  script: "arabic",
  hooks: { fold: (ch) => LETTER_FOLD[ch] ?? ch, clean: dropDateMarks },
  dateOrder: "dmy",
  slashAmbiguous: true,
  units: {
    s: ["ثانية", "ثواني", "ثوان"],
    m: ["دقيقة", "دقائق", "دقايق", "د"],
    h: ["ساعة", "ساعات", "س"],
    d: ["يوم", "أيام"],
    w: ["أسبوع", "أسابيع"],
    M: ["شهر", "أشهر", "شهور"],
    y: ["سنة", "سنوات", "عام", "أعوام"],
  },
  countedUnits: {
    دقيقتين: ["m", 2],
    ساعتين: ["h", 2],
    يومين: ["d", 2],
    أسبوعين: ["w", 2],
    شهرين: ["M", 2],
    سنتين: ["y", 2],
  },
  patterns: {
    lastN: ["(آخر|خلال آخر|في آخر) {n} {unit}", "(آخر|خلال آخر|في آخر) {unit}"],
    ago: ["(قبل|منذ) {n} {unit}", "(قبل|منذ) {unit}"],
    since: ["(منذ|من) {start}"],
  },
  rangeJoin: ["إلى", "حتى"],
  rangeTemplates: ["من {start} (إلى|حتى) {end}", "بين {start} و {end}"],
  pointAffixes: ["(يوم|في) {date}"],
  clockAffixes: ["الساعة {clock}"],
  words: {
    today: ["اليوم"],
    yesterday: ["أمس", "البارحة", "مبارح", "امبارح"],
    dayBeforeYesterday: ["أول أمس", "قبل أمس"],
    tomorrow: ["غدا", "غدًا", "بكرة", "بكرا"],
    thisWeek: ["هذا الأسبوع", "هالأسبوع", "الأسبوع الحالي"],
    lastWeek: ["الأسبوع الماضي", "الأسبوع اللي فات", "الأسبوع السابق"],
    thisMonth: ["هذا الشهر", "هالشهر", "الشهر الحالي"],
    lastMonth: ["الشهر الماضي", "الشهر اللي فات", "الشهر السابق"],
    thisYear: ["هذه السنة", "هذا العام"],
    lastYear: ["السنة الماضية", "العام الماضي"],
    now: ["الآن"],
  },
  meridiem: {
    am: ["صباحا", "صباحًا", "صباحاً", "صباح"],
    pm: ["مساء", "مساءً", "مساءا"],
  },
  // Noon and afternoon are day parts, not marks: they also take a 24-hour clock (`١٦:٣٠ عصرا`).
  dayParts: { ظهرا: [12, 17], عصرا: [12, 19] },
  numberWords: {
    واحد: 1,
    واحدة: 1,
    اثنين: 2,
    اثنان: 2,
    ثلاث: 3,
    ثلاثة: 3,
    أربع: 4,
    أربعة: 4,
    خمس: 5,
    خمسة: 5,
    ست: 6,
    ستة: 6,
    سبع: 7,
    سبعة: 7,
    ثمان: 8,
    ثمانية: 8,
    تسع: 9,
    تسعة: 9,
    عشر: 10,
    عشرة: 10,
  },
  nameTemplates: { lastN: "آخر {duration}" },
  examples: ["آخر 15 دقيقة", "أمس", "قبل ساعتين"],
};
