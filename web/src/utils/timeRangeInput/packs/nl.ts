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

export { default as tables } from "./generated/nl";

export const pack: LocalePack = {
  key: "nl",
  bcp47: "nl-NL",
  script: "latin",
  units: {
    s: ["s", "sec", "seconde", "seconden"],
    m: ["m", "min", "minuut", "minuten"],
    h: ["u", "uur", "uren"],
    d: ["d", "dag", "dagen"],
    w: ["w", "week", "weken"],
    M: ["mnd", "maand", "maanden"],
    y: ["j", "jaar", "jaren"],
  },
  patterns: {
    lastN: [
      "(afgelopen|laatste|voorbije) {n} {unit}",
      "de (afgelopen|laatste) {n} {unit}",
      "(het afgelopen|het laatste|afgelopen|laatste) {unit}",
    ],
    ago: ["{n} {unit} geleden"],
    since: ["(sinds|vanaf|sedert) {start}"],
  },
  rangeJoin: ["tot", "tot en met", "t/m"],
  rangeTemplates: ["van {start} (tot|tot en met|t/m) {end}", "tussen {start} en {end}"],
  pointAffixes: ["op {date}"],
  clockAffixes: ["{clock} uur", "om {clock}", "om {clock} uur"],
  words: {
    today: ["vandaag"],
    yesterday: ["gisteren", "gister"],
    dayBeforeYesterday: ["eergisteren"],
    tomorrow: ["morgen"],
    thisWeek: ["deze week"],
    lastWeek: ["vorige week", "afgelopen week"],
    thisMonth: ["deze maand"],
    lastMonth: ["vorige maand", "afgelopen maand"],
    thisYear: ["dit jaar"],
    lastYear: ["vorig jaar"],
    now: ["nu"],
  },
  dayParts: {
    "'s ochtends": [0, 12],
    "'s middags": [12, 18],
    "'s avonds": [17, 24],
    "'s nachts": [0, 6],
  },
  articles: ["een"],
  hooks: { marked: (typed, folded) => typed.toLowerCase() !== folded },
  numberWords: {
    een: 1,
    één: 1,
    twee: 2,
    drie: 3,
    vier: 4,
    vijf: 5,
    zes: 6,
    zeven: 7,
    acht: 8,
    negen: 9,
    tien: 10,
    elf: 11,
    twaalf: 12,
  },
  nameTemplates: { lastN: "Afgelopen {duration}" },
  examples: ["afgelopen 15 minuten", "gisteren", "2 uur geleden"],
};
