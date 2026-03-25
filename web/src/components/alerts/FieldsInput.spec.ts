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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import FieldsInput from "@/components/alerts/FieldsInput.vue";

const makeField = (overrides: Record<string, any> = {}) => ({
  uuid: Math.random().toString(36).slice(2),
  column: "",
  operator: "=",
  value: "",
  ...overrides,
});

const streamFields = [
  { label: "Host", value: "host" },
  { label: "Level", value: "level" },
  { label: "Message", value: "message" },
];

async function mountComp(props: Record<string, any> = {}) {
  return mount(FieldsInput, {
    props: {
      fields: [],
      streamFields,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

describe("FieldsInput - rendering with empty fields", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders conditions title text", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="alert-conditions-text"]').exists()).toBe(true);
  });

  it("shows Add Condition button when fields is empty", async () => {
    const w = await mountComp({ fields: [] });
    expect(w.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
  });

  it("does not show condition rows when fields is empty", async () => {
    const w = await mountComp({ fields: [] });
    expect(w.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
  });
});

describe("FieldsInput - rendering with fields", () => {
  it("hides Add Condition button when fields is non-empty", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
  });

  it("renders condition rows for each field", async () => {
    const fields = [makeField(), makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
    expect(w.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
  });

  it("renders column select for each field", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-select-column"]').exists()).toBe(true);
  });

  it("renders operator select for each field", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-operator-select"]').exists()).toBe(true);
  });

  it("renders value input for each field", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-value-input"]').exists()).toBe(true);
  });

  it("renders delete button for each field", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    expect(w.find('[data-test="alert-conditions-delete-condition-btn"]').exists()).toBe(true);
  });

  it("renders add-condition button only on last field row", async () => {
    const fields = [makeField(), makeField()];
    const w = await mountComp({ fields });
    const addBtns = w.findAll('[data-test="alert-conditions-add-condition-btn"]');
    expect(addBtns).toHaveLength(1);
  });
});

describe("FieldsInput - emit events", () => {
  it("clicking Add Condition button emits 'add'", async () => {
    const w = await mountComp({ fields: [] });
    await w.find('[data-test="alert-conditions-add-btn"]').trigger("click");
    expect(w.emitted("add")).toBeTruthy();
    expect(w.emitted("add")!.length).toBe(1);
  });

  it("clicking delete button emits 'remove' with the field", async () => {
    const field = makeField({ column: "host" });
    const w = await mountComp({ fields: [field] });
    await w.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");
    expect(w.emitted("remove")).toBeTruthy();
    expect((w.emitted("remove") as any[][])[0][0]).toMatchObject({ column: "host" });
  });

  it("clicking delete button also emits 'input:update'", async () => {
    const field = makeField({ column: "level" });
    const w = await mountComp({ fields: [field] });
    await w.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");
    expect(w.emitted("input:update")).toBeTruthy();
  });

  it("clicking add-condition-btn on last row emits 'add'", async () => {
    const fields = [makeField()];
    const w = await mountComp({ fields });
    await w.find('[data-test="alert-conditions-add-condition-btn"]').trigger("click");
    expect(w.emitted("add")).toBeTruthy();
  });
});

describe("FieldsInput - triggerOperators", () => {
  it("triggerOperators includes = operator", async () => {
    const w = await mountComp();
    expect((w.vm as any).triggerOperators).toContain("=");
  });

  it("triggerOperators includes != operator", async () => {
    const w = await mountComp();
    expect((w.vm as any).triggerOperators).toContain("!=");
  });

  it("triggerOperators includes Contains", async () => {
    const w = await mountComp();
    expect((w.vm as any).triggerOperators).toContain("Contains");
  });

  it("triggerOperators includes NotContains", async () => {
    const w = await mountComp();
    expect((w.vm as any).triggerOperators).toContain("NotContains");
  });

  it("triggerOperators has 8 items", async () => {
    const w = await mountComp();
    expect((w.vm as any).triggerOperators.length).toBe(8);
  });
});

describe("FieldsInput - filterColumns", () => {
  it("filters columns by keyword", async () => {
    const w = await mountComp();
    (w.vm as any).filterColumns("host", (cb: () => void) => cb());
    const values = (w.vm as any).filteredFields.map((f: any) => f.value);
    expect(values).toContain("host");
    expect(values).not.toContain("level");
  });

  it("returns all fields when filter is empty", async () => {
    const w = await mountComp();
    (w.vm as any).filterColumns("", (cb: () => void) => cb());
    expect((w.vm as any).filteredFields).toHaveLength(streamFields.length);
  });

  it("filterColumns is case-insensitive", async () => {
    const w = await mountComp();
    (w.vm as any).filterColumns("HOST", (cb: () => void) => cb());
    expect((w.vm as any).filteredFields.length).toBeGreaterThan(0);
  });
});

describe("FieldsInput - newValueMode computed", () => {
  it("returns empty object when enableNewValueMode=false", async () => {
    const w = await mountComp({ enableNewValueMode: false });
    expect((w.vm as any).newValueMode).toEqual({});
  });

  it("returns new-value-mode object when enableNewValueMode=true", async () => {
    const w = await mountComp({ enableNewValueMode: true });
    expect((w.vm as any).newValueMode).toHaveProperty("new-value-mode", "unique");
  });
});
