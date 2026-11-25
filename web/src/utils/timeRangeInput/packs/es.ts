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

export { default as tables } from "./generated/es";

export const pack: LocalePack = {
  key: "es",
  bcp47: "es-ES",
  script: "latin",
  hooks: { orClock },
  units: {
    s: ["s", "seg", "segs", "segundo", "segundos"],
    m: ["m", "min", "mins", "minuto", "minutos"],
    h: ["h", "hr", "hrs", "hora", "horas"],
    d: ["d", "día", "días"],
    w: ["sem", "semana", "semanas"],
    M: ["mes", "meses"],
    y: ["año", "años"],
  },
  patterns: {
    lastN: [
      "(últimos|últimas) {n} {unit}",
      "(los últimos|las últimas) {n} {unit}",
      "en (los últimos|las últimas) {n} {unit}",
      "(la última|el último|última|último) {unit}",
    ],
    ago: ["hace {n} {unit}"],
    since: [
      "desde {start}",
      "desde (el|la|las) {start}",
      "a partir (de|del) {start}",
      "a partir de las {start}",
    ],
  },
  rangeJoin: ["a", "al", "hasta"],
  rangeTemplates: [
    "de {start} a {end}",
    "de las {start} a las {end}",
    "del {start} al {end}",
    "desde {start} hasta {end}",
    "desde el {start} hasta el {end}",
    "entre {start} y {end}",
  ],
  pointAffixes: ["el {date}"],
  clockAffixes: ["(la|las|a las|a la) {clock}", "{h}h", "{h}h{mi}", "{clock} horas"],
  words: {
    today: ["hoy"],
    yesterday: ["ayer"],
    dayBeforeYesterday: ["anteayer", "antier"],
    tomorrow: ["mañana"],
    thisWeek: ["esta semana"],
    lastWeek: ["la semana pasada", "semana pasada", "la última semana"],
    thisMonth: ["este mes"],
    lastMonth: ["el mes pasado", "mes pasado", "el último mes"],
    thisYear: ["este año"],
    lastYear: ["el año pasado"],
    now: ["ahora"],
  },
  dayParts: { "de la mañana": [0, 12], "de la tarde": [12, 21], "de la noche": [18, 24] },
  numberWords: {
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  },
  nameTemplates: { lastN: "Últimos {duration}" },
  examples: ["últimos 15 minutos", "ayer", "hace 2 horas"],
};
