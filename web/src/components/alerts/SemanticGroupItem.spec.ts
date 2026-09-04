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
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import SemanticGroupItem from "@/components/alerts/SemanticGroupItem.vue";

const makeGroup = (overrides: Record<string, any> = {}) => ({
  id: "group-1",
  display: "Infrastructure",
  fields: ["host", "service"],
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(SemanticGroupItem, {
    props: { group: makeGroup(), ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        OTagInput: {
          name: "OTagInput",
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

describe("SemanticGroupItem - delete", () => {
  it("emits delete when delete button is clicked", async () => {
    const w = await mountComp();
    await w.find('[data-test="semantic-group-remove-group-btn"]').trigger("click");
    expect(w.emitted("delete")).toBeTruthy();
  });
});

describe("SemanticGroupItem - live update emit", () => {
  // Rule ④ event parity: the pre-migration row emitted "update" on every field
  // edit so the parent keeps a live copy. Now the change flows through the form
  // (name=-owned) and the deep values-watch re-emits the assembled group.
  it("emits update with the new display name when the display field changes", async () => {
    const w = await mountComp();
    (w.vm as any).form.setFieldValue("display", "New Name");
    await flushPromises();
    const updates = w.emitted("update") as any[][] | undefined;
    expect(updates).toBeTruthy();
    const payload = updates![updates!.length - 1][0];
    expect(payload.display).toBe("New Name");
  });
});

describe("SemanticGroupItem - schema validation (real OForm)", () => {
  // Proves the schema is actually wired (empty required blocks) — the key
  // anti-regression test (a schema that resolves to undefined would always pass).
  it("empty display → form invalid + 'Name is required' after submit", async () => {
    const w = await mountComp({ group: makeGroup({ display: "" }) });
    const form = (w.findComponent({ name: "OForm" }).vm as any).form;
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(w.text()).toContain("Name is required");
  });

  it("valid display → form valid on submit", async () => {
    const w = await mountComp({ group: makeGroup({ display: "Infra" }) });
    const form = (w.findComponent({ name: "OForm" }).vm as any).form;
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(true);
  });
});

// The two tests above drive handleSubmit() directly — but NOTHING in the app
// does: the row has no submit button and its only consumer wires @update/@delete
// only. So they pass while the field stays silent for a real user. These drive
// the actual blur, the way pre-migration `handleDisplayBlur` was reached.
describe("SemanticGroupItem - required cue on blur (real user path)", () => {
  const displayInput = (w: any) => w.find('[data-test="semantic-group-display-input"] input');

  it("blurring an empty display shows 'Name is required'", async () => {
    const w = await mountComp({ group: makeGroup({ display: "" }) });
    expect(w.text()).not.toContain("Name is required");

    await displayInput(w).trigger("blur");
    await flushPromises();

    expect(w.text()).toContain("Name is required");
  });

  it("typing after the error clears it", async () => {
    const w = await mountComp({ group: makeGroup({ display: "" }) });
    await displayInput(w).trigger("blur");
    await flushPromises();
    expect(w.text()).toContain("Name is required");

    await displayInput(w).setValue("Infra");
    await flushPromises();

    expect(w.text()).not.toContain("Name is required");
  });

  it("blurring a filled display shows no error and still regenerates the id", async () => {
    const w = await mountComp({ group: makeGroup({ display: "", id: "" }) });
    await displayInput(w).setValue("My Group");
    await displayInput(w).trigger("blur");
    await flushPromises();

    expect(w.text()).not.toContain("Name is required");
    expect(w.text()).toContain("my-group");
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

describe("SemanticGroupItem - external prop sync", () => {
  // The form is the single source of truth (no localGroup mirror). An external
  // group change (import merge / category switch) resets the form to the new
  // values; a self-echo (parent replaying our own emit) is skipped so it never
  // resets mid-edit.
  it("resets the form when the group prop changes display", async () => {
    const w = await mountComp();
    await w.setProps({ group: makeGroup({ display: "Updated Display" }) });
    await flushPromises();
    expect((w.vm as any).form.state.values.display).toBe("Updated Display");
  });

  it("resets the form when the group prop changes fields", async () => {
    const w = await mountComp();
    await w.setProps({ group: makeGroup({ fields: ["new_field"] }) });
    await flushPromises();
    expect((w.vm as any).form.state.values.fields).toEqual(["new_field"]);
  });

  it("does not re-emit update on a self-echo prop change (identical values)", async () => {
    const w = await mountComp();
    await w.setProps({ group: makeGroup() });
    await flushPromises();
    expect(w.emitted("update")).toBeFalsy();
  });
});
