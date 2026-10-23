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

// For install-flow specs: the real builder reads the org's streams, which those specs do not serve.

import { getReadyMadeSource, readyMadeMarker } from "../catalog";

export const stubKubernetesDashboards = async (): Promise<Record<string, any>[]> =>
  getReadyMadeSource("kubernetes").dashboards.map((ref) => ({
    version: 8,
    dashboardId: "",
    title: ref.title,
    description: "",
    role: readyMadeMarker("kubernetes", ref.key),
    owner: "",
    tabs: [{ tabId: "default", name: "Overview", panels: [] }],
    variables: { list: [], showDynamicFilters: false },
  }));
