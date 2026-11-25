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
import { cjkNumeral, imePrefix } from "./shared/cjk";

export { default as tables } from "./generated/ja";

const IME_PREFIXES = ["kyou", "kinou", "senshuu", "sengetsu", "kako", "saikin"];

export const pack: LocalePack = {
  key: "ja",
  bcp47: "ja-JP",
  script: "other",
  spaceless: true,
  dateOrder: "mdy",
  hooks: { numeral: cjkNumeral, ime: imePrefix(IME_PREFIXES) },
  units: {
    s: ["秒", "秒間"],
    m: ["分", "分間"],
    h: ["時間"],
    d: ["日", "日間"],
    w: ["週", "週間"],
    M: ["か月", "ヶ月", "ヵ月", "カ月", "ケ月", "か月間", "ヶ月間"],
    y: ["年", "年間"],
  },
  patterns: {
    lastN: ["(過去|直近|ここ|最近|最新の){n}{unit}", "{n}{unit}以内", "(過去|直近|ここ){unit}"],
    ago: ["{n}{unit}前"],
    since: ["{start}(から|以降|より)"],
  },
  rangeJoin: [],
  rangeTemplates: ["{start}から{end}まで", "{start}から{end}", "{start}より{end}まで"],
  pointAffixes: [],
  clockAffixes: ["{h}時", "{h}時{mi}分"],
  words: {
    today: ["今日", "きょう", "本日"],
    yesterday: ["昨日", "きのう"],
    dayBeforeYesterday: ["一昨日", "おととい"],
    tomorrow: ["明日", "あした", "あす"],
    thisWeek: ["今週"],
    lastWeek: ["先週"],
    thisMonth: ["今月"],
    lastMonth: ["先月"],
    thisYear: ["今年"],
    lastYear: ["去年", "昨年"],
    now: ["今", "現在"],
  },
  weekdays: [["日曜"], ["月曜"], ["火曜"], ["水曜"], ["木曜"], ["金曜"], ["土曜"]],
  dayParts: { 朝: [5, 12], 昼: [11, 15], 夕方: [15, 19], 夜: [17, 24], 深夜: [0, 5] },
  nameTemplates: { lastN: "過去{duration}" },
  examples: ["過去15分", "昨日", "2時間前"],
};
