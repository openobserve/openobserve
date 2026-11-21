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

export { default as tables } from "./generated/ko";

export const pack: LocalePack = {
  key: "ko",
  bcp47: "ko-KR",
  script: "other",
  spaceless: true,
  dateOrder: "mdy",
  units: {
    s: ["초"],
    m: ["분"],
    h: ["시간"],
    d: ["일"],
    w: ["주", "주일"],
    M: ["개월", "달"],
    y: ["년"],
  },
  countedUnits: { 하루: ["d", 1], 이틀: ["d", 2], 사흘: ["d", 3] },
  patterns: {
    lastN: [
      "(최근|지난) {n}{unit}",
      "{n}{unit} 동안",
      "(최근|지난) {n}{unit} 동안",
      "(최근|지난) {unit}",
    ],
    ago: ["{n}{unit} 전", "{unit} 전"],
    since: ["{start}(부터|이후)", "{start}부터 지금까지"],
  },
  rangeJoin: [],
  rangeTemplates: ["{start}부터 {end}까지", "{start}에서 {end}까지"],
  pointAffixes: [],
  clockAffixes: ["{h}시", "{h}시 {mi}분"],
  datePatterns: ["{y}. {m}. {d}.", "{y}.{m}.{d}"],
  words: {
    today: ["오늘"],
    yesterday: ["어제", "어저께"],
    dayBeforeYesterday: ["그저께", "그제", "엊그제"],
    tomorrow: ["내일"],
    thisWeek: ["이번 주", "금주"],
    lastWeek: ["지난주", "지난 주", "저번 주", "저번주"],
    thisMonth: ["이번 달"],
    lastMonth: ["지난달", "지난 달", "저번 달"],
    thisYear: ["올해"],
    lastYear: ["작년"],
    now: ["지금", "현재"],
  },
  weekdays: [["일욜"], ["월욜"], ["화욜"], ["수욜"], ["목욜"], ["금욜"], ["토욜"]],
  dayParts: { 아침: [5, 12], 낮: [11, 17], 저녁: [17, 24], 밤: [18, 24], 새벽: [0, 6] },
  numberWords: {
    한: 1,
    두: 2,
    세: 3,
    네: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
    열한: 11,
    열두: 12,
  },
  nameTemplates: { lastN: "최근 {duration}" },
  examples: ["최근 15분", "어제", "2시간 전"],
};
