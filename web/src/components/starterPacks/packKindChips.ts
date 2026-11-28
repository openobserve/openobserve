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

/** The icon chip of each pack item kind; its tokens follow the theme. */
export const KIND_CHIPS = {
  dashboard: "bg-icon-chip-info-bg text-icon-chip-info-text",
  alert: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  savedView: "bg-icon-chip-purple-bg text-icon-chip-purple-text",
} as const;
