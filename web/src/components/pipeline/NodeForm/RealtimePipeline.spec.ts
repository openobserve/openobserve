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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

// Stub FieldsInput to avoid pulling in its full dependency tree
const FieldsInputStub = {
  name: "FieldsInput",
  template: '<div data-test="fields-input-stub"></div>',
  props: ["streamFields", "fields", "enableNewValueMode"],
  emits: ["add", "remove", "input:update"],
};

import RealtimePipeline from "./RealtimePipeline.vue";

const defaultColumns = [
  { label: "Host", value: "host" },
  { label: "Level", value: "level" },
];

const defaultConditions = [
  { uuid: "abc", column: "host", operator: "=", value: "localhost" },
];

function createWrapper(
  props: Record<string, any> = {},
  stubReal = true
): VueWrapper<any> {
  return mount(RealtimePipeline, {
    props: {
      columns: defaultColumns,
      conditions: defaultConditions,
      enableNewValueMode: false,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: stubReal
        ? { FieldsInput: FieldsInputStub }
        : {},
    },
  });
}

describe("RealtimePipeline - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = createWrapper();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the FieldsInput stub", () => {
    expect(wrapper.find('[data-test="fields-input-stub"]').exists()).toBe(true);
  });

  it("renders a single FieldsInput component", () => {
    const stubs = wrapper.findAllComponents(FieldsInputStub);
    expect(stubs).toHaveLength(1);
  });
});

describe("RealtimePipeline - prop forwarding", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes columns as stream-fields prop to FieldsInput", () => {
    const wrapper = createWrapper();
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("streamFields")).toEqual(defaultColumns);
    wrapper.unmount();
  });

  it("passes conditions as fields prop to FieldsInput", () => {
    const wrapper = createWrapper();
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("fields")).toEqual(defaultConditions);
    wrapper.unmount();
  });

  it("passes enableNewValueMode=false to FieldsInput", () => {
    const wrapper = createWrapper({ enableNewValueMode: false });
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("enableNewValueMode")).toBe(false);
    wrapper.unmount();
  });

  it("passes enableNewValueMode=true to FieldsInput", () => {
    const wrapper = createWrapper({ enableNewValueMode: true });
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("enableNewValueMode")).toBe(true);
    wrapper.unmount();
  });

  it("forwards an empty columns array as stream-fields", () => {
    const wrapper = createWrapper({ columns: [] });
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("streamFields")).toEqual([]);
    wrapper.unmount();
  });

  it("forwards an empty conditions array as fields", () => {
    const wrapper = createWrapper({ conditions: [] });
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    expect(fieldsInput.props("fields")).toEqual([]);
    wrapper.unmount();
  });
});

describe("RealtimePipeline - emit: 'add' from FieldsInput", () => {
  let wrapper: VueWrapper<any>;
  const field = { uuid: "new-1", column: "level", operator: "=", value: "error" };

  beforeEach(() => {
    wrapper = createWrapper();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("emits 'field:add' when FieldsInput emits 'add'", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("add", field);
    await nextTick();
    expect(wrapper.emitted("field:add")).toBeTruthy();
    expect((wrapper.emitted("field:add") as any[][])[0][0]).toEqual(field);
  });

  it("emits 'input:update' with ('conditions', field) when FieldsInput emits 'add'", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("add", field);
    await nextTick();
    expect(wrapper.emitted("input:update")).toBeTruthy();
    const payload = (wrapper.emitted("input:update") as any[][])[0];
    expect(payload[0]).toBe("conditions");
    expect(payload[1]).toEqual(field);
  });

  it("emits both 'field:add' and 'input:update' on a single 'add' event", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("add", field);
    await nextTick();
    expect(wrapper.emitted("field:add")).toHaveLength(1);
    expect(wrapper.emitted("input:update")).toHaveLength(1);
  });
});

describe("RealtimePipeline - emit: 'remove' from FieldsInput", () => {
  let wrapper: VueWrapper<any>;
  const field = { uuid: "rm-1", column: "host", operator: "!=", value: "bad-host" };

  beforeEach(() => {
    wrapper = createWrapper();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("emits 'field:remove' when FieldsInput emits 'remove'", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("remove", field);
    await nextTick();
    expect(wrapper.emitted("field:remove")).toBeTruthy();
    expect((wrapper.emitted("field:remove") as any[][])[0][0]).toEqual(field);
  });

  it("emits 'input:update' with ('conditions', field) when FieldsInput emits 'remove'", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("remove", field);
    await nextTick();
    expect(wrapper.emitted("input:update")).toBeTruthy();
    const payload = (wrapper.emitted("input:update") as any[][])[0];
    expect(payload[0]).toBe("conditions");
    expect(payload[1]).toEqual(field);
  });

  it("emits both 'field:remove' and 'input:update' on a single 'remove' event", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    await fieldsInput.vm.$emit("remove", field);
    await nextTick();
    expect(wrapper.emitted("field:remove")).toHaveLength(1);
    expect(wrapper.emitted("input:update")).toHaveLength(1);
  });
});

describe("RealtimePipeline - emit: 'input:update' passthrough from FieldsInput", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = createWrapper();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("re-emits 'input:update' when FieldsInput emits 'input:update'", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    const field = { uuid: "upd-1", column: "level", operator: "=", value: "warn" };
    await fieldsInput.vm.$emit("input:update", "someField", field);
    await nextTick();
    expect(wrapper.emitted("input:update")).toBeTruthy();
  });

  it("re-emits 'input:update' with the same arguments from FieldsInput", async () => {
    const fieldsInput = wrapper.findComponent(FieldsInputStub);
    const field = { uuid: "upd-2", column: "message", operator: "Contains", value: "error" };
    await fieldsInput.vm.$emit("input:update", "conditions", field);
    await nextTick();
    const emitted = wrapper.emitted("input:update") as any[][];
    expect(emitted[0][0]).toBe("conditions");
    expect(emitted[0][1]).toEqual(field);
  });
});

describe("RealtimePipeline - no FieldsInput rendered with empty columns", () => {
  it("FieldsInput still renders when columns is an empty array", () => {
    const wrapper = createWrapper({ columns: [], conditions: [] });
    // The component always renders FieldsInput — it just receives empty props
    expect(wrapper.find('[data-test="fields-input-stub"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
