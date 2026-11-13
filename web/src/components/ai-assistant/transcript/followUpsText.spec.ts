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

import { describe, expect, it } from "vitest";

import { splitFollowUps } from "./followUpsText";

const BODY = "Upstream B causes the spikes.";

describe("splitFollowUps", () => {
  it("strips the plain, colon and fenced variants", () => {
    for (const tail of [
      'follow_ups ["a", "b"]',
      'follow_ups: ["a", "b"]',
      '```json\nfollow_ups: ["a", "b"]\n```',
    ])
      expect(splitFollowUps(`${BODY}\n\n${tail}  \n`)).toEqual({ text: BODY, items: ["a", "b"] });
  });

  it("works when the whole text is the follow-ups", () => {
    expect(splitFollowUps('follow_ups ["a"]')).toEqual({ text: "", items: ["a"] });
  });

  it("leaves malformed JSON, non-strings and non-final position untouched", () => {
    for (const text of [
      `${BODY}\nfollow_ups ["a", `,
      `${BODY}\nfollow_ups [1, 2]`,
      `${BODY}\nfollow_ups ["a"]\nMore prose.`,
      `${BODY} we saw follow_ups ["a"]`,
    ])
      expect(splitFollowUps(text)).toEqual({ text, items: [] });
  });
});
