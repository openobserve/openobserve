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

export { default as tables } from "./generated/de";

export const pack: LocalePack = {
  key: "de",
  bcp47: "de-DE",
  script: "latin",
  units: {
    s: ["s", "sek", "sekunde", "sekunden"],
    m: ["m", "min", "minute", "minuten"],
    h: ["h", "std", "stunde", "stunden"],
    d: ["d", "t", "tag", "tage", "tagen"],
    w: ["w", "wo", "woche", "wochen"],
    M: ["mon", "monat", "monate", "monaten"],
    y: ["j", "jahr", "jahre", "jahren"],
  },
  patterns: {
    lastN: [
      "(letzte|letzten|vergangene|vergangenen) {n} {unit}",
      "die (letzten|vergangenen) {n} {unit}",
      "seit {n} {unit}",
      "(letzte|letzten|die letzte|vergangene) {unit}",
    ],
    ago: ["vor {n} {unit}"],
    since: ["(seit|ab) {start}", "(seit|ab) (dem|der) {start}"],
  },
  rangeJoin: ["bis"],
  rangeTemplates: [
    "von {start} bis {end}",
    "vom {start} bis (zum|zur) {end}",
    "vom {start} bis {end}",
    "zwischen {start} und {end}",
  ],
  pointAffixes: ["(am|den) {date}"],
  clockAffixes: ["{clock} uhr", "um {clock}", "um {clock} uhr"],
  words: {
    today: ["heute", "heut"],
    yesterday: ["gestern"],
    dayBeforeYesterday: ["vorgestern"],
    tomorrow: ["morgen"],
    thisWeek: ["diese woche", "dieser woche"],
    lastWeek: ["letzte woche", "vorige woche", "vergangene woche"],
    thisMonth: ["dieser monat", "diesen monat", "diesem monat"],
    lastMonth: [
      "letzter monat",
      "letzten monat",
      "voriger monat",
      "vorigen monat",
      "vergangenen monat",
    ],
    thisYear: ["dieses jahr"],
    lastYear: ["letztes jahr"],
    now: ["jetzt"],
  },
  dayParts: {
    morgens: [0, 12],
    vormittags: [0, 12],
    nachmittags: [12, 19],
    abends: [17, 24],
    nachts: [0, 6],
  },
  articles: ["ein", "eine", "einem", "einer", "einen"],
  numberWords: {
    ein: 1,
    eine: 1,
    einem: 1,
    einer: 1,
    einen: 1,
    eins: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
    elf: 11,
    zwölf: 12,
  },
  nameTemplates: { lastN: "Letzte {duration}" },
  examples: ["letzte 15 Minuten", "gestern", "vor 2 Stunden"],
};
