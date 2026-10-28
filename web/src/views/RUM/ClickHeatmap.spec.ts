import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";

const h = vi.hoisted(() => ({
  run: vi.fn(),
  hold: vi.fn(),
  abortAll: vi.fn(),
  getStream: vi.fn(),
}));

vi.mock("@/composables/rum/useAnalyticsSearch", () => ({
  default: () => ({ run: h.run, hold: h.hold, abortAll: h.abortAll }),
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: h.getStream }) }));
vi.mock("@/services/rumProductAnalytics", () => ({
  default: { getAppSettings: vi.fn().mockResolvedValue({ data: undefined }) },
}));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/utils/rum/clickHeatmapQueries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  rankingSql: () => "SELECT ranking",
  totalsSql: () => "SELECT totals",
  deviceSplitSql: () => "SELECT devices",
  pageListSql: () => "SELECT pages",
}));
vi.mock("@/utils/rum/productAnalyticsQueries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  appProbeSql: () => "SELECT apps",
}));

import ClickHeatmap from "./ClickHeatmap.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const store = createStore({
  state: {
    zoConfig: { timestamp_column: "_timestamp" },
    selectedOrganization: { identifier: "default" },
  },
});

const ok = (rows: unknown[]) => ({ status: "ok", rows });

const answer = (overrides: Record<string, () => unknown> = {}) =>
  h.run.mockImplementation(async (id: string) => {
    if (overrides[id]) return overrides[id]();
    const byId: Record<string, unknown[]> = {
      apps: [{ app: "web" }],
      pages: [{ view_url: "https://x.test/home" }],
      devices: [{ cls: "desktop", clicks: 4 }],
      totals: [{ clicks: 4, sessions: 2, frustrated: 0 }],
      ranking: [{ selector: "#buy", clicks: 4, sessions: 2 }],
    };
    return ok(byId[id] ?? []);
  });

const ids = () => h.run.mock.calls.map((c) => c[0] as string);

const mountPage = async () => {
  const wrapper = mount(ClickHeatmap, { global: { plugins: [store] } });
  await flushPromises();
  return wrapper;
};

describe("ClickHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    h.getStream.mockResolvedValue({ schema: [] });
  });

  it("shows the load error banner and not the empty state when the app list fails", async () => {
    answer({ apps: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "Couldn't load the click data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-empty"]').exists()).toBe(false);
  });

  it("shows the empty state when there are no pages", async () => {
    answer({ apps: () => ok([]) });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-empty"]').text()).toContain(
      "No clicks recorded in this period",
    );
    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
  });

  it("aborts in-flight searches on unmount", async () => {
    answer();
    const wrapper = await mountPage();
    h.abortAll.mockClear();

    wrapper.unmount();

    expect(h.abortAll).toHaveBeenCalledTimes(1);
  });

  it("re-runs only totals and ranking and rebuilds the snapshot on device change", async () => {
    answer();
    const wrapper = await mountPage();
    expect(ids()).toEqual(
      expect.arrayContaining(["apps", "pages", "devices", "totals", "ranking", "replay-views"]),
    );
    h.run.mockClear();

    const device = wrapper
      .findAllComponents(OSelect)
      .find((s) => s.attributes("data-test") === "rum-heatmap-device-select");
    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();

    expect(ids().sort()).toEqual(["ranking", "replay-views", "totals"]);
  });

  it("shows only the error banner with a retry when the clicks fail to load", async () => {
    answer({ totals: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "Couldn't load the click data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-no-position"]').exists()).toBe(false);
  });

  it("supersedes the earlier panel request when the device changes again", async () => {
    answer();
    const wrapper = await mountPage();
    let release: (v: unknown) => void = () => {};
    answer({
      totals: () => new Promise((r) => (release = r)),
    });
    h.run.mockClear();
    const device = wrapper
      .findAllComponents(OSelect)
      .find((s) => s.attributes("data-test") === "rum-heatmap-device-select");

    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();
    const firstRelease = release;
    answer();
    device?.vm.$emit("update:modelValue", "tablet");
    await flushPromises();
    firstRelease(ok([{ clicks: 99, sessions: 9, frustrated: 0 }]));
    await flushPromises();

    expect(ids().filter((id) => id === "totals")).toHaveLength(2);
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).not.toContain("99");
  });
});
