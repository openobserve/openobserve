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

export { default as tables } from "./generated/it";

export const pack: LocalePack = {
  key: "it",
  bcp47: "it-IT",
  script: "latin",
  units: {
    s: ["s", "sec", "secondo", "secondi"],
    m: ["m", "min", "minuto", "minuti"],
    h: ["h", "ora", "ore"],
    d: ["g", "gg", "giorno", "giorni"],
    w: ["sett", "settimana", "settimane"],
    M: ["mese", "mesi"],
    y: ["anno", "anni"],
  },
  patterns: {
    lastN: [
      "(ultimi|ultime) {n} {unit}",
      "(gli ultimi|le ultime|negli ultimi|nelle ultime) {n} {unit}",
      "(l'ultima|l'ultimo|ultima|ultimo) {unit}",
    ],
    ago: ["{n} {unit} fa"],
    since: ["(da|dal|dalle|dalla|dall'|dallo) {start}", "a partire (da|dal|dalle) {start}"],
  },
  rangeJoin: ["a", "al", "alle", "fino a", "fino al", "fino alle"],
  rangeTemplates: [
    "dalle {start} alle {end}",
    "dal {start} al {end}",
    "da {start} a {end}",
    "(tra|fra) {start} e {end}",
  ],
  pointAffixes: ["il {date}"],
  clockAffixes: ["le {clock}", "alle {clock}"],
  words: {
    today: ["oggi"],
    yesterday: ["ieri"],
    dayBeforeYesterday: ["l'altro ieri", "l'altroieri", "altroieri"],
    tomorrow: ["domani"],
    thisWeek: ["questa settimana"],
    lastWeek: ["la settimana scorsa", "settimana scorsa", "la scorsa settimana"],
    thisMonth: ["questo mese"],
    lastMonth: ["il mese scorso", "mese scorso", "lo scorso mese"],
    thisYear: ["quest'anno"],
    lastYear: ["l'anno scorso"],
    now: ["adesso"],
  },
  dayParts: { "di mattina": [0, 12], "del pomeriggio": [12, 19], "di sera": [17, 24] },
  numberWords: {
    un: 1,
    "un'": 1,
    uno: 1,
    una: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10,
    undici: 11,
    dodici: 12,
  },
  nameTemplates: { lastN: "Ultimi {duration}" },
  examples: ["ultimi 15 minuti", "ieri", "2 ore fa"],
};
