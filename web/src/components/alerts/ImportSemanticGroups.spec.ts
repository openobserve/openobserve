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

const mockBack = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mockBack, push: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));

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
  unchanged: [{ id: "unch-1", display: "Stable Group", fields: ["level"], normalize: false }],
}));

vi.mock("@/services/alerts", () => ({
  default: {
    previewSemanticGroupsDiff: vi.fn().mockResolvedValue({ data: mockDiffData }),
    saveSemanticGroups: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import ImportSemanticGroups from "@/components/alerts/ImportSemanticGroups.vue";
import alertsService from "@/services/alerts";

const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  template: `
    <div
      v-if="open"
      :data-test="'o-dialog-stub'"
      :data-title="title"
      :data-sub-title="subTitle"
      :data-size="size"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button data-test="o-dialog-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button data-test="o-dialog-secondary" @click="$emit('click:secondary')">secondary</button>
      <button data-test="o-dialog-neutral" @click="$emit('click:neutral')">neutral</button>
      <button data-test="o-dialog-close" @click="$emit('update:open', false)">close</button>
    </div>
  `,
  props: [
    "open",
    "persistent",
    "size",
    "title",
    "subTitle",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(ImportSemanticGroups, {
    props,
    global: {
      plugins: [i18n, store],
      stubs: {
        BaseImport: {
          template: `
            <div data-test="base-import-stub">
              <slot name="full-width-content" />
            </div>
          `,
          props: ["title", "testPrefix", "isImporting", "showSplitter", "editorHeights"],
          emits: ["back", "cancel", "import", "update:jsonArray"],
        },
        ODialog: ODialogStub,
      },
    },
  });
}

describe("ImportSemanticGroups - rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the file input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-groups-import-file"]').exists()).toBe(true);
  });

  it("shows empty upload state initially", async () => {
    const w = await mountComp();
    expect(w.text()).toContain("Upload a JSON file");
  });
});

describe("ImportSemanticGroups - hasSelectedChanges", () => {
  it("returns false when no selections", async () => {
    const w = await mountComp();
    expect((w.vm as any).hasSelectedChanges).toBe(false);
  });

  it("returns true when additions are selected", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions.push("add-1");
    expect((w.vm as any).hasSelectedChanges).toBe(true);
  });

  it("returns true when modifications are selected", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModifications.push("mod-1");
    expect((w.vm as any).hasSelectedChanges).toBe(true);
  });
});

describe("ImportSemanticGroups - clearFile", () => {
  it("resets jsonFile, importedGroups, diffData, and selections", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).selectedModifications = ["mod-1"];
    (w.vm as any).clearFile();
    expect((w.vm as any).diffData).toBeNull();
    expect((w.vm as any).selectedAdditions).toHaveLength(0);
    expect((w.vm as any).selectedModifications).toHaveLength(0);
  });
});

describe("ImportSemanticGroups - previewDiff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls alertsService.previewSemanticGroupsDiff with orgId and groups", async () => {
    const w = await mountComp();
    const groups = [{ id: "g1", display: "G1", fields: ["host"], normalize: false }];
    await (w.vm as any).previewDiff(groups);
    await flushPromises();
    expect(alertsService.previewSemanticGroupsDiff).toHaveBeenCalledWith("default", groups);
  });

  it("auto-selects all additions after preview", async () => {
    const w = await mountComp();
    await (w.vm as any).previewDiff([]);
    await flushPromises();
    expect((w.vm as any).selectedAdditions).toContain("add-1");
    expect((w.vm as any).selectedAdditions).toContain("add-2");
  });

  it("auto-selects all modifications after preview", async () => {
    const w = await mountComp();
    await (w.vm as any).previewDiff([]);
    await flushPromises();
    expect((w.vm as any).selectedModifications).toContain("mod-1");
  });

  it("sets diffData after preview", async () => {
    const w = await mountComp();
    await (w.vm as any).previewDiff([]);
    await flushPromises();
    expect((w.vm as any).diffData).toEqual(mockDiffData);
  });
});

describe("ImportSemanticGroups - selection methods", () => {
  it("selectAllAdditions fills selectedAdditions", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectAllAdditions();
    expect((w.vm as any).selectedAdditions).toContain("add-1");
    expect((w.vm as any).selectedAdditions).toContain("add-2");
  });

  it("selectAllModifications fills selectedModifications", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectAllModifications();
    expect((w.vm as any).selectedModifications).toContain("mod-1");
  });

  it("deselectAll clears all selections", async () => {
    const w = await mountComp();
    (w.vm as any).selectedAdditions = ["add-1"];
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

describe("ImportSemanticGroups - viewGroup & viewModification", () => {
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

describe("ImportSemanticGroups - isNewField", () => {
  it("returns false when no selectedModification", async () => {
    const w = await mountComp();
    (w.vm as any).selectedModification = null;
    expect((w.vm as any).isNewField("region")).toBe(false);
  });

  it("returns true for field only in proposed", async () => {
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

describe("ImportSemanticGroups - applyChanges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls alertsService.saveSemanticGroups with merged groups", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).selectedModifications = [];
    await (w.vm as any).applyChanges();
    await flushPromises();
    expect(alertsService.saveSemanticGroups).toHaveBeenCalled();
    const callArgs = (alertsService.saveSemanticGroups as any).mock.calls[0];
    expect(callArgs[0]).toBe("default");
    const groups = callArgs[1];
    expect(groups.some((g: any) => g.id === "add-1")).toBe(true);
  });

  it("does nothing when hasSelectedChanges is false", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).selectedModifications = [];
    await (w.vm as any).applyChanges();
    await flushPromises();
    expect(alertsService.saveSemanticGroups).not.toHaveBeenCalled();
  });

  it("uses proposed group when modification selected", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = [];
    (w.vm as any).selectedModifications = ["mod-1"];
    await (w.vm as any).applyChanges();
    await flushPromises();
    const callArgs = (alertsService.saveSemanticGroups as any).mock.calls[0];
    const groups = callArgs[1];
    const modGroup = groups.find((g: any) => g.id === "mod-1");
    expect(modGroup?.display).toBe("Updated Group");
  });

  it("always includes unchanged groups in payload", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    (w.vm as any).selectedModifications = [];
    await (w.vm as any).applyChanges();
    await flushPromises();
    const callArgs = (alertsService.saveSemanticGroups as any).mock.calls[0];
    const groups = callArgs[1];
    expect(groups.some((g: any) => g.id === "unch-1")).toBe(true);
  });

  it("calls handleBack after successful apply", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    await (w.vm as any).applyChanges();
    await flushPromises();
    expect(mockBack).toHaveBeenCalled();
  });

  it("sets isApplying to false after completion", async () => {
    const w = await mountComp();
    (w.vm as any).diffData = mockDiffData;
    (w.vm as any).selectedAdditions = ["add-1"];
    await (w.vm as any).applyChanges();
    await flushPromises();
    expect((w.vm as any).isApplying).toBe(false);
  });
});

describe("ImportSemanticGroups - handleBack", () => {
  it("calls router.back()", async () => {
    const w = await mountComp();
    (w.vm as any).handleBack();
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("ImportSemanticGroups - ODialog integration", () => {
  it("group details dialog is hidden by default", async () => {
    const w = await mountComp();
    const dialogs = w.findAll('[data-test="o-dialog-stub"]');
    expect(dialogs.length).toBe(0);
  });

  it("opens group details ODialog when viewGroup is called", async () => {
    const w = await mountComp();
    (w.vm as any).viewGroup(mockDiffData.additions[0]);
    await flushPromises();
    const dialogs = w.findAll('[data-test="o-dialog-stub"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].attributes("data-title")).toBe("New Group 1");
    expect(dialogs[0].attributes("data-sub-title")).toBe("ID: add-1");
    expect(dialogs[0].attributes("data-size")).toBe("md");
    expect(dialogs[0].attributes("data-primary-label")).toBe("Close");
  });

  it("opens modification ODialog when viewModification is called", async () => {
    const w = await mountComp();
    (w.vm as any).viewModification(mockDiffData.modifications[0]);
    await flushPromises();
    const dialogs = w.findAll('[data-test="o-dialog-stub"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].attributes("data-title")).toBe("Updated Group");
    expect(dialogs[0].attributes("data-sub-title")).toBe("Compare Changes");
    expect(dialogs[0].attributes("data-size")).toBe("lg");
  });

  it("closes group details ODialog when primary button is clicked", async () => {
    const w = await mountComp();
    (w.vm as any).viewGroup(mockDiffData.additions[0]);
    await flushPromises();
    expect((w.vm as any).showGroupDialog).toBe(true);
    await w.find('[data-test="o-dialog-primary"]').trigger("click");
    await flushPromises();
    expect((w.vm as any).showGroupDialog).toBe(false);
  });

  it("closes modification ODialog when primary button is clicked", async () => {
    const w = await mountComp();
    (w.vm as any).viewModification(mockDiffData.modifications[0]);
    await flushPromises();
    expect((w.vm as any).showModificationDialog).toBe(true);
    await w.find('[data-test="o-dialog-primary"]').trigger("click");
    await flushPromises();
    expect((w.vm as any).showModificationDialog).toBe(false);
  });

  it("closes group details ODialog via update:open emit", async () => {
    const w = await mountComp();
    (w.vm as any).viewGroup(mockDiffData.additions[0]);
    await flushPromises();
    await w.find('[data-test="o-dialog-close"]').trigger("click");
    await flushPromises();
    expect((w.vm as any).showGroupDialog).toBe(false);
  });

  it("closes modification ODialog via update:open emit", async () => {
    const w = await mountComp();
    (w.vm as any).viewModification(mockDiffData.modifications[0]);
    await flushPromises();
    await w.find('[data-test="o-dialog-close"]').trigger("click");
    await flushPromises();
    expect((w.vm as any).showModificationDialog).toBe(false);
  });
});

describe("ImportSemanticGroups - handleJsonUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing for empty array", async () => {
    const w = await mountComp();
    await (w.vm as any).handleJsonUpdate([]);
    await flushPromises();
    expect(alertsService.previewSemanticGroupsDiff).not.toHaveBeenCalled();
  });

  it("calls previewDiff with valid groups", async () => {
    const w = await mountComp();
    const groups = [{ id: "g1", display: "G1", fields: ["host"], normalize: false }];
    await (w.vm as any).handleJsonUpdate(groups);
    await flushPromises();
    expect(alertsService.previewSemanticGroupsDiff).toHaveBeenCalledWith("default", groups);
  });
});
