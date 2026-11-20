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

export { default as tables } from "./generated/pt";

export const pack: LocalePack = {
  key: "pt",
  bcp47: "pt-PT",
  script: "latin",
  hooks: { orClock },
  units: {
    s: ["s", "seg", "segundo", "segundos"],
    m: ["m", "min", "mins", "minuto", "minutos"],
    h: ["h", "hora", "horas"],
    d: ["d", "dia", "dias"],
    w: ["sem", "semana", "semanas"],
    M: ["mês", "meses"],
    y: ["ano", "anos"],
  },
  patterns: {
    lastN: [
      "(últimos|últimas) {n} {unit}",
      "(os últimos|as últimas|nos últimos|nas últimas) {n} {unit}",
      "(a última|o último|última|último) {unit}",
    ],
    ago: ["há {n} {unit}", "{n} {unit} atrás"],
    since: ["desde {start}", "desde (as|a|o) {start}", "a partir (de|do|da|das) {start}"],
  },
  rangeJoin: ["a", "até"],
  rangeTemplates: [
    "das {start} às {end}",
    "das {start} até às {end}",
    "de {start} a {end}",
    "do {start} ao {end}",
    "desde {start} até {end}",
    "entre {start} e {end}",
  ],
  pointAffixes: ["(a|em|dia) {date}"],
  clockAffixes: ["{h}h", "{h}h{mi}", "(às|as) {clock}", "{clock} horas"],
  words: {
    today: ["hoje"],
    yesterday: ["ontem"],
    dayBeforeYesterday: ["anteontem"],
    tomorrow: ["amanhã"],
    thisWeek: ["esta semana", "nesta semana"],
    lastWeek: ["semana passada", "a semana passada", "na semana passada", "última semana"],
    thisMonth: ["este mês", "neste mês"],
    lastMonth: ["mês passado", "o mês passado", "no mês passado", "último mês"],
    thisYear: ["este ano"],
    lastYear: ["ano passado", "o ano passado"],
    now: ["agora"],
  },
  dayParts: { "da manhã": [0, 12], "da tarde": [12, 20], "da noite": [18, 24] },
  numberWords: {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    três: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
  },
  nameTemplates: { lastN: "Últimos {duration}" },
  examples: ["últimos 15 minutos", "ontem", "há 2 horas"],
};
