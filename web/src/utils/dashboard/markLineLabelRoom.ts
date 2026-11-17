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

export const MARK_LINE_LABEL_TOP = 24;

function hasTopLabel(item: any) {
  if (!item?.annotationDetails || item.xAxis == null || item.label?.show === false) return false;
  return (item.label?.position ?? "end") === "end";
}

export function hasAnnotationTopLabels(series: unknown): boolean {
  return (
    Array.isArray(series) &&
    series.some(
      (entry) => Array.isArray(entry?.markLine?.data) && entry.markLine.data.some(hasTopLabel),
    )
  );
}

// Trellis grids are arrays with their own top padding, and a percentage top already scales with the panel.
export function reserveAnnotationLabelRoom<T>(converted: T): T {
  const options = (converted as { options?: any } | undefined)?.options;
  const grid = options?.grid;
  if (!grid || Array.isArray(grid) || typeof grid.top !== "number") return converted;
  if (grid.top >= MARK_LINE_LABEL_TOP || !hasAnnotationTopLabels(options.series)) return converted;
  return { ...converted, options: { ...options, grid: { ...grid, top: MARK_LINE_LABEL_TOP } } };
}
