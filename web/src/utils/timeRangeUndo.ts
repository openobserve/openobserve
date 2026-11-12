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

export const TIME_RANGE_UNDO_LIMIT = 20;

/** The picker's selection before a zoom, shift, brush or zoom-out, and the label it showed. */
export interface TimeRangeUndoStep {
  label: string;
  selectedType: string;
  calendarToken: string | null;
  relativePeriod: string;
  relativeValue: number;
  startUs: number;
  endUs: number;
}

const sameStep = (a: TimeRangeUndoStep, b: TimeRangeUndoStep): boolean =>
  a.selectedType === b.selectedType &&
  (a.selectedType === "relative"
    ? a.calendarToken === b.calendarToken &&
      a.relativePeriod === b.relativePeriod &&
      a.relativeValue === b.relativeValue
    : a.startUs === b.startUs && a.endUs === b.endUs);

/** A new stack with `step` on top; repeating the top is a no-op and the oldest step drops past the limit. */
export const pushUndoStep = (
  stack: TimeRangeUndoStep[],
  step: TimeRangeUndoStep,
  limit: number = TIME_RANGE_UNDO_LIMIT,
): TimeRangeUndoStep[] => {
  const top = stack[stack.length - 1];
  if (top && sameStep(top, step)) return stack;
  return [...stack, step].slice(-limit);
};

/** The step to return to and the stack left after it; null when there is nothing to undo. */
export const popUndoStep = (
  stack: TimeRangeUndoStep[],
): { step: TimeRangeUndoStep; rest: TimeRangeUndoStep[] } | null =>
  stack.length === 0 ? null : { step: stack[stack.length - 1], rest: stack.slice(0, -1) };
