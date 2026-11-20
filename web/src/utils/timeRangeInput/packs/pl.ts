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

export { default as tables } from "./generated/pl";

export const pack: LocalePack = {
  key: "pl",
  bcp47: "pl-PL",
  script: "latin",
  hooks: { fold: (ch) => (ch === "ł" ? "l" : ch) },
  units: {
    s: ["s", "sek", "sekunda", "sekundy", "sekund", "sekundę"],
    m: ["m", "min", "minuta", "minuty", "minut", "minutę"],
    h: ["h", "godz", "godz.", "godzina", "godziny", "godzin", "godzinę"],
    d: ["d", "dzień", "dni", "dnia"],
    w: ["tyg", "tydzień", "tygodnie", "tygodni"],
    M: ["mies", "miesiąc", "miesiące", "miesięcy"],
    y: ["rok", "lata", "lat"],
  },
  patterns: {
    lastN: [
      "(ostatnie|ostatnich|ostatni|ostatnia) {n} {unit}",
      "(przez|z) ostatnie {n} {unit}",
      "w ciągu ostatnich {n} {unit}",
      "(ostatnia|ostatni|ostatnie|ostatnią) {unit}",
    ],
    ago: ["{n} {unit} temu", "{unit} temu"],
    since: ["(od|począwszy od) {start}", "od godziny {start}"],
  },
  rangeJoin: ["do"],
  rangeTemplates: ["od {start} do {end}", "(między|pomiędzy) {start} a {end}"],
  pointAffixes: ["{date} (r.|roku)"],
  clockAffixes: ["o {clock}", "o godzinie {clock}", "godz. {clock}"],
  words: {
    today: ["dziś", "dzisiaj"],
    yesterday: ["wczoraj"],
    dayBeforeYesterday: ["przedwczoraj"],
    tomorrow: ["jutro"],
    thisWeek: ["bieżący tydzień", "ten tydzień", "w tym tygodniu", "obecny tydzień"],
    lastWeek: [
      "poprzedni tydzień",
      "zeszły tydzień",
      "ostatni tydzień",
      "w zeszłym tygodniu",
      "w poprzednim tygodniu",
    ],
    thisMonth: ["bieżący miesiąc", "ten miesiąc", "w tym miesiącu", "obecny miesiąc"],
    lastMonth: ["poprzedni miesiąc", "zeszły miesiąc", "ostatni miesiąc", "w zeszłym miesiącu"],
    thisYear: ["ten rok", "w tym roku"],
    lastYear: ["zeszły rok", "w zeszłym roku"],
    now: ["teraz"],
  },
  dayParts: { rano: [0, 12], "po południu": [12, 19], wieczorem: [17, 24], "w nocy": [0, 6] },
  numberWords: {
    jeden: 1,
    jedna: 1,
    jedną: 1,
    dwa: 2,
    dwie: 2,
    trzy: 3,
    cztery: 4,
    pięć: 5,
    sześć: 6,
    siedem: 7,
    osiem: 8,
    dziewięć: 9,
    dziesięć: 10,
    jedenaście: 11,
    dwanaście: 12,
    pierwszej: 1,
    drugiej: 2,
    trzeciej: 3,
    czwartej: 4,
    piątej: 5,
    szóstej: 6,
    siódmej: 7,
    ósmej: 8,
    dziewiątej: 9,
    dziesiątej: 10,
    jedenastej: 11,
    dwunastej: 12,
  },
  nameTemplates: { lastN: "Ostatnie {duration}" },
  examples: ["ostatnie 15 minut", "wczoraj", "2 godziny temu"],
};
