import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive, ref, watch } from "vue";
import Profiles from "@/plugins/profiles/Index.vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
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
// The page writes its state back with replace(); the fake router applies it to the route as the real one does.
const router = {
  replace: vi.fn(async ({ query }: { query: Record<string, string> }) => {
    route.query = query;
  }),
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => router,
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

// Lets requests resolve, then waits out OTable's minimum skeleton time (50 ms) so rows are drawn.
/** The row menu button of a Top Table function, found by name: rows sort by Self, so the order varies per test. */
const topRowMenu = (wrapper: VueWrapper, name: string) =>
  wrapper
    .findAll("tbody tr")
    .find((row) => row.find("td").text().includes(name))!
    .find('[data-test^="profiles-top-row-"][data-test$="-menu"]');

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await nextTick();
};

// The route is shared module state, so a page left mounted would re-seed on another test's route change.
enableAutoUnmount(afterEach);

describe("Profiles page", () => {
  const orgIdentifier = store.state.selectedOrganization.identifier as string;

  const pageStubs = {
    ChartRenderer: { name: "ChartRendererStub", props: ["data"], template: "<div />" },
    CommonFlameGraph: true,
    ShareButton: true,
    // The page calls these on the mounted picker.
    DateTimePickerDashboard: {
      name: "DateTimePickerDashboard",
      props: ["modelValue", "autoApplyDashboard", "hideRangeShift"],
      methods: { setSavedDate: () => {}, setCustomDate: () => {}, refresh: () => {} },
      template: "<div />",
    },
    OButton: {
      template: "<button><slot /></button>",
    },
    OContent: {
      template: "<div><slot /></div>",
    },
    ODropdown: {
      props: ["open"],
      emits: ["update:open"],
      template:
        "<div><div @click=\"$emit('update:open', !open)\"><slot name='trigger' /></div><slot v-if='open' /></div>",
    },
    ODropdownItem: {
      emits: ["select"],
      template: "<button @click=\"$emit('select')\"><slot /></button>",
    },
    OPageLayout: {
      template:
        "<div><slot name='title' /><slot name='actions' /><slot name='subnav' /><slot /></div>",
    },
    OIcon: true,
    OTag: {
      template: "<div><slot /><slot name='trailing' /></div>",
    },
    // Renders its slot: OTable wraps the sortable header button in a tooltip.
    OTooltip: { template: "<span><slot /></span>" },
    // Shows the preset and description, and emits the first action like a click on its card.
    OEmptyState: {
      props: ["preset", "title", "description", "actions"],
      emits: ["action"],
      template:
        '<div :data-preset="preset"><span>{{ description }}</span><button data-test="empty-state-action" @click="$emit(\'action\', actions?.[0]?.id ?? \'retry\')" /></div>',
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
    // Most tests expect a changed input to run the query, which needs Auto Run on (server flag plus switch).
    store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: true };
    localStorage.removeItem("oo_toggle_auto_run");
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

  it("runs the query once when the page opens", async () => {
    mountPage();
    await flushPromises();
    await nextTick();

    // Once to learn the services, once more for the picked service's profile types.
    expect(mocks.meta).toHaveBeenCalledTimes(2);
    expect(mocks.meta.mock.calls[1][2]).toMatchObject({ service_name: "service-a" });
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.series).toHaveBeenCalledTimes(1);
  });

  it("runs the query once when the page opens with the real date picker", async () => {
    // The real picker replays its value on mount, which must not start a second run.
    const { DateTimePickerDashboard: _picker, ...stubs } = pageStubs;
    const wrapper = mount(Profiles, { global: { plugins: [i18n], provide: { store }, stubs } });
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(wrapper.findComponent({ name: "DateTime" }).exists()).toBe(true);
    expect(mocks.meta).toHaveBeenCalledTimes(2);
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.series).toHaveBeenCalledTimes(1);
  });

  it("shows a load error with Retry when the stream list fails, and recovers", async () => {
    mocks.nameList.mockRejectedValueOnce(new Error("stream list down"));
    const wrapper = mountPage();
    await settle();

    const error = wrapper.find('[data-test="profiles-error"]');
    expect(error.attributes("data-preset")).toBe("load-error");
    expect(error.text()).toContain("stream list down");
    expect(wrapper.find('[data-test="profiles-no-stream"]').exists()).toBe(false);

    await error.find('[data-test="empty-state-action"]').trigger("click");
    await flushPromises();
    await nextTick();
    expect(mocks.nameList).toHaveBeenCalledTimes(2);
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="profiles-error"]').exists()).toBe(false);
  });

  it("links to the Data Sources profiles page when there are no profile streams", async () => {
    mocks.nameList.mockResolvedValueOnce({ data: { list: [] } });
    const wrapper = mountPage();
    await settle();

    // Nothing to run: Run query and its options dim together.
    expect(wrapper.find('[data-test="profiles-run-query"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="profiles-run-options"]').attributes("disabled")).toBeDefined();

    const empty = wrapper.find('[data-test="profiles-no-stream"]');
    expect(empty.attributes("data-preset")).toBe("no-streams");
    await empty.find('[data-test="empty-state-action"]').trigger("click");
    expect(router.push).toHaveBeenCalledWith({
      name: "ingestProfiles",
      query: { org_identifier: orgIdentifier },
    });
  });

  it("keeps the results and shows a banner when a re-run fails", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    mocks.merge.mockRejectedValueOnce(new Error("merge timed out"));
    await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-error-banner"]').text()).toContain("merge timed out");
    expect(wrapper.find('[data-test="profiles-top-table"]').exists()).toBe(true);
  });

  it("picks CPU as the default profile type when the stream has it", async () => {
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        profile_types: [
          { type: "alloc_objects", unit: "count" },
          { type: "alloc_space", unit: "bytes" },
          { type: "cpu", unit: "nanoseconds" },
        ],
      },
    });
    mountPage();
    await flushPromises();
    await nextTick();

    expect(mocks.merge.mock.calls[0][2]).toMatchObject({
      profile_type: "cpu",
      profile_unit: "nanoseconds",
    });
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
    await settle();

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
    await settle();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-b");
    await flushPromises();
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-a");
    await settle();

    expect(wrapper.text()).toContain("fn-a");
    resolveBSeries?.(seriesResponse);
    resolveBMerge?.(mergeFor("fn-b"));
    await settle();

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
    await settle();

    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
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
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-filter-chip-k8s_pod_name"]').exists()).toBe(true);
    const lastSeriesPayload = mocks.series.mock.calls[mocks.series.mock.calls.length - 1][2];
    expect(lastSeriesPayload.filters).toEqual([{ key: "k8s_pod_name", op: "=", value: "pod-a" }]);
  });

  it("keeps one filter per label, because the server joins filters with AND", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    for (const value of ["pod-a", "pod-b"]) {
      await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
      await nextTick();
      await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
      await flushPromises();
      await wrapper.find('[data-test="profiles-tag-value-select"] select').setValue(value);
      await flushPromises();
      await nextTick();
    }

    expect(wrapper.findAll('[data-test="profiles-filter-chip-k8s_pod_name"]')).toHaveLength(1);
    const lastSeriesPayload = mocks.series.mock.calls[mocks.series.mock.calls.length - 1][2];
    expect(lastSeriesPayload.filters).toEqual([{ key: "k8s_pod_name", op: "=", value: "pod-b" }]);
  });

  it("edits a filter chip in place, without narrowing its own value list", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await flushPromises();
    await wrapper.find('[data-test="profiles-tag-value-select"] select').setValue("pod-a");
    await flushPromises();
    await nextTick();
    mocks.tagValues.mockClear();

    await wrapper.find('[data-test="profiles-filter-edit-k8s_pod_name"]').trigger("click");
    await flushPromises();
    await nextTick();

    expect(mocks.tagValues).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({ tag: "k8s_pod_name", filters: [] }),
    );

    await wrapper.find('[data-test="profiles-tag-value-select"] select').setValue("pod-b");
    await flushPromises();
    await nextTick();

    const lastSeriesPayload = mocks.series.mock.calls[mocks.series.mock.calls.length - 1][2];
    expect(lastSeriesPayload.filters).toEqual([{ key: "k8s_pod_name", op: "=", value: "pod-b" }]);
  });

  it("steps the bytes axis on round binary values in the table's binary units", async () => {
    const gib = 1024 ** 3;
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        profile_types: [{ type: "alloc_space", unit: "bytes" }],
      },
    });
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        unit: "bytes",
        profile_type: "alloc_space",
        series: [
          { timestamp: 1_000_000, value: 5.8 * gib },
          { timestamp: 2_000_000, value: 6.3 * gib },
        ],
      },
    });
    mocks.merge.mockResolvedValue({
      data: { ...mergeResponse.data, unit: "bytes", profile_type: "alloc_space" },
    });
    const wrapper = mountPage();
    await settle();

    const chart = wrapper.findComponent({ name: "ChartRendererStub" });
    const yAxis = chart.props("data").options.yAxis;
    expect(yAxis.interval).toBe(2.5 * gib);
    expect(yAxis.axisLabel.formatter(5 * gib)).toBe("5 GiB");
    expect(yAxis.name).toBeUndefined();
    expect(chart.props("data").options.tooltip.textStyle.fontSize).toBe(12);
  });

  it("shows memory in the same binary units on the chart axis, its tooltip and the table", async () => {
    const mib = 1024 ** 2;
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        profile_types: [{ type: "inuse_space", unit: "bytes" }],
      },
    });
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        unit: "bytes",
        profile_type: "inuse_space",
        series: [{ timestamp: 1_000_000, value: 3 * mib }],
      },
    });
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        unit: "bytes",
        profile_type: "inuse_space",
        total: 3 * mib,
        merged_total: 3 * mib,
        top: [{ name: "fn-a", self: 3 * mib, total: 3 * mib }],
      },
    });
    const wrapper = mountPage();
    await settle();

    const options = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options;
    expect(options.yAxis.axisLabel.formatter(3 * mib)).toBe("3 MiB");
    expect(options.tooltip.valueFormatter(3 * mib)).toBe("3 MiB");
    expect(wrapper.find('[data-test="profiles-top-table"]').text()).toContain("3 MiB");
  });

  it("draws straight lines that drop to zero across empty buckets, on a transparent background", async () => {
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        step_secs: 60,
        series: [
          { timestamp: 60_000_000, value: 60e9 },
          { timestamp: 120_000_000, value: 120e9 },
          { timestamp: 360_000_000, value: 60e9 },
        ],
      },
    });
    const wrapper = mountPage();
    await settle();

    const options = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options;
    expect(options.backgroundColor).toBe("transparent");
    expect(options.series[0].smooth).toBe(false);
    expect(options.series[0].data).toEqual([
      [60_000, 1],
      [120_000, 2],
      [180_000, 0],
      [300_000, 0],
      [360_000, 1],
    ]);
  });

  it("leaves in-use memory gaps unfilled, since a missing snapshot is not 0 B", async () => {
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        profile_types: [{ type: "inuse_space", unit: "bytes" }],
      },
    });
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        unit: "bytes",
        profile_type: "inuse_space",
        step_secs: 60,
        series: [
          { timestamp: 60_000_000, value: 100 },
          { timestamp: 120_000_000, value: 200 },
          { timestamp: 360_000_000, value: 300 },
        ],
      },
    });
    mocks.merge.mockResolvedValue({
      data: { ...mergeResponse.data, unit: "bytes", profile_type: "inuse_space" },
    });
    const wrapper = mountPage();
    await settle();

    const series = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options
      .series[0];
    expect(series.data).toEqual([
      [60_000, 100],
      [120_000, 200],
      [180_000, null],
      [360_000, 300],
    ]);
    expect(series.showSymbol).toBe(true);
    expect(
      series.data.map((datum: unknown, dataIndex: number) => series.symbol(datum, { dataIndex })),
    ).toEqual(["none", "none", "none", "emptyCircle"]);
    const { tooltip } = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options;
    expect(tooltip.valueFormatter(null)).toBe("—");
    expect(tooltip.valueFormatter(200)).toBe("200 B");
  });

  it("keeps symbols off for an in-use line whose gap leaves no point on its own", async () => {
    mocks.meta.mockResolvedValue({
      data: {
        ...profileMetaResponse.data,
        profile_types: [{ type: "inuse_space", unit: "bytes" }],
      },
    });
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        unit: "bytes",
        profile_type: "inuse_space",
        step_secs: 60,
        series: [
          { timestamp: 60_000_000, value: 100 },
          { timestamp: 120_000_000, value: 200 },
          { timestamp: 360_000_000, value: 300 },
          { timestamp: 420_000_000, value: 400 },
        ],
      },
    });
    mocks.merge.mockResolvedValue({
      data: { ...mergeResponse.data, unit: "bytes", profile_type: "inuse_space" },
    });
    const wrapper = mountPage();
    await settle();

    const series = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options
      .series[0];
    expect(series.data).toContainEqual([180_000, null]);
    expect(series.showSymbol).toBe(false);
    expect(series.symbol).toBeUndefined();
  });

  it("leaves the series unfilled when the response has no step", async () => {
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        step_secs: undefined,
        series: [
          { timestamp: 60_000_000, value: 6e9, rate: 1e9 },
          { timestamp: 120_000_000, value: 6e9, rate: 1e9 },
        ],
      },
    });
    const wrapper = mountPage();
    await settle();

    const data = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options
      .series[0].data;
    expect(data).toEqual([
      [60_000, 1],
      [120_000, 1],
    ]);
  });

  it("shows a seeded profile type by its label, not its raw id, while meta is loading", async () => {
    route.query = { stream: "profiles-a", profile_type: "inuse_space", profile_unit: "bytes" };
    mocks.meta.mockReturnValue(new Promise(() => {}));
    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    const select = wrapper.find('[data-test="profiles-type-select"] select');
    expect((select.element as HTMLSelectElement).value).toBe("inuse_space\u0000bytes");
    const labels = select.findAll("option").map((option) => option.text());
    expect(labels).toEqual(["inuse_space (bytes)"]);
  });

  it("uses sentence case like Logs and Traces, with no dot before Label filters", async () => {
    const wrapper = mountPage();
    await settle();

    const filters = wrapper.get('[data-test="profiles-label-filters"]');
    expect(filters.text()).toContain("Label filters");
    expect(filters.find(".bg-badge-orange-ol-text").exists()).toBe(false);
    const t = i18n.global.t;
    expect(t("emptyState.noProfiles.title")).toBe("No profiles found");
    expect(t("profiles.noSeries")).toBe("No data");
    expect(t("profiles.rootAtBottom")).toBe("Root at bottom");
    expect(t("profiles.runOptions")).toBe("Run options");
  });

  it("draws CPU as cores per second of profiled time when the server sends a rate", async () => {
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        series: [
          { timestamp: 1_000_000, value: 6e9, rate: 4.2e8 },
          { timestamp: 61_000_000, value: 60e9 },
        ],
      },
    });
    const wrapper = mountPage();
    await settle();

    const data = wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options
      .series[0].data;
    // 0.42 cores while profiled; the point without a rate falls back to the 60 s step.
    expect(data.map(([, value]: number[]) => value)).toEqual([0.42, 1]);
  });

  it("breaks the chart down by a label and filters to a value from its legend chip", async () => {
    const wrapper = mountPage();
    await settle();
    mocks.series.mockResolvedValueOnce({
      data: {
        ...seriesResponse.data,
        groups: [
          { value: "pod-a", total: 9, others: false, series: [{ timestamp: 1_000_000, value: 9 }] },
          { value: "", total: 1, others: true, series: [{ timestamp: 1_000_000, value: 1 }] },
        ],
      },
    });

    await wrapper.find('[data-test="profiles-breakdown-select"] select').setValue("k8s_pod_name");
    await flushPromises();
    await nextTick();

    expect(mocks.series).toHaveBeenLastCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({ group_by: "k8s_pod_name", group_limit: 10 }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    const series = wrapper.findComponent({ name: "ChartRendererStub" }).props("data")
      .options.series;
    expect(series.map((line: { name: string }) => line.name)).toEqual(["pod-a", "Others"]);
    expect(route.query.breakdown ?? router.replace.mock.calls.at(-1)?.[0].query.breakdown).toBe(
      "k8s_pod_name",
    );

    mocks.merge.mockClear();
    await wrapper.find('[data-test="profiles-breakdown-chip-0"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="profiles-filter-chip-k8s_pod_name"]').exists()).toBe(true);
    expect(mocks.merge).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining({ filters: [{ key: "k8s_pod_name", op: "=", value: "pod-a" }] }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("re-reads the series and Others colours when the theme switches", async () => {
    const html = document.documentElement;
    const startTheme = store.state.theme;
    html.style.setProperty("--color-chart-series-1", "rgb(1, 2, 3)");
    html.style.setProperty("--color-border-strong", "rgb(4, 5, 6)");
    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        groups: [
          { value: "pod-a", total: 9, others: false, series: [{ timestamp: 1_000_000, value: 9 }] },
          { value: "", total: 1, others: true, series: [{ timestamp: 1_000_000, value: 1 }] },
        ],
      },
    });
    try {
      const wrapper = mountPage();
      await settle();
      await wrapper.find('[data-test="profiles-breakdown-select"] select').setValue("k8s_pod_name");
      await flushPromises();
      await nextTick();
      const colorsOf = () =>
        wrapper
          .findComponent({ name: "ChartRendererStub" })
          .props("data")
          .options.series.map((line: { color?: string }) => line.color);
      expect(colorsOf()).toEqual(["rgb(1, 2, 3)", "rgb(4, 5, 6)"]);

      html.style.setProperty("--color-chart-series-1", "rgb(7, 8, 9)");
      html.style.setProperty("--color-border-strong", "rgb(10, 11, 12)");
      store.state.theme = startTheme === "dark" ? "light" : "dark";
      await nextTick();
      expect(colorsOf()).toEqual(["rgb(7, 8, 9)", "rgb(10, 11, 12)"]);
    } finally {
      store.state.theme = startTheme;
      html.style.removeProperty("--color-chart-series-1");
      html.style.removeProperty("--color-border-strong");
    }
  });

  it("re-reads the series colours when a theme colour preset is applied", async () => {
    const html = document.documentElement;
    html.style.setProperty("--color-chart-series-1", "rgb(1, 2, 3)");
    mocks.series.mockResolvedValue({
      data: { ...seriesResponse.data, series: [{ timestamp: 1_000_000, value: 9 }] },
    });
    try {
      const wrapper = mountPage();
      await settle();
      const colorOf = () =>
        wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options.series[0].color;
      expect(colorOf()).toBe("rgb(1, 2, 3)");

      html.style.setProperty("--color-chart-series-1", "rgb(7, 8, 9)");
      window.dispatchEvent(new CustomEvent("themeColorChanged"));
      await nextTick();
      expect(colorOf()).toBe("rgb(7, 8, 9)");
    } finally {
      html.style.removeProperty("--color-chart-series-1");
    }
  });

  it("says how much of the samples the views show when the result is cut", async () => {
    mocks.merge.mockResolvedValue({
      data: { ...mergeResponse.data, truncated: true, total: 50, merged_total: 45 },
    });
    const wrapper = mountPage();
    await settle();

    expect(wrapper.find('[data-test="profiles-partial-result"]').text()).toContain("90.00%");
  });

  it("marks the page as beta in the title line, as Workflows does", async () => {
    const wrapper = mountPage();
    await settle();

    expect(wrapper.find('[data-test="beta-badge"]').exists()).toBe(true);
  });

  it("applies a picked window at once, with no Apply step in the picker", async () => {
    const wrapper = mountPage();
    await settle();

    expect(
      wrapper.findComponent({ name: "DateTimePickerDashboard" }).props("autoApplyDashboard"),
    ).toBe(true);
  });

  // Like the real picker with auto-apply on: setCustomDate changes the range, a watcher emits it, and
  // refresh() emits the current range at once.
  const autoApplyPicker = () =>
    defineComponent({
      props: ["modelValue"],
      emits: ["update:modelValue"],
      setup(_, { emit, expose }) {
        const range = ref<{ start: Date; end: Date } | null>(null);
        const emitRange = () => {
          if (!range.value) return;
          emit("update:modelValue", {
            startTime: range.value.start.getTime() * 1000,
            endTime: range.value.end.getTime() * 1000,
            relativeTimePeriod: "",
            valueType: "absolute",
          });
        };
        watch(range, emitRange, { deep: true });
        expose({
          setCustomDate: (_type: string, next: { start: Date; end: Date }) => (range.value = next),
          refresh: emitRange,
          setSavedDate: () => {},
        });
        return () => h("div");
      },
    });

  const dragOnChart = async (wrapper: ReturnType<typeof mountPage>) => {
    // 10:00:20 to 10:03:40 on a whole-minute day; the page cuts it to 10:00 to 10:03.
    const minute = 60_000;
    const base = Date.UTC(2026, 9, 14, 10, 0, 0);
    wrapper
      .findComponent({ name: "ChartRendererStub" })
      .vm.$emit("updated:dataZoom", { start: base + 20_000, end: base + 3 * minute + 40_000 });
    await flushPromises();
    await nextTick();
    return { start_time: base * 1000, end_time: (base + 3 * minute) * 1000 };
  };

  it("sets the picker to the range dragged on the chart and runs the query once", async () => {
    mocks.series.mockResolvedValue({
      data: { ...seriesResponse.data, series: [{ timestamp: 1_000_000, value: 5 }] },
    });
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mount(Profiles, {
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: { ...pageStubs, DateTimePickerDashboard: autoApplyPicker() },
      },
    });
    await flushPromises();
    await nextTick();
    mocks.merge.mockClear();
    mocks.meta.mockClear();

    const window = await dragOnChart(wrapper);

    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.meta).toHaveBeenCalledTimes(1);
    expect(mocks.merge).toHaveBeenCalledWith(
      orgIdentifier,
      "profiles-a",
      expect.objectContaining(window),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("runs a chart drag with Auto Run off and leaves Run query not pending", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
    mocks.series.mockResolvedValue({
      data: { ...seriesResponse.data, series: [{ timestamp: 1_000_000, value: 5 }] },
    });
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mount(Profiles, {
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: { ...pageStubs, DateTimePickerDashboard: autoApplyPicker() },
      },
    });
    await flushPromises();
    await nextTick();
    mocks.merge.mockClear();

    await dragOnChart(wrapper);

    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find('[data-test="profiles-run-query"]').attributes("data-run-pending"),
    ).toBeUndefined();
  });

  it("opens the flame graph with the function highlighted from a Top Table row menu", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    const firstRow = topRowMenu(wrapper, "fn-b");
    const prefix = firstRow.attributes("data-test")!.replace(/-menu$/, "");
    // The button stops click propagation (rows must not react); the real menu opens on pointerdown.
    (firstRow.element.parentElement as HTMLElement).click();
    await nextTick();
    await wrapper.find(`[data-test="${prefix}-show"]`).trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-view-flame"]').attributes("data-state")).toBe("on");
    expect(
      (wrapper.find('[data-test="profiles-search-functions"]').element as HTMLInputElement).value,
    ).toBe("fn-b");
  });

  it("opens the Sandwich view from a row menu with callers above callees", async () => {
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        root: {
          name: "root",
          self: 0,
          total: 30,
          children: [
            {
              name: "main",
              self: 0,
              total: 30,
              children: [
                {
                  name: "fn-b",
                  self: 5,
                  total: 15,
                  children: [{ name: "fn-c", self: 10, total: 10 }],
                },
                { name: "other", self: 15, total: 15 },
              ],
            },
          ],
        },
      },
    });
    const wrapper = mountPage();
    await settle();

    const firstRow = topRowMenu(wrapper, "fn-b");
    const prefix = firstRow.attributes("data-test")!.replace(/-menu$/, "");
    (firstRow.element.parentElement as HTMLElement).click();
    await nextTick();
    await wrapper.find(`[data-test="${prefix}-sandwich"]`).trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-test="profiles-view-sandwich"]').attributes("data-state")).toBe(
      "on",
    );
    const graphOf = (part: string) =>
      wrapper.find(`[data-test="profiles-sandwich-${part}"]`).findComponent(FlameGraphView);
    expect(graphOf("callers").props("root")).toMatchObject({
      name: "fn-b",
      total: 15,
      children: [{ name: "main", total: 15 }],
    });
    expect(graphOf("callers").props("initialRootAtBottom")).toBe(true);
    expect(graphOf("callees").props("root")).toMatchObject({
      name: "fn-b",
      children: [{ name: "fn-c", total: 10 }],
    });
    // fn-b has 30 samples in the Top list, but only 15 sit in the drawn tree.
    expect(wrapper.find('[data-test="profiles-sandwich-coverage"]').text()).toContain("50.00%");
  });

  it("shows Function details for a row and closes them", async () => {
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        root: {
          name: "root",
          self: 0,
          total: 30,
          children: [
            {
              name: "main",
              self: 0,
              total: 30,
              children: [{ name: "fn-b", self: 5, total: 30, children: [] }],
            },
          ],
        },
      },
    });
    const wrapper = mountPage();
    await settle();

    const firstRow = topRowMenu(wrapper, "fn-b");
    const prefix = firstRow.attributes("data-test")!.replace(/-menu$/, "");
    (firstRow.element.parentElement as HTMLElement).click();
    await nextTick();
    await wrapper.find(`[data-test="${prefix}-details"]`).trigger("click");
    await nextTick();

    const panel = wrapper.find('[data-test="profiles-function-details"]');
    expect(panel.text()).toContain("fn-b");
    expect(panel.find('[data-test="profiles-function-details-self"]').text()).toBe("5 ns · 16.67%");
    expect(panel.find('[data-test="profiles-function-details-total"]').text()).toBe(
      "30 ns · 100.00%",
    );
    // The table's Self % cell for the same function uses the same precision.
    const tableRow = wrapper
      .findAll("tbody tr")
      .find((row) => row.find("td").text().includes("fn-b"))!;
    expect(tableRow.text()).toContain("16.67%");
    // fn-b has no package separator, so there is no Package row repeating its name.
    expect(panel.find('[data-test="profiles-function-details-package"]').exists()).toBe(false);
    expect(panel.find('[data-test="profiles-function-details-called-by"]').text()).toContain(
      "main",
    );

    expect(panel.find('[data-test="profiles-function-details-folded"]').exists()).toBe(false);

    await panel.find('[data-test="profiles-function-details-close"]').trigger("click");
    expect(wrapper.find('[data-test="profiles-function-details"]').exists()).toBe(false);
  });

  it("says when the call tree folded a function's callees into its self time", async () => {
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        // The Top list says fn-b has 5 self; the tree shows 30, because its callees were folded in.
        root: {
          name: "root",
          self: 0,
          total: 30,
          children: [{ name: "fn-b", self: 30, total: 30 }],
        },
      },
    });
    const wrapper = mountPage();
    await settle();

    const firstRow = topRowMenu(wrapper, "fn-b");
    const prefix = firstRow.attributes("data-test")!.replace(/-menu$/, "");
    (firstRow.element.parentElement as HTMLElement).click();
    await nextTick();
    await wrapper.find(`[data-test="${prefix}-details"]`).trigger("click");
    await nextTick();

    expect(wrapper.find('[data-test="profiles-function-details-folded"]').exists()).toBe(true);
  });

  it("says how many functions and what share of samples a search matches", async () => {
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        total: 100,
        root: {
          name: "total",
          self: 0,
          total: 100,
          children: [
            {
              name: "main.hash",
              self: 10,
              total: 40,
              children: [{ name: "main.hash", self: 30, total: 30 }],
            },
            { name: "runtime.gc", self: 60, total: 60 },
          ],
        },
        top: [
          { name: "main.hash", self: 40, total: 40 },
          { name: "runtime.gc", self: 60, total: 60 },
        ],
      },
    });
    const wrapper = mountPage();
    await settle();

    await wrapper.find('[data-test="profiles-search-functions"]').setValue("hash");
    await nextTick();
    // The recursive main.hash counts once: 40 of 100.
    expect(wrapper.find('[data-test="profiles-search-summary"]').text()).toBe(
      "1 function · 40.00% of samples",
    );

    await wrapper.find('[data-test="profiles-search-functions"]').setValue("nothing");
    await nextTick();
    expect(wrapper.find('[data-test="profiles-search-summary"]').text()).toBe("No matches");
  });

  it("runs the query when the service, profile type or time range changes", async () => {
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
    await settle();
    expect(mocks.merge).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="profiles-service-select"] select').setValue("service-b");
    await flushPromises();
    expect(mocks.merge).toHaveBeenCalledTimes(2);
    expect(mocks.merge.mock.calls[1][2]).toMatchObject({ service_name: "service-b" });

    await wrapper.find('[data-test="profiles-type-select"] select').setValue("heap\u0000bytes");
    await flushPromises();
    expect(mocks.merge).toHaveBeenCalledTimes(3);
    expect(mocks.merge.mock.calls[2][2]).toMatchObject({ profile_type: "heap" });

    wrapper.findComponent({ name: "DateTimePickerDashboard" }).vm.$emit("update:modelValue", {
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "1h",
      valueType: "relative",
    });
    await flushPromises();
    // Two on open, one for the new service's profile types, one for the new window.
    expect(mocks.meta).toHaveBeenCalledTimes(4);
    expect(mocks.merge).toHaveBeenCalledTimes(4);
  });

  it("says the search was cancelled, not that there is no data, when the first query is cancelled", async () => {
    // Like the HTTP client, the request fails once its signal aborts.
    mocks.merge.mockImplementation(
      (_org, _stream, _payload, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new Error("canceled"))),
        ),
    );
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-test="profiles-cancel-query"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="profiles-search-cancelled"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profiles-no-results"]').exists()).toBe(false);
  });

  it("lists only the profile types of the selected service", async () => {
    const typesByService: Record<string, Array<{ type: string; unit: string }>> = {
      "service-a": [
        { type: "cpu", unit: "nanoseconds" },
        { type: "heap", unit: "bytes" },
      ],
      checkout: [{ type: "cpu", unit: "nanoseconds" }],
    };
    mocks.meta.mockImplementation(async (_org, _stream, payload) => ({
      data: {
        ...profileMetaResponse.data,
        services: ["service-a", "checkout"],
        profile_types: payload.service_name
          ? typesByService[payload.service_name]
          : Object.values(typesByService).flat(),
      },
    }));
    const wrapper = mountPage();
    await settle();
    const typeOptions = () =>
      wrapper
        .findAll('[data-test="profiles-type-select"] option')
        .map((option) => option.attributes("value"));
    expect(typeOptions()).toEqual(["cpu\u0000nanoseconds", "heap\u0000bytes"]);

    await wrapper.find('[data-test="profiles-service-select"] select').setValue("checkout");
    await flushPromises();

    expect(mocks.meta.mock.lastCall?.[2]).toMatchObject({ service_name: "checkout" });
    expect(typeOptions()).toEqual(["cpu\u0000nanoseconds"]);
    expect(mocks.merge.mock.lastCall?.[2]).toMatchObject({
      service_name: "checkout",
      profile_type: "cpu",
    });
  });

  it("keeps the chosen service through an empty window and says why Run query is off", async () => {
    let empty = false;
    mocks.meta.mockImplementation(async () => ({
      data: empty
        ? { ...profileMetaResponse.data, services: [], profile_types: [], label_names: [] }
        : { ...profileMetaResponse.data, services: ["service-a", "payments"] },
    }));
    const wrapper = mountPage();
    await settle();
    await wrapper.find('[data-test="profiles-service-select"] select').setValue("payments");
    await flushPromises();
    const picker = wrapper.findComponent({ name: "DateTimePickerDashboard" });
    const pickWindow = async (relativeTimePeriod: string) => {
      picker.vm.$emit("update:modelValue", {
        startTime: 0,
        endTime: 0,
        relativeTimePeriod,
        valueType: "relative",
      });
      await flushPromises();
    };

    empty = true;
    await pickWindow("5m");
    const run = wrapper.find('[data-test="profiles-run-query"]');
    expect(run.attributes("disabled")).toBeDefined();
    expect(run.find("span[content]").attributes("content")).toBe(
      "Pick a stream and a profile type with data in this time range",
    );

    empty = false;
    await pickWindow("1h");
    expect(mocks.meta.mock.lastCall?.[2]).toMatchObject({ service_name: "payments" });
    expect(
      (wrapper.find('[data-test="profiles-service-select"] select').element as HTMLSelectElement)
        .value,
    ).toBe("payments");
    expect(mocks.merge.mock.lastCall?.[2]).toMatchObject({ service_name: "payments" });
  });

  it("draws a lone point as a dot on an axis that spans the run's window", async () => {
    const startMs = mocks.nowMs - 15 * 60 * 1000;
    mocks.series.mockResolvedValue({
      data: { ...seriesResponse.data, series: [{ timestamp: startMs * 1000, value: 6e9 }] },
    });
    const wrapper = mountPage();
    await settle();

    const options = () =>
      wrapper.findComponent({ name: "ChartRendererStub" }).props("data").options;
    expect(options().series[0].showSymbol).toBe(true);
    expect(options().xAxis.min).toBe(startMs);
    expect(options().xAxis.max).toBe(mocks.nowMs);

    mocks.series.mockResolvedValue({
      data: {
        ...seriesResponse.data,
        series: [0, 1, 2].map((step) => ({
          timestamp: (startMs + step * 60_000) * 1000,
          value: 6e9,
        })),
      },
    });
    await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
    await settle();
    expect(options().series[0].showSymbol).toBe(false);
  });

  describe("URL and share link", () => {
    const shareUrl = (wrapper: ReturnType<typeof mountPage>) =>
      new URL(String(wrapper.findComponent({ name: "ShareButton" }).props("url")));

    // A flame graph that reports focus, as the real one does, and records focus calls from the page.
    const focusCalls = vi.fn();
    const flameStub = {
      name: "FlameGraphStub",
      props: [
        "root",
        "summaryLabel",
        "summaryValue",
        "unitLabel",
        "emptyLabel",
        "valueFormatter",
        "searchQuery",
        "initialRootAtBottom",
      ],
      emits: ["search", "sandwich", "details", "focus"],
      methods: { focus: (path: string) => focusCalls(path) },
      template: "<div />",
    };
    const mountWithFlame = () =>
      mount(Profiles, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: { ...pageStubs, CommonFlameGraph: flameStub },
        },
      });

    it("keeps the Sandwich function, search, focus and open details in the URL and the share link", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      const wrapper = mountWithFlame();
      await settle();

      await wrapper.find('[data-test="profiles-view-flame"]').trigger("click");
      await nextTick();
      const graph = wrapper.findComponent({ name: "FlameGraphStub" });
      graph.vm.$emit("focus", "root/0");
      graph.vm.$emit("details", "fn-b");
      await wrapper.find('[data-test="profiles-search-functions"]').setValue("fn");
      graph.vm.$emit("sandwich", "fn-c");
      await flushPromises();

      const expected = {
        view: "sandwich",
        fn: "fn-c",
        search: "fn",
        focus: "root/0",
        details: "fn-b",
      };
      expect(router.replace.mock.lastCall?.[0].query).toMatchObject(expected);
      expect(Object.fromEntries(shareUrl(wrapper).searchParams)).toMatchObject(expected);
    });

    it("opens a shared link with its Sandwich function, search, focus and open details", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      route.query = {
        org_identifier: orgIdentifier,
        stream: "profiles-a",
        period: "15m",
        view: "sandwich",
        fn: "fn-c",
        search: "fn",
        focus: "root/0",
        details: "fn-b",
      };
      focusCalls.mockClear();
      const wrapper = mountWithFlame();
      await settle();

      expect(
        (wrapper.find('[data-test="profiles-search-functions"]').element as HTMLInputElement).value,
      ).toBe("fn");
      expect(
        (
          wrapper.find('[data-test="profiles-sandwich-function"] select')
            .element as HTMLSelectElement
        ).value,
      ).toBe("fn-c");
      expect(wrapper.find('[data-test="profiles-function-details"]').exists()).toBe(true);

      await wrapper.find('[data-test="profiles-view-flame"]').trigger("click");
      await nextTick();
      await nextTick();
      expect(focusCalls).toHaveBeenCalledWith("root/0");
    });

    it("drops the flame graph focus when a new run returns another tree", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      route.query = {
        org_identifier: orgIdentifier,
        stream: "profiles-a",
        period: "15m",
        view: "flame",
        focus: "root/0",
      };
      focusCalls.mockClear();
      const wrapper = mountWithFlame();
      await settle();
      expect(focusCalls).toHaveBeenCalledWith("root/0");
      wrapper.findComponent({ name: "FlameGraphStub" }).vm.$emit("focus", "root/0/2");
      await flushPromises();
      expect(router.replace.mock.lastCall?.[0].query.focus).toBe("root/0/2");
      focusCalls.mockClear();

      await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
      await settle();

      expect(wrapper.findComponent({ name: "FlameGraphStub" }).exists()).toBe(true);
      expect(focusCalls).not.toHaveBeenCalled();
      expect(router.replace.mock.lastCall?.[0].query).not.toHaveProperty("focus");
      expect(Object.fromEntries(shareUrl(wrapper).searchParams)).not.toHaveProperty("focus");
    });

    it("drops a link's focus when metadata replaces the linked service and runs again", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      route.query = {
        org_identifier: orgIdentifier,
        stream: "profiles-a",
        period: "15m",
        service_name: "service-gone",
        profile_type: "cpu",
        profile_unit: "nanoseconds",
        view: "flame",
        focus: "root/0",
      };
      // The linked run answers only after the second run started, so it is superseded.
      let answerLinkedRun!: (value: typeof mergeResponse) => void;
      mocks.merge.mockReturnValueOnce(new Promise((resolve) => (answerLinkedRun = resolve)));
      focusCalls.mockClear();
      mountWithFlame();
      await settle();
      answerLinkedRun(mergeResponse);
      await settle();

      expect(mocks.merge).toHaveBeenCalledTimes(2);
      expect(mocks.merge.mock.lastCall?.[2]).toMatchObject({ service_name: "service-a" });
      expect(focusCalls).not.toHaveBeenCalled();
      expect(router.replace.mock.lastCall?.[0].query).not.toHaveProperty("focus");
    });

    it("shares the window of the last run, not of the first one", async () => {
      const wrapper = mountPage();
      await flushPromises();
      expect(shareUrl(wrapper).searchParams.get("to")).toBe(String(mocks.nowMs * 1000));

      mocks.nowMs += 60 * 60 * 1000;
      await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
      await flushPromises();

      expect(shareUrl(wrapper).searchParams.get("to")).toBe(String(mocks.nowMs * 1000));
    });

    it("keeps inputs that were not run out of the URL and the share link", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
      mocks.meta.mockResolvedValue({
        data: { ...profileMetaResponse.data, services: ["service-a", "service-b"] },
      });
      const wrapper = mountPage();
      await flushPromises();

      await wrapper.find('[data-test="profiles-service-select"] select').setValue("service-b");
      await wrapper.find('[data-test="profiles-view-flame"]').trigger("click");
      await flushPromises();

      expect(router.replace).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ service_name: "service-a", view: "flame" }),
      });
      expect(shareUrl(wrapper).searchParams.get("service_name")).toBe("service-a");
    });
  });

  describe("Run query, Auto Run and Cancel", () => {
    const twoServices = () =>
      mocks.meta.mockResolvedValue({
        data: { ...profileMetaResponse.data, services: ["service-a", "service-b"] },
      });

    it("only marks Run query pending when Auto Run is not enabled on the server", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
      twoServices();
      const wrapper = mountPage();
      await flushPromises();
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="profiles-run-options"]').exists()).toBe(false);

      await wrapper.find('[data-test="profiles-service-select"] select').setValue("service-b");
      await flushPromises();
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      const run = wrapper.find('[data-test="profiles-run-query"]');
      expect(run.attributes("data-run-pending")).toBe("true");

      await run.trigger("click");
      await flushPromises();
      expect(mocks.merge).toHaveBeenCalledTimes(2);
      expect(mocks.merge.mock.calls[1][2]).toMatchObject({ service_name: "service-b" });
      expect(
        wrapper.find('[data-test="profiles-run-query"]').attributes("data-run-pending"),
      ).toBeUndefined();
    });

    it("stops running on changes once the Auto Run switch is turned off", async () => {
      twoServices();
      const wrapper = mountPage();
      await flushPromises();

      await wrapper.find('[data-test="profiles-run-options"]').trigger("click");
      await wrapper.find('[data-test="profiles-auto-run-toggle"]').trigger("click");
      await wrapper.find('[data-test="profiles-service-select"] select').setValue("service-b");
      await flushPromises();

      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="profiles-run-query"]').attributes("data-run-pending")).toBe(
        "true",
      );
    });

    it("shows skeletons for the chart and the table while a query runs", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      const wrapper = mountPage();
      await settle();
      expect(wrapper.find('[data-test="profiles-series-skeleton"]').exists()).toBe(false);

      mocks.merge.mockImplementationOnce(() => new Promise(() => {}));
      await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="profiles-series-skeleton"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
      await wrapper.find('[data-test="profiles-view-flame"]').trigger("click");
      expect(wrapper.find('[data-test="profiles-flame-skeleton"]').exists()).toBe(true);
    });

    it("cancels a running query, keeps the last results and marks the run pending", async () => {
      mocks.merge.mockResolvedValue(mergeResponse);
      const wrapper = mountPage();
      await flushPromises();
      await nextTick();

      let signal: AbortSignal | undefined;
      mocks.merge.mockImplementationOnce((_org, _stream, _payload, options) => {
        signal = options?.signal;
        return new Promise(() => {});
      });
      await wrapper.find('[data-test="profiles-run-query"]').trigger("click");
      await nextTick();
      await wrapper.find('[data-test="profiles-cancel-query"]').trigger("click");
      await flushPromises();

      expect(signal?.aborted).toBe(true);
      expect(wrapper.find('[data-test="profiles-cancel-query"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-run-query"]').attributes("data-run-pending")).toBe(
        "true",
      );
      expect(wrapper.find('[data-test="profiles-top-table"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-error-banner"]').exists()).toBe(false);
    });
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
    await settle();

    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
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

  it("keeps the results when a label value lookup fails, as the Metrics label filter does", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    mocks.tagValues.mockRejectedValue(new Error("values failed"));
    const wrapper = mountPage();
    await settle();

    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await flushPromises();

    expect(wrapper.find('[data-test="profiles-error-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profiles-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profiles-top-table"]').exists()).toBe(true);
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
    await settle();

    await wrapper.find('[data-test="profiles-add-filter"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="profiles-tag-key-select"] select').setValue("k8s_pod_name");
    await nextTick();

    await wrapper.find('[data-test="profiles-stream-select"] select').setValue("profiles-b");
    await flushPromises();
    await nextTick();

    resolveTag?.({ data: { tag: "k8s_pod_name", values: ["stale-pod"], took: 1 } });
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).not.toContain("stale-pod");
  });

  it("opens the top table sorted by Self, and sorts by Total on a header click", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    await wrapper.find('[data-test="profiles-view-top"]').trigger("click");
    await nextTick();

    const namesBefore = wrapper
      .findAll("tbody tr")
      .map((row) => row.find("td").text())
      .filter(Boolean);
    expect(namesBefore[0]).toBe("fn-c");
    // One scrolling list, no pager (as on Traces).
    expect(wrapper.find('[data-test="o2-table-pagination-info"]').exists()).toBe(false);

    await wrapper
      .find('[data-test="o2-table-th-total"] [data-test="o2-table-th-sort-trigger"]')
      .trigger("click");
    await nextTick();

    const namesAfter = wrapper
      .findAll("tbody tr")
      .map((row) => row.find("td").text())
      .filter(Boolean);
    expect(namesAfter[0]).toBe("fn-b");
  });

  it("opens the Call Tree with the root expanded, children by total, and their counts", async () => {
    mocks.merge.mockResolvedValue({
      data: {
        ...mergeResponse.data,
        root: {
          name: "root",
          self: 0,
          total: 30,
          children: [
            { name: "small", self: 5, total: 5, children: [] },
            { name: "big", self: 5, total: 25, children: [{ name: "leaf", self: 20, total: 20 }] },
          ],
        },
      },
    });
    const wrapper = mountPage();
    await settle();

    await wrapper.find('[data-test="profiles-view-tree"]').trigger("click");
    await flushPromises();
    await nextTick();

    const table = wrapper.find('[data-test="profiles-stack-table"]');
    const names = table
      .findAll("tbody tr td:first-child")
      .map((cell) => cell.find(".font-mono").text())
      .filter(Boolean);
    expect(names).toEqual(["root", "big", "small"]);
    expect(table.find('[data-test="profiles-tree-row-0-counts"]').text()).toMatch(
      /2 children\s+·\s+3 nodes/,
    );
    expect(table.find('[data-test="profiles-tree-row-1-counts"]').text()).toMatch(
      /1 child\s+·\s+1 node$/,
    );
    expect(table.find('[data-test="profiles-tree-row-2-counts"]').exists()).toBe(false);
    expect(table.text()).toContain("83.33%");
  });

  it("writes the page state to the URL after a run, without loading again", async () => {
    const wrapper = mountPage();
    await settle();

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(route.query).toMatchObject({
      org_identifier: orgIdentifier,
      stream: "profiles-a",
      period: "15m",
      service_name: "service-a",
      view: "top",
    });
    expect(mocks.merge).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="profiles-view-flame"]').trigger("click");
    await flushPromises();
    expect(route.query.view).toBe("flame");
    expect(mocks.merge).toHaveBeenCalledTimes(1);
  });

  it("reads a relative period from the URL", async () => {
    route.query = { stream: "profiles-b", period: "1h" };
    mountPage();
    await flushPromises();
    await nextTick();

    expect(mocks.getConsumableRelativeTime).toHaveBeenCalledWith("1h");
    expect(mocks.merge.mock.calls[0][1]).toBe("profiles-b");
  });

  it("expands the results over the chart card and back", async () => {
    mocks.merge.mockResolvedValue(mergeResponse);
    const wrapper = mountPage();
    await settle();

    const chartHidden = () =>
      (wrapper.find('[data-test="profiles-series-card"]').attributes("style") ?? "").includes(
        "display: none",
      );
    expect(chartHidden()).toBe(false);

    await wrapper.find('[data-test="profiles-results-expand"]').trigger("click");
    expect(chartHidden()).toBe(true);

    await wrapper.find('[data-test="profiles-results-expand"]').trigger("click");
    expect(chartHidden()).toBe(false);
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
    // Like the real picker, it re-emits its model on mount and takes later windows through setSavedDate.
    const emittingPicker = {
      props: ["modelValue"],
      emits: ["update:modelValue"],
      mounted(this: { modelValue: object; $emit: (e: string, v: object) => void }) {
        this.$emit("update:modelValue", { ...this.modelValue });
      },
      methods: { setSavedDate: () => {} },
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
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(wrapper.find('[data-test="profiles-filter-chip-trace_id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-filter-chip-span_id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-view-flame"]').attributes("data-state")).toBe("on");
    });

    it("loads metadata for the seeded window", async () => {
      mountSeeded();
      await flushPromises();
      expect(mocks.meta).toHaveBeenCalledWith(orgIdentifier, "profiles-b", {
        start_time: FROM,
        end_time: TO,
        service_name: "service-b",
      });
    });

    it("starts the seeded query without waiting for metadata", async () => {
      const meta = deferred<unknown>();
      mocks.meta.mockReturnValueOnce(meta.promise);
      mountSeeded();
      await flushPromises();

      expect(mocks.merge).toHaveBeenCalledTimes(1);
      meta.resolve({
        data: {
          ...profileMetaResponse.data,
          services: ["service-a", "service-b"],
          profile_types: [{ type: "cpu", unit: "nanoseconds" }],
        },
      });
      await flushPromises();
      expect(mocks.merge).toHaveBeenCalledTimes(1);
    });

    it("runs again when metadata replaces a seeded service that has no data", async () => {
      route.query = { ...seedQuery, service_name: "service-gone" };
      mountSeeded();
      await flushPromises();

      expect(mocks.merge).toHaveBeenCalledTimes(2);
      expect(mocks.merge).toHaveBeenLastCalledWith(
        orgIdentifier,
        "profiles-b",
        expect.objectContaining({ service_name: "service-a" }),
        expect.objectContaining({ signal: expect.anything() }),
      );
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
        expect.objectContaining({ signal: expect.anything() }),
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
        expect.objectContaining({ signal: expect.anything() }),
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
      expect(mocks.meta).toHaveBeenCalledTimes(2);
      expect(mocks.meta).toHaveBeenNthCalledWith(1, orgIdentifier, "profiles-a", window);
      expect(mocks.meta).toHaveBeenNthCalledWith(2, orgIdentifier, "profiles-a", {
        ...window,
        service_name: "service-a",
      });
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-a",
        expect.objectContaining({ ...window, filters: [] }),
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it("moves the mounted picker when the URL state changes", async () => {
      const setSavedDate = vi.fn();
      const picker = { ...emittingPicker, methods: { setSavedDate } };
      mount(Profiles, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: { ...pageStubs, DateTimePickerDashboard: picker },
        },
      });
      await flushPromises();
      setSavedDate.mockClear();

      route.query = {};
      await flushPromises();

      expect(setSavedDate).toHaveBeenCalledWith({ type: "relative", relativeTimePeriod: "15m" });
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
      expect(wrapper.find('[data-test^="profiles-filter-chip-"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-view-top"]').attributes("data-state")).toBe("on");
    });
  });

  describe("superseded by an org switch", () => {
    const originalOrg = { ...store.state.selectedOrganization };
    const otherOrg = { ...originalOrg, id: 160, identifier: "other-org" };

    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };

    const selectedStreamValue = (wrapper: ReturnType<typeof mountPage>) =>
      (wrapper.find('[data-test="profiles-stream-select"] select').element as HTMLSelectElement)
        .value;

    afterEach(() => {
      store.dispatch("setSelectedOrganization", originalOrg);
    });

    it("loads the new org once, without the old org's URL state", async () => {
      route.query = {
        org_identifier: orgIdentifier,
        stream: "profiles-b",
        period: "1h",
        filters: "k8s_pod_name=pod-1",
      };
      mountPage();
      await flushPromises();
      mocks.nameList.mockClear();
      mocks.merge.mockClear();

      // As the app switches orgs: the store changes first, and the new URL lands a tick later.
      store.dispatch("setSelectedOrganization", otherOrg);
      await nextTick();
      route.query = { org_identifier: "other-org" };
      await flushPromises();

      expect(mocks.nameList).toHaveBeenCalledTimes(1);
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      expect(mocks.merge.mock.calls[0][0]).toBe("other-org");
      expect(mocks.merge.mock.calls[0][2]).toMatchObject({ filters: [] });
    });

    it("drops the older org's merge when it lands after the switch", async () => {
      const oldMerge = deferred<ReturnType<typeof mergeFor>>();
      mocks.merge.mockReturnValue(oldMerge.promise);
      const wrapper = mountPage();
      await flushPromises();
      expect(mocks.merge).toHaveBeenCalledWith(
        orgIdentifier,
        "profiles-a",
        expect.anything(),
        expect.objectContaining({ signal: expect.anything() }),
      );

      const newNames = deferred<typeof streamResponse>();
      mocks.nameList.mockReturnValueOnce(newNames.promise);
      store.dispatch("setSelectedOrganization", otherOrg);
      await flushPromises();
      oldMerge.resolve(mergeFor("fn-old-org"));
      await flushPromises();

      expect(wrapper.text()).not.toContain("fn-old-org");

      mocks.merge.mockResolvedValue(mergeFor("fn-new-org"));
      newNames.resolve(streamResponse);
      await settle();

      expect(mocks.merge).toHaveBeenLastCalledWith(
        "other-org",
        "profiles-a",
        expect.anything(),
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(wrapper.text()).toContain("fn-new-org");
      expect(wrapper.text()).not.toContain("fn-old-org");
    });

    it("keeps the newer org's stream when the older stream list resolves last", async () => {
      const oldNames = deferred<typeof streamResponse>();
      mocks.nameList.mockReturnValueOnce(oldNames.promise);
      const wrapper = mountPage();
      await flushPromises();

      mocks.nameList.mockResolvedValueOnce({ data: { list: [{ name: "profiles-c" }] } });
      store.dispatch("setSelectedOrganization", otherOrg);
      await flushPromises();
      expect(selectedStreamValue(wrapper)).toBe("profiles-c");

      oldNames.resolve(streamResponse);
      await flushPromises();

      expect(selectedStreamValue(wrapper)).toBe("profiles-c");
      expect(wrapper.find('[data-test="profiles-stream-select"]').text()).not.toContain(
        "profiles-a",
      );
      expect(new Set(mocks.meta.mock.calls.map((call) => call[1]))).toEqual(
        new Set(["profiles-c"]),
      );
      expect(new Set(mocks.merge.mock.calls.map((call) => `${call[0]}/${call[1]}`))).toEqual(
        new Set(["other-org/profiles-c"]),
      );
    });
  });
});
