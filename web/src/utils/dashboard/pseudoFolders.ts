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

// Real folder ids are generated identifiers, so the dunder names cannot collide.
export const FAVORITES_FOLDER_ID = "__favorites__";
export const PUBLIC_LINKS_FOLDER_ID = "__public_links__";

/** True for a Dashboards rail view that is not a real folder and must never reach a folder API. */
export const isPseudoFolder = (id: string | null | undefined): boolean =>
  id === FAVORITES_FOLDER_ID || id === PUBLIC_LINKS_FOLDER_ID;
