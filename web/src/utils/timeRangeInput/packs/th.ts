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

export { default as tables } from "./generated/th";

const ERA = 543;

// A four-digit year from 2400 is Buddhist era; a two-digit one sits in [Y-80, Y+19] of that era.
function buddhistYear(y: number, slot: "y" | "yy" | "ry", nowY: number): number | undefined {
  if (slot === "y") return y >= 2400 ? y - ERA : y;
  const low = nowY + ERA - 80;
  return slot === "yy" ? low + ((((y - low) % 100) + 100) % 100) - ERA : undefined;
}

export const pack: LocalePack = {
  key: "th",
  bcp47: "th-TH",
  script: "other",
  spaceless: true,
  hooks: { year: buddhistYear },
  units: {
    s: ["วินาที", "วิ"],
    m: ["นาที"],
    h: ["ชั่วโมง", "ชม.", "ชม"],
    d: ["วัน"],
    w: ["สัปดาห์", "อาทิตย์", "วีค"],
    M: ["เดือน"],
    y: ["ปี"],
  },
  patterns: {
    lastN: [
      "ย้อนหลัง {n} {unit}",
      "{n} {unit}(ที่ผ่านมา|ล่าสุด)",
      "(ล่าสุด|ใน) {n} {unit}",
      "ใน {n} {unit}ที่ผ่านมา",
    ],
    ago: ["{n} {unit}(ที่แล้ว|ก่อน)"],
    since: ["ตั้งแต่ {start}", "ตั้งแต่ {start}เป็นต้นมา"],
  },
  rangeJoin: ["ถึง", "จนถึง"],
  rangeTemplates: ["(ตั้งแต่|จาก) {start} (ถึง|จนถึง) {end}"],
  pointAffixes: ["วันที่ {date}"],
  clockAffixes: ["{h}โมง", "{h} นาฬิกา", "{clock} น."],
  words: {
    today: ["วันนี้"],
    yesterday: ["เมื่อวาน", "เมื่อวานนี้"],
    dayBeforeYesterday: ["เมื่อวานซืน"],
    tomorrow: ["พรุ่งนี้"],
    thisWeek: ["สัปดาห์นี้", "อาทิตย์นี้", "วีคนี้"],
    lastWeek: ["สัปดาห์ที่แล้ว", "อาทิตย์ที่แล้ว", "สัปดาห์ก่อน", "อาทิตย์ก่อน", "วีคที่แล้ว"],
    thisMonth: ["เดือนนี้"],
    lastMonth: ["เดือนที่แล้ว", "เดือนก่อน"],
    thisYear: ["ปีนี้"],
    lastYear: ["ปีที่แล้ว", "ปีก่อน"],
    now: ["ตอนนี้", "ขณะนี้"],
  },
  dayParts: { เช้า: [5, 12], บ่าย: [12, 18], เย็น: [16, 20], ค่ำ: [18, 24] },
  numberWords: {
    หนึ่ง: 1,
    สอง: 2,
    สาม: 3,
    สี่: 4,
    ห้า: 5,
    หก: 6,
    เจ็ด: 7,
    แปด: 8,
    เก้า: 9,
    สิบ: 10,
    สิบเอ็ด: 11,
    สิบสอง: 12,
  },
  nameTemplates: { lastN: "ย้อนหลัง {duration}" },
  examples: ["ย้อนหลัง 15 นาที", "เมื่อวาน", "2 ชั่วโมงที่แล้ว"],
};
