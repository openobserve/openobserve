// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const percentilesMock = vi.hoisted(() => ({
  fetchPercentiles: vi.fn(),
  cancelFetch: vi.fn(),
}));

vi.mock("@/composables/useDurationPercentiles", async () => {
  const { ref } = await import("vue");
  return {
    default: () => ({
      percentiles: ref({ p25: 1000, p50: 2000, p75: 3000, p95: 4000, p99: 5000, max: 6000 }),
      isLoading: ref(false),
      errMsg: ref(""),
      fetchPercentiles: percentilesMock.fetchPercentiles,
      cancelFetch: percentilesMock.cancelFetch,
    }),
  };
});

import DurationPercentilesBody from "./DurationPercentilesBody.vue";

const request = (overrides: Record<string, unknown> = {}) => ({
  streamName: "default",
  streamType: "traces",
  startTime: 100,
  endTime: 200,
  whereClause: "",
  ...overrides,
});

describe("DurationPercentilesBody", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("fetches the percentiles for the request on mount", () => {
    wrapper = mount(DurationPercentilesBody, { props: { request: request() } });
    expect(percentilesMock.fetchPercentiles).toHaveBeenCalledWith({
      streamName: "default",
      startTime: 100,
      endTime: 200,
      whereClause: "",
    });
  });

  it("cancels and fetches again when only the time range changes", async () => {
    wrapper = mount(DurationPercentilesBody, { props: { request: request() } });
    percentilesMock.fetchPercentiles.mockClear();
    percentilesMock.cancelFetch.mockClear();
    await wrapper.setProps({ request: request({ startTime: 300, endTime: 400 }) });
    await nextTick();
    expect(percentilesMock.cancelFetch).toHaveBeenCalledTimes(1);
    expect(percentilesMock.fetchPercentiles).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: 300, endTime: 400 }),
    );
  });

  it("writes the microsecond value, not a unit string, into the filter", async () => {
    wrapper = mount(DurationPercentilesBody, { props: { request: request() } });
    await wrapper.find('[data-test="field-panel-duration-gte-p95"]').trigger("click");
    await wrapper.find('[data-test="field-panel-duration-lte-max"]').trigger("click");
    expect(wrapper.emitted("add-filter")).toEqual([["duration>=4000"], ["duration<=6000"]]);
    expect(wrapper.find('[data-test="field-panel-duration-gte-max"]').exists()).toBe(false);
  });

  it("cancels the fetch when it unmounts", () => {
    wrapper = mount(DurationPercentilesBody, { props: { request: request() } });
    percentilesMock.cancelFetch.mockClear();
    wrapper.unmount();
    expect(percentilesMock.cancelFetch).toHaveBeenCalledTimes(1);
  });
});
