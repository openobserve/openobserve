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

import { shallowMount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/dashboard/convertPanelData", () => ({
  convertPanelData: vi.fn(),
}));

import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import PublicPanelRenderer from "@/components/dashboards/PublicPanelRenderer.vue";

const build = (panelSchema: any, snapshot: any) =>
  shallowMount(PublicPanelRenderer, {
    props: { panelSchema, snapshot },
    global: { plugins: [i18n], provide: { store } },
  });

describe("PublicPanelRenderer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts the snapshot data client-side (never fires a search)", async () => {
    (convertPanelData as any).mockResolvedValue({ chartType: "line", options: {} });
    const snapshot = { data: [{ hits: [{ x: 1 }] }], resultMetaData: [], metadata: {} };
    build({ type: "line", id: "p1" }, snapshot);
    await flushPromises();
    expect(convertPanelData).toHaveBeenCalledTimes(1);
    const call = (convertPanelData as any).mock.calls[0];
    expect(call[0]).toEqual({ type: "line", id: "p1" });
    expect(call[1]).toEqual(snapshot.data);
  });

  it("skips conversion for html/markdown panels (schema-only, no data)", async () => {
    build({ type: "markdown", id: "m1", markdownContent: "# hi" }, { data: [] });
    await flushPromises();
    expect(convertPanelData).not.toHaveBeenCalled();
  });

  it("surfaces a render error instead of throwing", async () => {
    (convertPanelData as any).mockRejectedValue(new Error("boom"));
    const w = build({ type: "line", id: "p1" }, { data: [{ hits: [{ x: 1 }] }] });
    await flushPromises();
    expect(w.text()).toContain("Unable to render panel");
  });
});
