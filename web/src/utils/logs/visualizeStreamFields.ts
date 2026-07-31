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

/**
 * Decides whether stream fields must be (re)extracted before building the
 * query for the logs visualization (Timechart) view.
 *
 * On page reload the visualize toggle can run before async field loading has
 * finished. Building the query too early produces SELECT * — which is
 * rejected for visualization — and leaves the panel without axis fields.
 * Two readiness signals matter:
 *  - selectedStreamFields: schema fields for the selected stream(s)
 *  - interestingFieldList: fields used by buildSearch() in quick mode
 */
export const shouldReloadStreamFieldsForVisualize = (state: {
  selectedStream: unknown[];
  selectedStreamFields: unknown[];
  interestingFieldList: string[];
  quickMode: boolean;
}): boolean => {
  if (!state.selectedStream?.length) return false;

  if (!state.selectedStreamFields?.length) return true;

  return state.quickMode && !state.interestingFieldList?.length;
};
