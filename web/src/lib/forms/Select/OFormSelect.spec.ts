// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { z } from "zod";
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

  // Regression (the alerts "Select column" highlight): OFormSelect is the ONLY
  // thing that can paint a name-bound select — it derives `:error` from the
  // field's own errors and deliberately OMITS `error` from its props, so a
  // parent-passed `:error` is swallowed. Any rule that needs to highlight a
  // field must therefore live in the schema. Prove the chain end-to-end for a
  // DEEPLY NESTED path (the alert column is
  // `query_condition.aggregation.having.column`): a schema issue there must
  // reach the underlying OSelect and render, and must stay hidden until submit.
  it("paints the select from a schema issue at a nested path (submit-gated)", async () => {
    const schema = z
      .looseObject({
        query_condition: z.looseObject({}).optional(),
      })
      .superRefine((val: any, ctx) => {
        if (!val.query_condition?.aggregation?.having?.column) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_condition", "aggregation", "having", "column"],
            message: "Column is required when using an aggregate function.",
          });
        }
      });

    wrapper = mount(OForm, {
      props: {
        schema,
        defaultValues: {
          query_condition: { aggregation: { having: { column: "" } } },
        },
      },
      slots: {
        default:
          "<OFormSelect name=\"query_condition.aggregation.having.column\" :options=\"[{label:'f2',value:'field2'}]\" />",
      },
      global: { components: { OFormSelect } },
    });

    // Pre-submit: silent (revalidateLogic mode "submit").
    expect(wrapper.findComponent(OSelect).props("error")).toBeFalsy();

    await (wrapper.vm as any).submit();
    await flushPromises();

    expect(wrapper.findComponent(OSelect).props("error")).toBe(true);
    expect(wrapper.text()).toContain(
      "Column is required when using an aggregate function.",
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
