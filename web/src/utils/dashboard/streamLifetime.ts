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

interface PanelStreamType {
  queries?: { fields?: { stream_type?: string } }[];
}

/** True when the backend searches the panel's stream over its whole lifetime, so the dashboard window does not bound its rows. */
export const spansStreamLifetime = (panelSchema: PanelStreamType | null | undefined): boolean =>
  panelSchema?.queries?.[0]?.fields?.stream_type === "enrichment_tables";
