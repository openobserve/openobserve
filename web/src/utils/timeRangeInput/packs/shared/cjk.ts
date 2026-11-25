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

const CJK_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Whether the fold starts a romanised word an IME is still composing; ja, zh-cn and zh-tw share it. */
export function imePrefix(prefixes: string[]): (fold: string) => boolean {
  return (fold) => prefixes.some((p) => p.startsWith(fold));
}

/** CJK numerals up to 99 (`二十三`, `十五`, `三〇`); ja, zh-cn and zh-tw share it. A second `十` is malformed. */
export function cjkNumeral(fold: string, pos: number): [number, number] | null {
  let i = pos;
  while (i < fold.length && (CJK_DIGITS[fold[i]] !== undefined || fold[i] === "十")) i++;
  if (i === pos) return null;
  const run = fold.slice(pos, i);
  let value = 0;
  if (run.includes("十")) {
    const [tens, ones, extra] = run.split("十");
    if (extra !== undefined || tens.length > 1 || ones.length > 1) return null;
    value = (tens ? CJK_DIGITS[tens] : 1) * 10 + (ones ? CJK_DIGITS[ones] : 0);
  } else {
    for (const ch of run) value = value * 10 + CJK_DIGITS[ch];
  }
  return [i, value];
}

export const ZH_IME_PREFIXES = [
  "zuotian",
  "jintian",
  "qiantian",
  "zuijin",
  "guoqu",
  "shangzhou",
  "benzhou",
  "xianzai",
  "mingtian",
];
