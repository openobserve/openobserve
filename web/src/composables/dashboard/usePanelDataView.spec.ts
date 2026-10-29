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

import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { usePanelDataView } from "./usePanelDataView";

describe("usePanelDataView", () => {
  const renderer = ref<any>({ data: [["all"]], filteredData: [["visible"]] });

  it("starts on Chart and switches to Data", () => {
    const view = usePanelDataView({ panelType: "line", renderer });
    expect(view.showDataViewToggle.value).toBe(true);
    expect(view.isDataView.value).toBe(false);
    view.previewView.value = "data";
    expect(view.isDataView.value).toBe(true);
  });

  it.each(["table", "html", "markdown", "custom_chart"])("offers no Data view for %s", (type) => {
    const view = usePanelDataView({ panelType: type, renderer });
    view.previewView.value = "data";
    expect(view.showDataViewToggle.value).toBe(false);
    expect(view.isDataView.value).toBe(false);
  });

  it("respects the enabled flag", () => {
    const view = usePanelDataView({
      panelType: "line",
      queryType: "sql",
      renderer,
      enabled: false,
    });
    expect(view.showDataViewToggle.value).toBe(false);
  });

  it("reads the legend-filtered result so hidden queries stay out", () => {
    const view = usePanelDataView({ panelType: "line", renderer });
    expect(view.rawData.value).toEqual([["visible"]]);
  });

  it("keeps the error on screen instead of overlaying rows", () => {
    const failing = ref<any>({ filteredData: [], errorDetail: { message: "boom" } });
    const view = usePanelDataView({ panelType: "line", renderer: failing });
    view.previewView.value = "data";
    expect(view.isDataView.value).toBe(true);
    expect(view.showDataOverlay.value).toBe(false);
    failing.value = { filteredData: [], errorDetail: { message: "" } };
    expect(view.showDataOverlay.value).toBe(true);
  });
});
