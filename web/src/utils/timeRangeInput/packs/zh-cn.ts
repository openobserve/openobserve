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

export { default as tables } from "./generated/zh-cn";

export const pack: LocalePack = {
  key: "zh-cn",
  bcp47: "zh-CN",
  script: "other",
  spaceless: true,
  dateOrder: "mdy",
  hooks: { numeral: cjkNumeral, ime: imePrefix(ZH_IME_PREFIXES) },
  units: {
    s: ["秒", "秒钟"],
    m: ["分钟", "分"],
    h: ["小时", "个小时", "钟头", "个钟头"],
    d: ["天", "日"],
    w: ["周", "星期", "个星期", "礼拜", "个礼拜"],
    M: ["个月", "月"],
    y: ["年"],
  },
  patterns: {
    lastN: [
      "(过去|最近|近|过去的){n}{unit}",
      "{n}{unit}内",
      "{n}{unit}以内",
      "(过去|最近)(一个|){unit}",
    ],
    ago: ["{n}{unit}(前|之前|以前)"],
    since: ["(自|从){start}(起|开始|以来)", "{start}(以来|起|至今)"],
    weekdayOfWeek: {
      "(本|这){weekday}": 0,
      "(这个|本){weekday}": 0,
      "上{weekday}": -1,
      "上个{weekday}": -1,
    },
  },
  rangeJoin: ["到", "至"],
  rangeTemplates: ["(从|自){start}(到|至){end}"],
  pointAffixes: [],
  clockAffixes: ["{h}(点|时|点钟)", "{h}点{mi}(分|)"],
  words: {
    today: ["今天", "今日"],
    yesterday: ["昨天", "昨日"],
    dayBeforeYesterday: ["前天"],
    tomorrow: ["明天", "明日"],
    thisWeek: ["本周", "这周", "这个星期", "这星期", "本星期"],
    lastWeek: ["上周", "上个星期", "上星期", "上礼拜", "上个礼拜"],
    thisMonth: ["本月", "这个月"],
    lastMonth: ["上个月", "上月"],
    thisYear: ["今年"],
    lastYear: ["去年"],
    now: ["现在", "此刻", "目前"],
  },
  weekdays: [
    ["礼拜天", "礼拜日", "星期天"],
    ["礼拜一"],
    ["礼拜二"],
    ["礼拜三"],
    ["礼拜四"],
    ["礼拜五"],
    ["礼拜六"],
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
  examples: ["最近15分钟", "昨天", "2小时前"],
};
