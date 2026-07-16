// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFormSelect from "./OFormSelect.vue";
import OSelect from "./OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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

  // Regression: OFormSelect must forward every OSelect prop it re-declares.
  // `loading` (the async spinner) was declared on FormSelectProps but missing
  // from the manual forward list, so it was stripped from $attrs and never
  // reached OSelect — the loader silently disappeared after OSelect→OFormSelect
  // migration. Assert it (and a couple of other previously-dropped props) pass
  // through so the spinner renders during API calls.
  it("forwards `loading` through to OSelect", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :loading=\"true\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: { components: { OFormSelect } },
    });
    expect(wrapper.findComponent(OSelect).props("loading")).toBe(true);
    // The chevron is swapped for the spinner when loading.
    expect(wrapper.findComponent(OSelect).findComponent(OSpinner).exists()).toBe(
      true,
    );
  });

  it("forwards other re-declared props (optionTooltip, labelPosition) through to OSelect", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :option-tooltip=\"true\" label-position=\"inside\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: { components: { OFormSelect } },
    });
    expect(wrapper.findComponent(OSelect).props("optionTooltip")).toBe(true);
    expect(wrapper.findComponent(OSelect).props("labelPosition")).toBe(
      "inside",
    );
  });
});
