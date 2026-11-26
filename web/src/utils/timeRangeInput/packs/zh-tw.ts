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
import { cjkNumeral, imePrefix, ZH_IME_PREFIXES } from "./shared/cjk";

export { default as tables } from "./generated/zh-tw";

export const pack: LocalePack = {
  key: "zh-tw",
  bcp47: "zh-TW",
  script: "other",
  spaceless: true,
  dateOrder: "mdy",
  hooks: {
    numeral: cjkNumeral,
    ime: imePrefix(ZH_IME_PREFIXES),
    year: (y, slot) => (slot === "ry" ? y + 1911 : undefined),
  },
  units: {
    s: ["秒", "秒鐘"],
    m: ["分鐘", "分"],
    h: ["小時", "個小時", "鐘頭", "個鐘頭"],
    d: ["天", "日"],
    w: ["週", "周", "星期", "個星期", "禮拜", "個禮拜"],
    // `5月` is May, never five months.
    M: ["個月"],
    y: ["年"],
  },
  patterns: {
    lastN: [
      "(過去|最近|近|過去的){n}{unit}",
      "{n}{unit}內",
      "{n}{unit}以內",
      "(過去|最近)(一個|){unit}",
    ],
    ago: ["{n}{unit}(前|之前|以前)"],
    since: ["(自|從){start}(起|開始|以來)", "{start}(以來|起|至今)"],
    weekdayOfWeek: {
      "(本|這){weekday}": 0,
      "(這個|本){weekday}": 0,
      "上{weekday}": -1,
      "上個{weekday}": -1,
    },
  },
  rangeJoin: ["到", "至"],
  rangeTemplates: ["(從|自){start}(到|至){end}"],
  pointAffixes: [],
  clockAffixes: ["{h}(點|時|點鐘)", "{h}點{mi}(分|)"],
  words: {
    today: ["今天", "今日"],
    yesterday: ["昨天", "昨日"],
    dayBeforeYesterday: ["前天"],
    tomorrow: ["明天", "明日"],
    thisWeek: ["本週", "這週", "這禮拜", "這個禮拜", "這星期", "這個星期", "本星期"],
    lastWeek: ["上週", "上禮拜", "上個禮拜", "上星期", "上個星期"],
    thisMonth: ["本月", "這個月"],
    lastMonth: ["上個月", "上月"],
    thisYear: ["今年"],
    lastYear: ["去年"],
    now: ["現在", "此刻", "目前"],
  },
  weekdays: [
    ["禮拜天", "禮拜日", "星期天"],
    ["禮拜一"],
    ["禮拜二"],
    ["禮拜三"],
    ["禮拜四"],
    ["禮拜五"],
    ["禮拜六"],
  ],
  dayParts: {
    早上: [5, 12],
    早晨: [5, 12],
    上午: [0, 12],
    中午: [11, 14],
    下午: [12, 19],
    傍晚: [16, 20],
    晚上: [17, 24],
    今晚: [17, 24, 0],
    昨晚: [17, 24, -1],
    凌晨: [0, 6],
  },
  nameTemplates: { lastN: "最近{duration}" },
  examples: ["最近15分鐘", "昨天", "2小時前"],
};
