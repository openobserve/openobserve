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

export { default as tables } from "./generated/vi";

export const pack: LocalePack = {
  key: "vi",
  bcp47: "vi-VN",
  script: "latin",
  hooks: { orClock, fold: (ch) => (ch === "đ" ? "d" : ch) },
  dateOrder: "dmy",
  slashAmbiguous: true,
  units: {
    s: ["s", "giây"],
    m: ["p", "ph", "phút"],
    h: ["h", "g", "giờ", "tiếng"],
    d: ["ngày"],
    w: ["tuần"],
    M: ["tháng"],
    y: ["năm"],
  },
  patterns: {
    lastN: ["{n} {unit} (qua|vừa qua|gần đây|gần nhất)", "trong {n} {unit} (qua|gần đây)"],
    ago: ["{n} {unit} trước", "cách đây {n} {unit}"],
    since: ["(từ|kể từ) {start}"],
  },
  rangeJoin: ["đến", "tới"],
  rangeTemplates: ["(từ|kể từ) {start} (đến|tới) {end}"],
  pointAffixes: ["ngày {date}"],
  clockAffixes: [
    "{h}h",
    "{h}h{mi}",
    "{h} giờ",
    "{h} giờ {mi}",
    "{h}g{mi}",
    "lúc {clock}",
    "lúc {h} giờ",
    "lúc {h}h",
  ],
  datePatterns: ["{d} tháng {m} năm {y}", "{d} tháng {m}"],
  words: {
    today: ["hôm nay", "bữa nay"],
    yesterday: ["hôm qua"],
    dayBeforeYesterday: ["hôm kia"],
    tomorrow: ["ngày mai"],
    thisWeek: ["tuần này"],
    lastWeek: ["tuần trước", "tuần rồi"],
    thisMonth: ["tháng này"],
    lastMonth: ["tháng trước", "tháng rồi"],
    thisYear: ["năm nay"],
    lastYear: ["năm ngoái"],
    now: ["bây giờ", "hiện tại"],
  },
  dayParts: { sáng: [0, 12], chiều: [12, 19], tối: [17, 24] },
  nameTemplates: { lastN: "{duration} qua" },
  examples: ["15 phút qua", "hôm qua", "2 giờ trước"],
};
