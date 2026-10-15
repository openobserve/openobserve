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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import PanelDraftsEmptyHint from "./PanelDraftsEmptyHint.vue";
import { PANEL_DRAFTS_KEY } from "@/composables/dashboard/usePanelDraft";

const entry = (id: string, status: string, tabId: string, updatedAt: number) => ({
  record: { key: id, panelId: null, draftId: id, isNew: true, data: {}, updatedAt },
  status,
  tabId,
});

const mountHint = (tabId: string, items: any[]) => {
  const ctx = {
    entries: ref(items),
    byPanelId: computed(() => new Map()),
    open: vi.fn(),
    remove: vi.fn(),
    removeForPanel: vi.fn(),
  };
  const wrapper = mount(PanelDraftsEmptyHint, {
    props: { tabId },
    global: { provide: { [PANEL_DRAFTS_KEY as symbol]: ctx } },
  });
  return { wrapper, ctx };
};

describe("PanelDraftsEmptyHint", () => {
  it("offers to continue the newest new-panel draft on this tab", async () => {
    const older = entry("a", "new", "t1", 1);
    const newer = entry("b", "new", "t1", 2);
    const { wrapper, ctx } = mountHint("t1", [
      older,
      newer,
      entry("c", "new", "t2", 3),
      entry("d", "edited", "t1", 4),
    ]);

    expect(wrapper.text()).toContain("You have 2 unsaved new panels in this tab.");
    await wrapper.find('[data-test="dashboard-empty-tab-drafts-continue"]').trigger("click");
    expect(ctx.open).toHaveBeenCalledWith(newer);
  });

  it("renders nothing when the tab has no new-panel drafts", () => {
    const { wrapper } = mountHint("t1", [entry("c", "new", "t2", 3)]);
    expect(wrapper.find('[data-test="dashboard-empty-tab-drafts-hint"]').exists()).toBe(false);
  });
});
