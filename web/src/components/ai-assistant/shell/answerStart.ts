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

// Sub-pixel rounding leaves a fitting transcript a pixel or two taller than its box.
const OVERFLOW_TOLERANCE_PX = 2;

/** True when a finished answer's first line is out of view in a transcript that scrolls; only then is it worth leaving the bottom for. */
export function answerStartHidden(answer: HTMLElement, scroller: HTMLElement | null): boolean {
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + OVERFLOW_TOLERANCE_PX)
    return false;
  const box = scroller.getBoundingClientRect();
  const top = answer.getBoundingClientRect().top;
  return top < box.top - OVERFLOW_TOLERANCE_PX || top >= box.bottom;
}

/** True when a finished turn should move the view to its answer's start; a reader who scrolled away keeps their place. */
export function readFromAnswerStart(
  following: boolean,
  answer: HTMLElement | undefined,
  scroller: HTMLElement | null,
): boolean {
  return following && !!answer && answerStartHidden(answer, scroller);
}
