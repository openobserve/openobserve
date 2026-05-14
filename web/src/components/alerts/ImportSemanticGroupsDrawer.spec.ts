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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

const mockDiffData = vi.hoisted(() => ({
  additions: [
    { id: "add-1", display: "New Group 1", fields: ["host"], normalize: false },
    { id: "add-2", display: "New Group 2", fields: ["service"], normalize: true },
  ],
  modifications: [
    {
      current: { id: "mod-1", display: "Existing Group", fields: ["host"], normalize: false },
      proposed: { id: "mod-1", display: "Updated Group", fields: ["host", "region"], normalize: false },
    },
  ],
  unchanged: [
    { id: "unch-1", display: "Stable Group", fields: ["level"], normalize: false },
  ],
}));

vi.mock("@/services/alerts", () => ({
  default: {
    previewSemanticGroupsDiff: vi.fn().mockResolvedValue({ data: mockDiffData }),
  },
}));

import ImportSemanticGroupsDrawer from "@/components/alerts/ImportSemanticGroupsDrawer.vue";
import alertsService from "@/services/alerts";

const currentGroups = [
  { id: "mod-1", display: "Existing Group", fields: ["host"], normalize: false },
  { id: "unch-1", display: "Stable Group", fields: ["level"], normalize: false },
];

async function mountComp(props: Record<string, any> = {}) {
  return mount(ImportSemanticGroupsDrawer, {
    props: {
      currentGroups,
      orgId: "default",
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

describe("ImportSemanticGroupsDrawer - rendering", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the close button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="import-drawer-close-btn"]').exists()).toBe(true);
  });

  it("renders the file input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-groups-import-file-drawer"]').exists()).toBe(true);
  });

  it("renders the cancel button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="import-drawer-cancel-btn"]').exists()).toBe(true);
  });

  it("renders the apply button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="import-drawer-apply-btn"]').exists()).toBe(true);
  });

  it("shows empty state (upload prompt) initially", async () => {
    const w = await mountComp();
    expect(w.text()).toContain("Upload a JSON file");
  });
});

describe("ImportSemanticGroupsDrawer - close & cancel", () => {
  it("clicking close button emits close", async () => {
    const w = await mountComp();
    await w.find('[data-test="import-drawer-close-btn"]').trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("clicking cancel button emits close", async () => {
    const w = await mountComp();
    await w.find('[data-test="import-drawer-cancel-btn"]').trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("handleClose clears diffData", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).handleClose();
    expect((w.vm as any).diffData).toBeNull();
  });

  it("handleClose clears selectedAdditions", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).handleClose();
    expect((w.vm as any).selectedAdditions).toHaveLength(0);
  });
});

describe("ImportSemanticGroupsDrawer - apply button state", () => {
  it("apply button is disabled when no changes selected", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).selectedModifications = [];
    await w.vm.$nextTick();
    expect((w.vm as any).hasSelectedChanges).toBe(false);
  });

  it("hasSelectedChanges returns true when additions are selected", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = ["add-1"];
    expect((w.vm as any).hasSelectedChanges).toBe(true);
  });

  it("hasSelectedChanges returns true when modifications are selected", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModifications = ["mod-1"];
    expect((w.vm as any).hasSelectedChanges).toBe(true);
  });
});

describe("ImportSemanticGroupsDrawer - selection methods", () => {
  it("selectAllAdditions populates selectedAdditions with all addition IDs", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectAllAdditions();
    expect((w.vm as any).selectedAdditions).toContain("add-1");
    expect((w.vm as any).selectedAdditions).toContain("add-2");
  });

  it("selectAllModifications populates selectedModifications with all modification IDs", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectAllModifications();
    expect((w.vm as any).selectedModifications).toContain("mod-1");
  });

  it("deselectAll clears both selectedAdditions and selectedModifications", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = ["add-1", "add-2"];
    (w.vm as any).selectedModifications = ["mod-1"];
    (w.vm as any).deselectAll();
    expect((w.vm as any).selectedAdditions).toHaveLength(0);
    expect((w.vm as any).selectedModifications).toHaveLength(0);
  });

  it("toggleAddition adds ID when not present", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).toggleAddition("add-1");
    expect((w.vm as any).selectedAdditions).toContain("add-1");
  });

  it("toggleAddition removes ID when present", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).toggleAddition("add-1");
    expect((w.vm as any).selectedAdditions).not.toContain("add-1");
  });

  it("toggleModification adds ID when not present", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModifications = [];
    (w.vm as any).toggleModification("mod-1");
    expect((w.vm as any).selectedModifications).toContain("mod-1");
  });

  it("toggleModification removes ID when present", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModifications = ["mod-1"];
    (w.vm as any).toggleModification("mod-1");
    expect((w.vm as any).selectedModifications).not.toContain("mod-1");
  });
});

describe("ImportSemanticGroupsDrawer - handleApply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits apply with merged groups when called", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).selectedModifications = [];
    (w.vm as any).handleApply();
    expect(w.emitted("apply")).toBeTruthy();
    const payload = (w.emitted("apply") as any[][])[0][0];
    expect(payload.some((g: any) => g.id === "add-1")).toBe(true);
  });

  it("emits close after apply", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).handleApply();
    expect(w.emitted("close")).toBeTruthy();
  });

  it("does nothing when no changes selected", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).selectedModifications = [];
    (w.vm as any).handleApply();
    expect(w.emitted("apply")).toBeFalsy();
  });

  it("includes proposed groups when modification is selected", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).selectedModifications = ["mod-1"];
    (w.vm as any).handleApply();
    const payload = (w.emitted("apply") as any[][])[0][0];
    const modGroup = payload.find((g: any) => g.id === "mod-1");
    expect(modGroup?.display).toBe("Updated Group");
    expect(modGroup?.fields).toContain("region");
  });
});

describe("ImportSemanticGroupsDrawer - viewGroup & viewModification", () => {
  it("viewGroup sets selectedGroup and opens dialog", async () => {
    const w = await mountComp();
    const group = mockDiffData.additions[0];
    (w.vm as any).viewGroup(group);
    expect((w.vm as any).selectedGroup).toEqual(group);
    expect((w.vm as any).showGroupDialog).toBe(true);
  });

  it("viewModification sets selectedModification and opens dialog", async () => {
    const w = await mountComp();
    const mod = mockDiffData.modifications[0];
    (w.vm as any).viewModification(mod);
    expect((w.vm as any).selectedModification).toEqual(mod);
    expect((w.vm as any).showModificationDialog).toBe(true);
  });
});

describe("ImportSemanticGroupsDrawer - isNewField", () => {
  it("returns false when no selectedModification", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModification = null;
    expect((w.vm as any).isNewField("region")).toBe(false);
  });

  it("returns true for field only in proposed (not in current)", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModification = mockDiffData.modifications[0];
    expect((w.vm as any).isNewField("region")).toBe(true);
  });

  it("returns false for field present in current", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModification = mockDiffData.modifications[0];
    expect((w.vm as any).isNewField("host")).toBe(false);
  });
});

describe("ImportSemanticGroupsDrawer - previewDiff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls alertsService.previewSemanticGroupsDiff", async () => {
    const w = await mountComp();
    const groups = [{ id: "g1", display: "Group 1", fields: ["host"], normalize: false }];
    await (w.vm as any).previewDiff(groups);
    await flushPromises();
    expect(alertsService.previewSemanticGroupsDiff).toHaveBeenCalledWith("default", groups);
  });

  it("auto-selects all additions and modifications after preview", async () => {
    const w = await mountComp();
    const groups = [{ id: "g1", display: "Group 1", fields: ["host"], normalize: false }];
    await (w.vm as any).previewDiff(groups);
    await flushPromises();
    expect((w.vm as any).selectedAdditions).toContain("add-1");
    expect((w.vm as any).selectedModifications).toContain("mod-1");
  });
});
