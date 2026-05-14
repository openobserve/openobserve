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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";

const makeGroup = (overrides: Record<string, any> = {}) => ({
  id: `group-${Math.random().toString(36).slice(2)}`,
  display: "Test Group",
  group: "Infrastructure",
  fields: ["host", "service"],
  ...overrides,
});

const sampleGroups = [
  makeGroup({ id: "g1", display: "Host Group", group: "Infrastructure", fields: ["host"] }),
  makeGroup({ id: "g2", display: "Service Group", group: "Infrastructure", fields: ["service"] }),
  makeGroup({ id: "g3", display: "Region Group", group: "Cloud", fields: ["region"] }),
];

async function mountComp(props: Record<string, any> = {}) {
  return mount(SemanticFieldGroupsConfig, {
    props: {
      semanticFieldGroups: sampleGroups,
      fingerprintFields: [],
      showFingerprintFields: false,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        SemanticGroupItem: {
          template: '<div data-test="semantic-group-item-stub"></div>',
          props: ["group"],
          emits: ["update", "delete"],
        },
        ImportSemanticGroupsDrawer: {
          template: '<div data-test="import-drawer-stub"></div>',
          props: ["currentGroups", "orgId"],
          emits: ["apply", "close"],
        },
      },
    },
  });
}

describe("SemanticFieldGroupsConfig - rendering", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the export button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="correlation-semanticfieldgroup-export-json-btn"]').exists()).toBe(true);
  });

  it("renders the import button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="correlation-semanticfieldgroup-import-json-btn"]').exists()).toBe(true);
  });

  it("renders the add custom group button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="correlation-semanticfieldgroup-add-custom-group-btn"]').exists()).toBe(true);
  });

  it("renders the category select", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-category-select"]').exists()).toBe(true);
  });
});

describe("SemanticFieldGroupsConfig - group loading", () => {
  it("loads provided groups into localGroups", async () => {
    const w = await mountComp();
    expect((w.vm as any).localGroups.length).toBeGreaterThan(0);
    const ids = (w.vm as any).localGroups.map((g: any) => g.id);
    expect(ids).toContain("g1");
  });
});

describe("SemanticFieldGroupsConfig - categoryOptions computed", () => {
  it("returns empty array when no groups", async () => {
    const w = await mountComp({ semanticFieldGroups: [] });
    expect((w.vm as any).categoryOptions).toEqual([]);
  });

  it("returns unique categories from groups", async () => {
    const w = await mountComp();
    const categories = (w.vm as any).categoryOptions.map((o: any) => o.value);
    expect(categories).toContain("Infrastructure");
    expect(categories).toContain("Cloud");
  });

  it("includes count of groups per category", async () => {
    const w = await mountComp();
    const infra = (w.vm as any).categoryOptions.find((o: any) => o.value === "Infrastructure");
    expect(infra.count).toBe(2);
  });

  it("sorts categories alphabetically", async () => {
    const w = await mountComp();
    const cats = (w.vm as any).categoryOptions.map((o: any) => o.value);
    const sorted = [...cats].sort();
    expect(cats).toEqual(sorted);
  });
});

describe("SemanticFieldGroupsConfig - filteredGroups computed", () => {
  it("returns all groups when no category selected", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = null;
    expect((w.vm as any).filteredGroups).toEqual((w.vm as any).localGroups);
  });

  it("filters groups by selected category", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = "Cloud";
    const filtered = (w.vm as any).filteredGroups;
    expect(filtered.every((g: any) => g.group === "Cloud")).toBe(true);
  });

  it("returns empty array when no groups match category", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = "NonExistent";
    expect((w.vm as any).filteredGroups).toHaveLength(0);
  });
});

describe("SemanticFieldGroupsConfig - addGroup", () => {
  it("addGroup prepends a new group to localGroups", async () => {
    const w = await mountComp();
    const before = (w.vm as any).localGroups.length;
    (w.vm as any).addGroup();
    expect((w.vm as any).localGroups.length).toBe(before + 1);
  });

  it("new group has empty display name", async () => {
    const w = await mountComp();
    (w.vm as any).addGroup();
    expect((w.vm as any).localGroups[0].display).toBe("");
  });

  it("new group uses current selectedCategory", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = "Infrastructure";
    (w.vm as any).addGroup();
    expect((w.vm as any).localGroups[0].group).toBe("Infrastructure");
  });

  it("addGroup emits update:semanticFieldGroups", async () => {
    const w = await mountComp();
    (w.vm as any).addGroup();
    expect(w.emitted("update:semanticFieldGroups")).toBeTruthy();
  });

  it("new group is inserted at index 0 with empty display and fields", async () => {
    const w = await mountComp();
    (w.vm as any).addGroup();
    const newGroup = (w.vm as any).localGroups[0];
    expect(newGroup.display).toBe("");
    expect(newGroup.fields).toHaveLength(0);
    expect(newGroup.id).toBeTruthy();
  });
});

describe("SemanticFieldGroupsConfig - removeGroupByFilter", () => {
  it("removes the group at the given filtered index", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = "Infrastructure";
    const before = (w.vm as any).localGroups.length;
    (w.vm as any).removeGroupByFilter(0);
    expect((w.vm as any).localGroups.length).toBe(before - 1);
  });

  it("emits update:semanticFieldGroups after removal", async () => {
    const w = await mountComp();
    (w.vm as any).selectedCategory = "Infrastructure";
    (w.vm as any).removeGroupByFilter(0);
    expect(w.emitted("update:semanticFieldGroups")).toBeTruthy();
  });

  it("removes group ID from fingerprint fields if present", async () => {
    const w = await mountComp({ fingerprintFields: ["g1"] });
    (w.vm as any).selectedCategory = "Infrastructure";
    const idx = (w.vm as any).filteredGroups.findIndex((g: any) => g.id === "g1");
    if (idx >= 0) {
      (w.vm as any).removeGroupByFilter(idx);
      expect((w.vm as any).localFingerprintFields).not.toContain("g1");
    }
  });
});

describe("SemanticFieldGroupsConfig - export groups", () => {
  it("exportGroups creates a download link and clicks it", async () => {
    const w = await mountComp();
    const createObjURL = vi.fn().mockReturnValue("blob:url");
    const revokeObjURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjURL;
    URL.revokeObjectURL = revokeObjURL;

    const clickSpy = vi.fn();
    const origCreate2 = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate2(tag);
      if (tag === "a") vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(clickSpy);
      return el;
    });

    (w.vm as any).exportGroups();
    expect(createObjURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    vi.restoreAllMocks();
  });
});

describe("SemanticFieldGroupsConfig - import drawer", () => {
  it("navigateToImport sets showImportDrawer to true", async () => {
    const w = await mountComp();
    (w.vm as any).navigateToImport();
    expect((w.vm as any).showImportDrawer).toBe(true);
  });
});

describe("SemanticFieldGroupsConfig - showFingerprintFields", () => {
  it("shows fingerprint checkboxes when showFingerprintFields=true", async () => {
    const w = await mountComp({
      showFingerprintFields: true,
      fingerprintFields: [],
    });
    expect(w.find('[data-test="fingerprint-field-checkbox-g1"]').exists()).toBe(true);
  });

  it("hides fingerprint checkboxes when showFingerprintFields=false", async () => {
    const w = await mountComp({ showFingerprintFields: false });
    expect(w.find('[data-test="fingerprint-field-checkbox-g1"]').exists()).toBe(false);
  });
});

describe("SemanticFieldGroupsConfig - watcher", () => {
  it("updates localGroups when semanticFieldGroups prop changes", async () => {
    const w = await mountComp();
    const newGroups = [makeGroup({ id: "new-g", display: "New Group", group: "NewCat" })];
    await w.setProps({ semanticFieldGroups: newGroups });
    await flushPromises();
    expect((w.vm as any).localGroups.some((g: any) => g.id === "new-g")).toBe(true);
  });
});
