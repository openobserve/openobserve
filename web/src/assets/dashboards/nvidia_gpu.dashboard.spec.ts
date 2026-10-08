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

// Bundled copy of the openobserve/dashboards "NVIDIA GPU Monitoring" dashboard that the
// GPU setup card auto-imports.

import { describe, it, expect } from "vitest";
import dashboard from "./nvidia_gpu.dashboard.json";
import { NVIDIA_GPU_DASHBOARD } from "@/composables/useSetupDashboardImport";

const doc: any = dashboard;
const panels: any[] = (doc.tabs ?? []).flatMap((t: any) => t.panels ?? []);

describe("nvidia_gpu.dashboard.json", () => {
  it("carries the title the import dedupes on and no baked-in id", () => {
    expect(doc.title).toBe(NVIDIA_GPU_DASHBOARD.title);
    expect(doc.dashboardId).toBe("");
  });

  it("reads only the lower-cased dcgm_fi_* streams the card detects", () => {
    expect(panels.length).toBeGreaterThan(0);
    for (const p of panels) {
      for (const q of p.queries ?? []) expect(q.fields?.stream).toMatch(/^dcgm_fi_[a-z_]+$/);
    }
  });

  it("ships no custom-code panels (auto-imported without review)", () => {
    expect(panels.filter((p) => p.type === "custom_chart")).toEqual([]);
  });
});
