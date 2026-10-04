import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import Profiles from "@/plugins/profiles/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mocks = vi.hoisted(() => ({
  nowMs: 1_700_000_000_000,
  nameList: vi.fn(),
  meta: vi.fn(),
  series: vi.fn(),
  merge: vi.fn(),
  tagValues: vi.fn(),
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

vi.mock("@/services/profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/profiles")>()),
  default: {
    meta: mocks.meta,
    series: mocks.series,
    merge: mocks.merge,
    tagValues: mocks.tagValues,
  },
}));

const route = reactive({ name: "profiles", query: {} as Record<string, string> });

vi.mock("vue-router", () => ({
  useRoute: () => route,
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
    label_names: ["k8s_pod_name", "process_name"],
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
    total: 30,
    merged_total: 30,
    truncated: false,
    root: {
      name: "root",
      self: 0,
      total: 30,
      children: [],
    },
    top: [
      { name: "fn-a", self: 10, total: 20 },
      { name: "fn-b", self: 5, total: 30 },
      { name: "fn-c", self: 15, total: 15 },
    ],
    took: 1,
  },
};

// The route is shared module state, so a page left mounted would re-seed on another test's route change.
enableAutoUnmount(afterEach);

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
    OIcon: true,
    OTag: {
      template: "<div><slot /><slot name='trailing' /></div>",
    },
    OTooltip: true,
    OEmptyState: {
      template: '<div data-test="profiles-no-results">No Profiles found</div>',
    },
    OSpinner: true,
    OSearchInput: {
      template:
        '<input :value="modelValue" :data-test="$attrs[\'data-test\']" @input="$emit(\'update:modelValue\', $event.target.value)" />',
      props: ["modelValue", "placeholder"],
      emits: ["update:modelValue"],
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
    route.query = {};
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
    mocks.tagValues.mockResolvedValue({
      data: { tag: "k8s_pod_name", values: ["pod-a", "pod-b"], took: 1 },
    });
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
        service_name: "service-a",
      }),
    );
    expect(lastSeriesCall[2].data_source).toBeUndefined();
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

  it("loads tag values and applies a filter to the next query", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await flushPromises();
    await nextTick();

    expect(mocks.tagValues).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({ tag: "k8s_pod_name" }),
    );

    await wrapper.find('[data-test="profiles-tag-value-select"] select').setValue("pod-a");
    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-applied-filters"]').exists()).toBe(true);
    const lastSeriesPayload = mocks.series.mock.calls[mocks.series.mock.calls.length - 1][2];
    expect(lastSeriesPayload.filters).toEqual([{ key: "k8s_pod_name", op: "=", value: "pod-a" }]);
  });

  it("reloads tag values when the service or profile type changes", async () => {
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        services: ["service-a", "service-b"],
        profile_types: [
          { type: "cpu", unit: "nanoseconds" },
          { type: "heap", unit: "bytes" },
        ],
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await flushPromises();
    await nextTick();
    mocks.tagValues.mockClear();

    await wrapper.find('[data-test="profiles-service-select"] select').setValue("service-b");
    await flushPromises();
    await nextTick();

    expect(mocks.tagValues).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({ service_name: "service-b", tag: "k8s_pod_name" }),
    );

    mocks.tagValues.mockClear();
    await wrapper.find('[data-test="profiles-type-select"] select').setValue("heap\u0000bytes");
    await flushPromises();
    await nextTick();

    expect(mocks.tagValues).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({
        profile_type: "heap",
        profile_unit: "bytes",
        tag: "k8s_pod_name",
      }),
    );
  });

  it("drops tag values that arrive after the draft tag is cleared", async () => {
    let resolveTag:
      ((value: { data: { tag: string; values: string[]; took: number } }) => void) | undefined;
    mocks.tagValues.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTag = resolve;
        }),
    );

    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-b");
    await flushPromises();
    await nextTick();

    resolveTag?.({ data: { tag: "k8s_pod_name", values: ["stale-pod"], took: 1 } });
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-tag-value-select"]').text()).not.toContain(
      "stale-pod",
    );
  });

  it("sorts the top table by Self when the column header is clicked", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-view-top"]').trigger("click");
    await nextTick();

    const namesBefore = wrapper
      .findAll("tbody tr")
      .map((row) => row.find("td").text())
      .filter(Boolean);
    expect(namesBefore[0]).toBe("fn-b");

    await wrapper.find('[data-test="profiles-sort-self"]').trigger("click");
    await nextTick();

    const namesAfter = wrapper
      .findAll("tbody tr")
      .map((row) => row.find("td").text())
      .filter(Boolean);
    expect(namesAfter[0]).toBe("fn-c");
  });

  describe("seeded from the route", () => {
    const FROM = 1_700_000_000_000_000;
    const TO = 1_700_000_120_000_000;
    const seedQuery = {
      stream: "profiles-b",
      from: String(FROM),
      to: String(TO),
      service_name: "service-b",
      profile_type: "cpu",
      profile_unit: "nanoseconds",
      filters: "trace_id=t%2C1,span_id=s1",
      view: "flame",
    };
    const seededFilters = [
      { key: "trace_id", op: "=", value: "t,1" },
      { key: "span_id", op: "=", value: "s1" },
    ];
    // Like the real picker, it re-emits its model on mount.
    const emittingPicker = {
      props: ["modelValue"],
      emits: ["update:modelValue"],
      mounted(this: { modelValue: object; $emit: (e: string, v: object) => void }) {
        this.$emit("update:modelValue", { ...this.modelValue });
      },
      template: "<div />",
    };

    const mountSeeded = () =>
      mount(Profiles, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: { ...pageStubs, DateTimePickerDashboard: emittingPicker },
        },
      });

    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };

    beforeEach(() => {
      route.query = { ...seedQuery };
      mocks.meta.mockResolvedValue({
        data: {
          ...profileMetaResponse.data,
          services: ["service-a", "service-b"],
          profile_types: [
            { type: "alloc_space", unit: "bytes" },
            { type: "cpu", unit: "nanoseconds" },
          ],
        },
      });
    });

    it("seeds stream, service, type, filters and the flame view through the org watcher's initPage", async () => {
      const wrapper = mountSeeded();
      await flushPromises();

      expect(
        (wrapper.find('[data-test="profiles-stream-select"] select').element as HTMLSelectElement)
          .value,
      ).toBe("profiles-b");
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-b",
        expect.objectContaining({
          start_time: FROM,
          end_time: TO,
          service_name: "service-b",
          profile_type: "cpu",
          profile_unit: "nanoseconds",
          filters: seededFilters,
        }),
      );
      expect(wrapper.find('[data-test="profiles-filter-chip-trace_id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-filter-chip-span_id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-view-flame"]').attributes("variant")).toBe(
        "primary",
      );
    });

    it("loads metadata for the seeded window", async () => {
      mountSeeded();
      await flushPromises();
      expect(mocks.meta).toHaveBeenCalledWith(orgIdentifier, "profiles-b", {
        start_time: FROM,
        end_time: TO,
      });
    });

    it("loads metadata once and queries once, even with delayed responses", async () => {
      const names = deferred<typeof streamResponse>();
      const meta = deferred<unknown>();
      mocks.nameList.mockReturnValueOnce(names.promise);
      mocks.meta.mockReturnValueOnce(meta.promise);
      const wrapper = mountSeeded();
      await flushPromises();
      names.resolve(streamResponse);
      await flushPromises();
      meta.resolve({
        data: {
          ...profileMetaResponse.data,
          services: ["service-a", "service-b"],
          profile_types: [{ type: "cpu", unit: "nanoseconds" }],
        },
      });
      await flushPromises();

      expect(mocks.meta).toHaveBeenCalledTimes(1);
      expect(mocks.series).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="profiles-filter-chip-trace_id"]').exists()).toBe(true);
    });

    it("re-seeds when the route query changes", async () => {
      mountSeeded();
      await flushPromises();
      mocks.merge.mockClear();

      route.query = { ...seedQuery, stream: "profiles-a", filters: "trace_id=t2,span_id=s2" };
      await flushPromises();

      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-a",
        expect.objectContaining({
          filters: [
            { key: "trace_id", op: "=", value: "t2" },
            { key: "span_id", op: "=", value: "s2" },
          ],
        }),
      );
    });

    it("applies only the latest seed when the route changes while an earlier seed is loading", async () => {
      const names = deferred<typeof streamResponse>();
      mocks.nameList.mockReturnValueOnce(names.promise);
      mountSeeded();
      await flushPromises();

      route.query = { ...seedQuery, stream: "profiles-a", filters: "trace_id=t2,span_id=s2" };
      await flushPromises();
      names.resolve(streamResponse);
      await flushPromises();

      expect(mocks.series).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-a",
        expect.objectContaining({
          filters: [
            { key: "trace_id", op: "=", value: "t2" },
            { key: "span_id", op: "=", value: "s2" },
          ],
        }),
      );
    });

    it("returns to the default stream and 15-minute window when the seed is dropped", async () => {
      const wrapper = mountSeeded();
      await flushPromises();
      mocks.meta.mockClear();
      mocks.merge.mockClear();

      route.query = {};
      await flushPromises();

      const window = {
        start_time: (mocks.nowMs - 15 * 60 * 1000) * 1000,
        end_time: mocks.nowMs * 1000,
      };
      expect(
        (wrapper.find('[data-test="profiles-stream-select"] select').element as HTMLSelectElement)
          .value,
      ).toBe("profiles-a");
      expect(mocks.meta).toHaveBeenCalledTimes(1);
      expect(mocks.meta).toHaveBeenCalledWith(orgIdentifier, "profiles-a", window);
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-a",
        expect.objectContaining({ ...window, filters: [] }),
      );
    });

    it("keeps the default first stream, 15-minute window and top view without params", async () => {
      route.query = {};
      const wrapper = mountSeeded();
      await flushPromises();

      expect(mocks.meta.mock.calls[0][1]).toBe("profiles-a");
      expect(mocks.meta.mock.calls[0][2]).toEqual({
        start_time: (mocks.nowMs - 15 * 60 * 1000) * 1000,
        end_time: mocks.nowMs * 1000,
      });
      expect(wrapper.find('[data-test="profiles-applied-filters"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-view-top"]').attributes("variant")).toBe("primary");
    });
  });
});
