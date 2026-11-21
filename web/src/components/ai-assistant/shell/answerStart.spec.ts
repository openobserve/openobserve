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

import { answerStartHidden, readFromAnswerStart } from "./answerStart";

const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

function scroller(scrollHeight: number, clientHeight: number, top = 100): HTMLElement {
  const el = document.createElement("section");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { value: clientHeight });
  el.getBoundingClientRect = () => box(top, top + clientHeight);
  return el;
}

function answer(top: number): HTMLElement {
  const el = document.createElement("article");
  el.getBoundingClientRect = () => box(top, top + 50);
  return el;
}

describe("answerStartHidden", () => {
  it("keeps a transcript that fits followed, even when its answer starts at the very top", () => {
    expect(answerStartHidden(answer(40), scroller(221, 221))).toBe(false);
    expect(answerStartHidden(answer(40), scroller(222, 221))).toBe(false);
  });

  it("leaves the bottom only when the transcript scrolls and the answer's start is out of view", () => {
    expect(answerStartHidden(answer(40), scroller(600, 200))).toBe(true);
    expect(answerStartHidden(answer(120), scroller(600, 200))).toBe(false);
    expect(answerStartHidden(answer(99), scroller(600, 200))).toBe(false);
  });

  it("does nothing without a scroller", () => {
    expect(answerStartHidden(answer(0), null)).toBe(false);
  });
});

describe("readFromAnswerStart", () => {
  it("moves a followed reader to the start of an answer that scrolled away", () => {
    expect(readFromAnswerStart(true, answer(40), scroller(600, 200))).toBe(true);
  });

  it("keeps the place of a reader who scrolled up during the turn", () => {
    expect(readFromAnswerStart(false, answer(40), scroller(600, 200))).toBe(false);
  });

  it("stays put when the answer's start is in view or there is no answer", () => {
    expect(readFromAnswerStart(true, answer(120), scroller(600, 200))).toBe(false);
    expect(readFromAnswerStart(true, undefined, scroller(600, 200))).toBe(false);
  });
});
