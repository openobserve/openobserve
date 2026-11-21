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

export { default as tables } from "./generated/tr-turk";

export const pack: LocalePack = {
  key: "tr-turk",
  bcp47: "tr-TR",
  script: "latin",
  hooks: { fold: (ch) => (ch === "ı" ? "i" : ch) },
  units: {
    s: ["sn", "saniye"],
    m: ["dk", "dak", "dakika"],
    h: ["sa", "saat"],
    d: ["g", "gün"],
    w: ["hf", "hafta"],
    M: ["ay"],
    y: ["yıl", "sene"],
  },
  patterns: {
    lastN: ["(son|geçen|geçtiğimiz) {n} {unit}", "(son|geçen) {unit}"],
    ago: ["{n} {unit} önce"],
    since: ["{start}('dan|'den|'tan|'ten) (beri|itibaren)", "{start} (beri|itibaren)"],
  },
  rangeJoin: [],
  rangeTemplates: [
    "{start}('dan|'den|'tan|'ten|dan|den|tan|ten) {end}('a|'e|'ya|'ye|a|e|ya|ye) kadar",
    "{start} ile {end} (arası|arasında)",
  ],
  pointAffixes: [],
  clockAffixes: ["saat {clock}"],
  words: {
    today: ["bugün", "bugünden"],
    yesterday: ["dün", "dünden"],
    dayBeforeYesterday: ["evvelsi gün", "önceki gün"],
    tomorrow: ["yarın"],
    thisWeek: ["bu hafta"],
    lastWeek: ["geçen hafta", "önceki hafta", "geçtiğimiz hafta"],
    thisMonth: ["bu ay"],
    lastMonth: ["geçen ay", "önceki ay", "geçtiğimiz ay"],
    thisYear: ["bu yıl", "bu sene"],
    lastYear: ["geçen yıl", "geçen sene"],
    now: ["şimdi"],
  },
  dayParts: { sabah: [5, 12], "öğleden sonra": [12, 18], akşam: [17, 24], gece: [0, 6] },
  numberWords: {
    bir: 1,
    iki: 2,
    üç: 3,
    dört: 4,
    beş: 5,
    altı: 6,
    yedi: 7,
    sekiz: 8,
    dokuz: 9,
    on: 10,
    "on bir": 11,
    "on iki": 12,
  },
  nameTemplates: { lastN: "Son {duration}" },
  examples: ["son 15 dakika", "dün", "2 saat önce"],
};
