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

export { default as tables } from "./generated/en-us";

export const pack: LocalePack = {
  key: "en-us",
  bcp47: "en-US",
  script: "latin",
  dateOrder: "mdy",
  slashAmbiguous: true,
  units: {
    s: ["s", "sec", "secs", "second", "seconds"],
    m: ["m", "min", "mins", "minute", "minutes"],
    h: ["h", "hr", "hrs", "hour", "hours"],
    d: ["d", "day", "days"],
    w: ["w", "wk", "wks", "week", "weeks"],
    M: ["mo", "mos", "month", "months"],
    y: ["y", "yr", "yrs", "year", "years"],
  },
  patterns: {
    lastN: [
      "(last|past|previous|prev) {n} {unit}",
      "the (last|past|previous) {n} {unit}",
      "(last|past|the last|the past) {unit}",
    ],
    ago: ["{n} {unit} ago"],
    since: ["(since|from|starting|starting from) {start}"],
  },
  rangeJoin: ["until", "till", "through", "thru"],
  rangeTemplates: ["from {start} (to|until|till) {end}", "between {start} and {end}"],
  pointAffixes: ["on {date}", "on the {date}"],
  datePatterns: [
    "{d} {month} {y}",
    "{month} {d} {y}",
    "{d} {month}",
    "{month} {d}th",
    "{d}th {month}",
  ],
  clockAffixes: ["at {clock}", "{clock} o'clock"],
  words: {
    today: ["today", "tdy"],
    yesterday: ["yesterday", "yday", "yest", "ystd"],
    dayBeforeYesterday: ["day before yesterday"],
    tomorrow: ["tomorrow", "tmrw", "tmr", "tomorow"],
    thisWeek: ["this week", "this wk"],
    lastWeek: ["last week", "previous week", "prev week", "last wk", "prev wk"],
    thisMonth: ["this month"],
    lastMonth: ["last month", "last mo", "previous month", "prev month"],
    thisYear: ["this year"],
    lastYear: ["last year"],
  },
  meridiem: { am: ["am", "a.m."], pm: ["pm", "p.m."] },
  dayParts: {
    "in the morning": [0, 12],
    "in the afternoon": [12, 18],
    "in the evening": [17, 24],
    tonight: [17, 24],
  },
  numberWords: {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  },
  articles: ["a", "an"],
  nameTemplates: { lastN: "Last {duration}" },
  examples: ["last 15 minutes", "yesterday", "2 hours ago"],
};
