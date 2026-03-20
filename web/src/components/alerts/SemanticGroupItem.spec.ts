// Copyright 2023 OpenObserve Inc.
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

import SemanticGroupItem from "@/components/alerts/SemanticGroupItem.vue";

const makeGroup = (overrides: Record<string, any> = {}) => ({
  id: "group-1",
  display: "Infrastructure",
  fields: ["host", "service"],
  normalize: false,
  is_stable: false,
  is_scope: false,
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(SemanticGroupItem, {
    props: { group: makeGroup(), ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        TagInput: {
          name: "TagInput",
          template: '<div data-test="tag-input-stub"></div>',
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
      },
    },
  });
}

describe("SemanticGroupItem - rendering", () => {
  it("renders the display name input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-display-input"]').exists()).toBe(true);
  });

  it("renders the scope checkbox", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-action-scope-chkbox"]').exists()).toBe(true);
  });

  it("renders the stable checkbox", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-action-stable-chkbox"]').exists()).toBe(true);
  });

  it("renders the normalize checkbox", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-action-normalize-chkbox"]').exists()).toBe(true);
  });

  it("renders the delete button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="semantic-group-remove-group-btn"]').exists()).toBe(true);
  });

  it("renders the TagInput stub for fields", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="tag-input-stub"]').exists()).toBe(true);
  });

  it("shows ID as read-only caption when id is non-empty", async () => {
    const w = await mountComp({ group: makeGroup({ id: "my-id" }) });
    expect(w.text()).toContain("my-id");
  });

  it("does not show ID caption when id is empty", async () => {
    const w = await mountComp({ group: makeGroup({ id: "" }) });
    expect(w.text()).not.toContain("ID:");
  });
});

describe("SemanticGroupItem - emitUpdate on checkbox changes", () => {
  it("emits update when scope checkbox changes", async () => {
    const w = await mountComp();
    (w.vm as any).localGroup.is_scope = true;
    (w.vm as any).emitUpdate();
    expect(w.emitted("update")).toBeTruthy();
    const payload = (w.emitted("update") as any[][])[0][0];
    expect(payload.is_scope).toBe(true);
  });

  it("emits update when stable checkbox changes", async () => {
    const w = await mountComp();
    (w.vm as any).localGroup.is_stable = true;
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update") as any[][])[0][0];
    expect(payload.is_stable).toBe(true);
  });

  it("emits update when normalize checkbox changes", async () => {
    const w = await mountComp();
    (w.vm as any).localGroup.normalize = true;
    (w.vm as any).emitUpdate();
    const payload = (w.emitted("update") as any[][])[0][0];
    expect(payload.normalize).toBe(true);
  });
});

describe("SemanticGroupItem - delete", () => {
  it("emits delete when delete button is clicked", async () => {
    const w = await mountComp();
    await w.find('[data-test="semantic-group-remove-group-btn"]').trigger("click");
    expect(w.emitted("delete")).toBeTruthy();
  });
});

describe("SemanticGroupItem - handleDisplayChange", () => {
  it("emits update with new display name", async () => {
    const w = await mountComp();
    (w.vm as any).localGroup.display = "New Name";
    (w.vm as any).handleDisplayChange();
    expect(w.emitted("update")).toBeTruthy();
    const payload = (w.emitted("update") as any[][])[0][0];
    expect(payload.display).toBe("New Name");
  });
});

describe("SemanticGroupItem - generateIdFromDisplay", () => {
  it("converts spaces to hyphens", async () => {
    const w = await mountComp();
    expect((w.vm as any).generateIdFromDisplay("Hello World")).toBe("hello-world");
  });

  it("removes special characters", async () => {
    const w = await mountComp();
    expect((w.vm as any).generateIdFromDisplay("Test@Group!")).toBe("testgroup");
  });

  it("lowercases the result", async () => {
    const w = await mountComp();
    expect((w.vm as any).generateIdFromDisplay("UPPER CASE")).toBe("upper-case");
  });

  it("collapses multiple hyphens", async () => {
    const w = await mountComp();
    const result = (w.vm as any).generateIdFromDisplay("Test  --  Group");
    expect(result).toBe("test-group");
  });

  it("trims leading/trailing hyphens", async () => {
    const w = await mountComp();
    const result = (w.vm as any).generateIdFromDisplay("  test  ");
    expect(result).not.toMatch(/^-|-$/);
  });
});

describe("SemanticGroupItem - watcher syncs props", () => {
  it("syncs localGroup when group prop changes", async () => {
    const w = await mountComp();
    await w.setProps({ group: makeGroup({ display: "Updated Display" }) });
    await flushPromises();
    expect((w.vm as any).localGroup.display).toBe("Updated Display");
  });

  it("syncs fields when group prop changes", async () => {
    const w = await mountComp();
    await w.setProps({ group: makeGroup({ fields: ["new_field"] }) });
    await flushPromises();
    expect((w.vm as any).localGroup.fields).toEqual(["new_field"]);
  });
});
