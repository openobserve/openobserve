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

export { default as tables } from "./generated/ru";

export const pack: LocalePack = {
  key: "ru",
  bcp47: "ru-RU",
  script: "other",
  units: {
    s: ["с", "сек", "секунда", "секунды", "секунд", "секунду"],
    m: ["м", "мин", "минута", "минуты", "минут", "минуту"],
    h: ["ч", "час", "часа", "часов"],
    d: ["д", "дн", "день", "дня", "дней", "сутки", "суток"],
    w: ["нед", "неделя", "недели", "недель", "неделю"],
    M: ["мес", "месяц", "месяца", "месяцев"],
    y: ["г", "год", "года", "лет"],
  },
  patterns: {
    lastN: [
      "(за последние|последние|за последний|последний|за последнюю|последнюю) {n} {unit}",
      "(за посл.|посл.) {n} {unit}",
      "(за последние|последние|за последний|последний|за последнюю|последнюю) {unit}",
    ],
    ago: ["{n} {unit} назад", "{unit} назад"],
    since: ["(с|со|начиная с) {start}"],
  },
  rangeJoin: ["до", "по"],
  rangeTemplates: ["(с|со) {start} (до|по) {end}", "от {start} до {end}", "между {start} и {end}"],
  pointAffixes: ["{date} (года|г.|г)", "(в|во) {date}"],
  clockAffixes: ["в {clock}", "{clock} (ч|часов|часа|час)"],
  datePatterns: ["{d} {month} {y}"],
  words: {
    today: ["сегодня"],
    yesterday: ["вчера", "вчерашнего дня"],
    dayBeforeYesterday: ["позавчера"],
    tomorrow: ["завтра"],
    thisWeek: ["текущая неделя", "эта неделя", "эту неделю", "на этой неделе"],
    lastWeek: ["прошлая неделя", "предыдущая неделя", "прошлую неделю", "на прошлой неделе"],
    thisMonth: ["текущий месяц", "этот месяц", "в этом месяце"],
    lastMonth: ["прошлый месяц", "предыдущий месяц", "в прошлом месяце"],
    thisYear: ["этот год", "в этом году"],
    lastYear: ["прошлый год", "в прошлом году"],
    now: ["сейчас"],
  },
  weekdays: [
    ["воскресенье"],
    ["понедельник"],
    ["вторник"],
    ["среду"],
    ["четверг"],
    ["пятницу"],
    ["субботу"],
  ],
  dayParts: { утра: [0, 12], дня: [12, 18], вечера: [17, 24], ночи: [0, 5] },
  numberWords: {
    один: 1,
    одна: 1,
    одну: 1,
    два: 2,
    две: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
    одиннадцать: 11,
    двенадцать: 12,
  },
  nameTemplates: { lastN: "Последние {duration}" },
  examples: ["последние 15 минут", "вчера", "2 часа назад"],
};
