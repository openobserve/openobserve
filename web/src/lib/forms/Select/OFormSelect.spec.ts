// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFormSelect from "./OFormSelect.vue";
import OSelect from "./OSelect.vue";
import OForm from "../Form/OForm.vue";

describe("OFormSelect", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: {
        components: { OFormSelect },
      },
    });
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a label when provided", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default: '<OFormSelect name="kind" label="Kind" :options="[]" />',
      },
      global: {
        components: { OFormSelect },
      },
    });
    expect(wrapper.find("label").text()).toBe("Kind");
  });

  // Regression: OFormSelect re-declares `searchable` (a boolean prop). An OMITTED
  // `searchable` must NOT be cast to false and clobber OSelect's `searchable: true`
  // default — otherwise every migrated form select loses its search box.
  it("stays searchable by default (matches OSelect) when not specified", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: { components: { OFormSelect } },
    });
    expect(wrapper.findComponent(OSelect).props("searchable")).toBe(true);
  });

  it("honors an explicit :searchable=\"false\"", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :searchable=\"false\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: { components: { OFormSelect } },
    });
    expect(wrapper.findComponent(OSelect).props("searchable")).toBe(false);
  });
});
