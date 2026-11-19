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

// Rendered widths (px) of the view toggle at the 34px toolbar size, measured with and without Timechart.
const TOGGLE_LABELS = { narrow: 367, wide: 383 };
const TOGGLE_ICONS = 168;
const TIMECHART_TAB = { narrow: 116, wide: 120, icon: 36 };

interface MeasuredPicker {
  triggerElement?: HTMLElement | null;
  shortestFormWidth?: () => number;
}

export const toggleGroupWidths = (
  narrow: boolean,
  timechart: boolean,
): { labels: number; icons: number } => {
  const labels = narrow ? TOGGLE_LABELS.narrow : TOGGLE_LABELS.wide;
  if (!timechart) return { labels, icons: TOGGLE_ICONS };
  return {
    labels: labels + (narrow ? TIMECHART_TAB.narrow : TIMECHART_TAB.wide),
    icons: TOGGLE_ICONS + TIMECHART_TAB.icon,
  };
};

/** Width the picker's trigger can still shed by walking its label forms (§6). */
export const pickerSlack = (picker: MeasuredPicker | null | undefined): number => {
  const shortest = picker?.shortestFormWidth?.() ?? 0;
  const trigger = picker?.triggerElement;
  if (!shortest || !trigger) return 0;
  return Math.max(0, trigger.getBoundingClientRect().width - shortest);
};
