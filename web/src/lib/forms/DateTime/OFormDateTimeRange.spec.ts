// Copyright 2026 OpenObserve Inc.
//
// Foundation tests for OFormDateTimeRange — the OForm* wrapper around the
// DateTime range picker. DateTime is stubbed with a component that reads its
// `default-*` props ONCE at setup (mirroring the real component), so the tests
// genuinely exercise: (a) seeding from the field value, (b) translating
// on:date-change into the form's timerange object, and (c) the remount-on-reset
// behavior that lets a once-read picker pick up an externally-changed value.

import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormDateTimeRange from "./OFormDateTimeRange.vue";

// Stub that reads default-* ONCE at setup (like the real DateTime) and can emit
// an on:date-change with a controllable payload.
const DateTimeStub = defineComponent({
  name: "DateTime",
  props: ["defaultType", "defaultAbsoluteTime", "defaultRelativeTime"],
  emits: ["on:date-change"],
  setup(props, { emit }) {
    // captured ONCE — does not react to later prop changes (only a remount updates it)
    const capturedType = props.defaultType;
    const capturedPeriod = props.defaultRelativeTime;
    const fire = () =>
      emit("on:date-change", {
        valueType: "absolute",
        startTime: 100,
        endTime: 200,
        relativeTimePeriod: null,
      });
    return { capturedType, capturedPeriod, fire };
  },
  template: `<button data-test="dt-stub" @click="fire">{{ capturedType }}|{{ capturedPeriod }}</button>`,
});

function mountForm(defaultValues: Record<string, unknown>) {
  return mount(OForm, {
    props: { defaultValues },
    slots: { default: '<OFormDateTimeRange name="timerange" />' },
    global: {
      components: { OFormDateTimeRange },
      stubs: { DateTime: DateTimeStub },
    },
  });
}

describe("OFormDateTimeRange", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("seeds the picker's default-* from the field value", () => {
    wrapper = mountForm({
      timerange: { type: "relative", period: "1h", from: 0, to: 0 },
    });
    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|1h");
  });

  it("translates on:date-change into the form's timerange object", async () => {
    wrapper = mountForm({
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    });
    await wrapper.find('[data-test="dt-stub"]').trigger("click");
    await flushPromises();
    expect((wrapper.vm as any).form.state.values.timerange).toEqual({
      type: "absolute",
      from: 100,
      to: 200,
      period: "30m",
    });
  });

  it("remounts the picker when the field value is reset externally (prefill)", async () => {
    wrapper = mountForm({
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    });
    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|30m");

    // Simulate async edit-prefill arriving after mount.
    (wrapper.vm as any).form.reset({
      timerange: { type: "relative", period: "6h", from: 0, to: 0 },
    });
    await nextTick();
    await flushPromises();

    // The once-read stub only reflects the new period if it was remounted.
    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|6h");
  });

  it("does NOT remount on the user's own change (no remount loop)", async () => {
    wrapper = mountForm({
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    });
    // User change → field becomes absolute, but the stub must NOT remount
    // (its captured values stay at the mount-time relative|30m).
    await wrapper.find('[data-test="dt-stub"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|30m");
  });

  // Regression: the wrapper is used with INDEXED/NESTED names
  // (`dashboards[0].timerange`). A flat `values[name]` lookup would read
  // `undefined` and never remount on external prefill; the path resolver fixes it.
  it("remounts on external reset for an indexed/nested field name", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: {
          dashboards: [
            { timerange: { type: "relative", period: "30m", from: 0, to: 0 } },
          ],
        },
      },
      slots: {
        default: '<OFormDateTimeRange name="dashboards[0].timerange" />',
      },
      global: {
        components: { OFormDateTimeRange },
        stubs: { DateTime: DateTimeStub },
      },
    });
    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|30m");

    (wrapper.vm as any).form.reset({
      dashboards: [
        { timerange: { type: "relative", period: "12h", from: 0, to: 0 } },
      ],
    });
    await nextTick();
    await flushPromises();

    expect(wrapper.find('[data-test="dt-stub"]').text()).toBe("relative|12h");
  });
});
