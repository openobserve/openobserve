import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import Profiles from "@/plugins/profiles/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mocks = vi.hoisted(() => ({
  nowMs: 1_700_000_000_000,
  nameList: vi.fn(),
  meta: vi.fn(),
  series: vi.fn(),
  merge: vi.fn(),
  getConsumableRelativeTime: vi.fn(() => {
    const end = mocks.nowMs;
    return {
      startTime: (end - 15 * 60 * 1000) * 1000,
      endTime: end * 1000,
    };
  }),
}));

vi.mock("@/services/stream", () => ({
  default: {
    nameList: mocks.nameList,
  },
}));

vi.mock("@/services/profiles", () => ({
  default: {
    meta: mocks.meta,
    series: mocks.series,
    merge: mocks.merge,
  },
}));

vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: mocks.getConsumableRelativeTime,
}));

const streamResponse = {
  data: {
    list: [{ name: "profiles-a" }, { name: "profiles-b" }],
  },
};

const profileMetaResponse = {
  data: {
    data_sources: ["collector-a"],
    services: ["service-a"],
    profile_types: [{ type: "cpu", unit: "nanoseconds" }],
    label_names: ["service.name"],
    took: 1,
  },
};

const seriesResponse = {
  data: {
    unit: "nanoseconds",
    profile_type: "cpu",
    step_secs: 60,
    series: [],
    took: 1,
  },
};

const mergeResponse = {
  data: {
    unit: "nanoseconds",
    profile_type: "cpu",
    total: 10,
    merged_total: 10,
    truncated: false,
    root: {
      name: "root",
      self: 10,
      total: 10,
      children: [],
    },
    top: [{ name: "root", self: 10, total: 10 }],
    took: 1,
  },
};

describe("Profiles page", () => {
  const orgIdentifier = store.state.selectedOrganization.identifier as string;

  const pageStubs = {
    ChartRenderer: true,
    CommonFlameGraph: true,
    DateTimePickerDashboard: true,
    OButton: {
      template: "<button><slot /></button>",
    },
    OContent: {
      template: "<div><slot /></div>",
    },
    OSelect: {
      template:
        '<div :data-test="$attrs[\'data-test\']"><select :value="modelValue ?? \'\'" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>',
      props: ["modelValue", "options", "label", "disabled", "clearable", "loading"],
      emits: ["update:modelValue"],
    },
  };

  const mountPage = () =>
    mount(Profiles, {
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: pageStubs,
      },
    });

  const mergeFor = (name: string) => ({
    data: {
      ...mergeResponse.data,
      root: { ...mergeResponse.data.root, name },
      top: [{ name, self: 10, total: 10 }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nowMs = 1_700_000_000_000;
    mocks.getConsumableRelativeTime.mockImplementation(() => {
      const end = mocks.nowMs;
      return {
        startTime: (end - 15 * 60 * 1000) * 1000,
        endTime: end * 1000,
      };
    });
    mocks.nameList.mockResolvedValue(streamResponse);
    mocks.meta.mockResolvedValue(profileMetaResponse);
    mocks.series.mockResolvedValue(seriesResponse);
    mocks.merge.mockResolvedValue(mergeFor("fn-a"));
  });

  it("shows an explicit stream selector and loads the first stream by default", async () => {
    const wrapper = mountPage();

    await flushPromises();
    await nextTick();

    expect(mocks.nameList).toHaveBeenCalledWith(orgIdentifier, "profiles", false);
    expect(wrapper.find('[data-test="profiles-stream-select"]').exists()).toBe(true);
    expect(
      (wrapper.find('[data-test="profiles-stream-select"] select').element as HTMLSelectElement)
        .value,
    ).toBe("profiles-a");
    const firstMetaCall = mocks.meta.mock.calls[0];
    expect(firstMetaCall[0]).toBe(orgIdentifier);
    expect(firstMetaCall[1]).toBe("profiles-a");
    expect(firstMetaCall[2]).toEqual(
      expect.objectContaining({
        start_time: expect.any(Number),
        end_time: expect.any(Number),
      }),
    );
  });

  it("switches to another stream from the selector", async () => {
    const wrapper = mountPage();

    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-b");
    await flushPromises();
    await nextTick();

    const lastMetaCall = mocks.meta.mock.calls[mocks.meta.mock.calls.length - 1];
    expect(lastMetaCall[0]).toBe(orgIdentifier);
    expect(lastMetaCall[1]).toBe("profiles-b");
    expect(lastMetaCall[2]).toEqual(
      expect.objectContaining({
        start_time: expect.any(Number),
        end_time: expect.any(Number),
      }),
    );

    const lastSeriesCall = mocks.series.mock.calls[mocks.series.mock.calls.length - 1];
    expect(lastSeriesCall[0]).toBe(orgIdentifier);
    expect(lastSeriesCall[1]).toBe("profiles-b");
    expect(lastSeriesCall[2]).toEqual(
      expect.objectContaining({
        data_source: "collector-a",
        service_name: "service-a",
      }),
    );
  });

  it("recomputes relative time when running a query again", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    const firstEnd = mocks.series.mock.calls[0][2].end_time;
    mocks.nowMs += 5 * 60 * 1000;

    await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
    await flushPromises();
    await nextTick();

    const lastSeriesPayload = mocks.series.mock.calls[mocks.series.mock.calls.length - 1][2];
    const lastMergePayload = mocks.merge.mock.calls[mocks.merge.mock.calls.length - 1][2];
    expect(lastSeriesPayload.end_time - firstEnd).toBe(5 * 60 * 1000 * 1000);
    expect(lastMergePayload.end_time).toBe(lastSeriesPayload.end_time);
    expect(lastMergePayload.start_time).toBe(lastSeriesPayload.start_time);
  });

  it("does not apply a stale query after switching streams", async () => {
    let resolveBSeries: ((value: typeof seriesResponse) => void) | undefined;
    let resolveBMerge: ((value: ReturnType<typeof mergeFor>) => void) | undefined;
    mocks.series.mockImplementation((_org: string, stream: string) => {
      if (stream === "profiles-b") {
        return new Promise((resolve) => {
          resolveBSeries = resolve;
        });
      }
      return Promise.resolve(seriesResponse);
    });
    mocks.merge.mockImplementation((_org: string, stream: string) => {
      if (stream === "profiles-b") {
        return new Promise((resolve) => {
          resolveBMerge = resolve;
        });
      }
      return Promise.resolve(mergeFor("fn-a"));
    });

    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-b");
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-a");
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain("fn-a");
    resolveBSeries?.(seriesResponse);
    resolveBMerge?.(mergeFor("fn-b"));
    await flushPromises();
    await nextTick();

    expect(
      (wrapper.find('[data-test="profiles-stream-select"] select').element as HTMLSelectElement)
        .value,
    ).toBe("profiles-a");
    expect(wrapper.text()).toContain("fn-a");
    expect(wrapper.text()).not.toContain("fn-b");
  });
});
