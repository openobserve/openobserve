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
import { orClock } from "./shared/clock";

export { default as tables } from "./generated/fr";

export const pack: LocalePack = {
  key: "fr",
  bcp47: "fr-FR",
  script: "latin",
  hooks: { orClock },
  units: {
    s: ["s", "sec", "seconde", "secondes"],
    m: ["m", "min", "mn", "minute", "minutes"],
    h: ["h", "hr", "heure", "heures"],
    d: ["j", "jour", "jours"],
    w: ["sem", "semaine", "semaines"],
    M: ["mois"],
    y: ["an", "ans", "année", "années"],
  },
  patterns: {
    lastN: [
      "(les|ces) {n} (dernières|derniers) {unit}",
      "{n} (dernières|derniers) {unit}",
      "(les dernières|les derniers|dernières|derniers) {n} {unit}",
      "pendant {n} {unit}",
      "(la dernière|le dernier|dernière|dernier) {unit}",
    ],
    ago: ["il y a {n} {unit}"],
    since: ["depuis {start}", "depuis (le|la) {start}", "à partir (de|du) {start}", "dès {start}"],
  },
  rangeJoin: ["à", "au", "jusqu'à"],
  rangeTemplates: [
    "de {start} à {end}",
    "du {start} au {end}",
    "entre {start} et {end}",
    "depuis {start} jusqu'à {end}",
  ],
  pointAffixes: ["le {date}"],
  clockAffixes: [
    "{h}h",
    "{h}h{mi}",
    "{clock} (heures|heure)",
    "à {clock}",
    "à {clock} (heures|heure)",
  ],
  words: {
    today: ["aujourd'hui", "aujourdhui", "auj"],
    yesterday: ["hier"],
    dayBeforeYesterday: ["avant-hier", "avant hier"],
    tomorrow: ["demain"],
    thisWeek: ["cette semaine"],
    lastWeek: ["la semaine dernière", "semaine dernière", "la semaine passée"],
    thisMonth: ["ce mois-ci", "ce mois ci", "ce mois"],
    lastMonth: ["le mois dernier", "mois dernier", "le mois passé"],
    thisYear: ["cette année"],
    lastYear: ["l'année dernière"],
    now: ["maintenant"],
  },
  dayParts: { "du matin": [0, 12], "de l'après-midi": [12, 19], "du soir": [17, 24] },
  numberWords: {
    un: 1,
    une: 1,
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    neuf: 9,
    dix: 10,
    onze: 11,
    douze: 12,
  },
  nameTemplates: { lastN: "Dernières {duration}" },
  examples: ["15 dernières minutes", "hier", "il y a 2 heures"],
};
