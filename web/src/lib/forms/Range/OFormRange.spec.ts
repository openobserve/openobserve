// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormRange from "./OFormRange.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

describe("OFormRange", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { priceRange: { min: 20, max: 80 } } },
      slots: {
        default: () =>
          h(OFormRange, {
            name: "priceRange",
            min: 0,
            max: 100,
            label: "Price",
          }),
      },
      global: { components: { OFormRange } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findAll("input[type='range']")).toHaveLength(2);
  });

  it("renders default values from the form", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { priceRange: { min: 15, max: 65 } } },
      slots: {
        default: () =>
          h(OFormRange, { name: "priceRange", min: 0, max: 100 }),
      },
      global: { components: { OFormRange } },
    });
    const inputs = wrapper.findAll("input");
    expect(Number((inputs[0].element as HTMLInputElement).value)).toBe(15);
    expect(Number((inputs[1].element as HTMLInputElement).value)).toBe(65);
  });

  // FormRangeProps extends RangeProps, so these are declared props and never
  // reach $attrs — OFormRange must forward each one by hand. When it didn't,
  // ORange fell back to its defaults and rendered a bare horizontal track with
  // no markers where the anomaly sensitivity slider should have been.
  it("forwards the layout props through to ORange", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { threshold: { min: 0, max: 100 } } },
      slots: {
        default: () =>
          h(OFormRange, {
            name: "threshold",
            min: 0,
            max: 100,
            vertical: true,
            reverse: true,
            labelAlways: true,
            markers: true,
            markerLabels: [
              { value: 0, label: "0" },
              { value: 50, label: "50" },
              { value: 100, label: "100" },
            ],
          }),
      },
      global: { components: { OFormRange } },
    });

    const range = wrapper.findComponent({ name: "ORange" });
    expect(range.props("vertical")).toBe(true);
    expect(range.props("reverse")).toBe(true);
    expect(range.props("labelAlways")).toBe(true);
    expect(range.props("markers")).toBe(true);
    expect(range.props("markerLabels")).toHaveLength(3);
    // ...and the markers actually render, not just arrive as props.
    expect(wrapper.text()).toContain("50");
  });

  it("shows schema error after submit when the range is too narrow", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { priceRange: { min: 10, max: 20 } },
        schema: z.object({
          priceRange: z
            .object({ min: z.number(), max: z.number() })
            .refine((r) => r.max - r.min >= 30, "Range too narrow"),
        }),
      },
      slots: {
        default: () =>
          h(OFormRange, { name: "priceRange", min: 0, max: 100 }),
      },
      global: { components: { OFormRange } },
    });
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("Range too narrow");
  });
});
