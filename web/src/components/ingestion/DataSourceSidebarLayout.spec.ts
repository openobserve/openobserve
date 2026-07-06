import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";
import DataSourceSidebarLayout from "@/components/ingestion/DataSourceSidebarLayout.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// getImageURL may be referenced by tab icons / nested components.
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mock-${path}`),
}));

const sampleTabs = [
  { name: "postgres", to: { name: "postgres" }, label: "PostgreSQL" },
  { name: "redis", to: { name: "redis" }, label: "Redis" },
  { name: "mysql", to: { name: "mysql" }, label: "MySQL" },
];

const makeRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div>Home</div>" } },
      {
        path: "/postgres",
        name: "postgres",
        component: { template: "<div>pg</div>" },
      },
      {
        path: "/redis",
        name: "redis",
        component: { template: "<div>redis</div>" },
      },
      {
        path: "/mysql",
        name: "mysql",
        component: { template: "<div>mysql</div>" },
      },
    ],
  });

describe("DataSourceSidebarLayout.vue", () => {
  let wrapper: VueWrapper<any>;
  let router: ReturnType<typeof makeRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = makeRouter();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props: Record<string, any> = {}, options: any = {}) =>
    mount(DataSourceSidebarLayout, {
      props: {
        modelValue: "postgres",
        tabs: sampleTabs,
        ...props,
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
        ...(options.global || {}),
      },
      ...options,
    });

  describe("Rendering", () => {
    it("mounts with minimal props", () => {
      wrapper = mount(DataSourceSidebarLayout, {
        global: { plugins: [i18n, router], provide: { store } },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts with tabs", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the right-border separator panel", () => {
      wrapper = createWrapper();
      const bordered = wrapper
        .findAll("div")
        .find(
          (d) =>
            d.classes().includes("border-r") &&
            d.classes().includes("border-border-default"),
        );
      expect(bordered).toBeTruthy();
    });

    it("renders one ORouteTab per tab", () => {
      wrapper = createWrapper();
      const routeTabs = wrapper.findAllComponents(ORouteTab);
      expect(routeTabs.length).toBe(sampleTabs.length);
    });

    it("renders default slot content in the after pane", () => {
      wrapper = createWrapper(
        {},
        { slots: { default: '<div data-test="content-pane">Content</div>' } },
      );
      const pane = wrapper.find('[data-test="content-pane"]');
      expect(pane.exists()).toBe(true);
      expect(pane.text()).toBe("Content");
    });
  });

  describe("Search box", () => {
    it("does not render OSearchInput when searchable is false", () => {
      wrapper = createWrapper({ searchable: false });
      expect(wrapper.findComponent(OSearchInput).exists()).toBe(false);
    });

    it("renders OSearchInput when searchable is true", () => {
      wrapper = createWrapper({ searchable: true });
      expect(wrapper.findComponent(OSearchInput).exists()).toBe(true);
    });

    it("applies searchDataTest to the search input", () => {
      wrapper = createWrapper({
        searchable: true,
        searchDataTest: "ds-search",
      });
      expect(wrapper.find('[data-test="ds-search"]').exists()).toBe(true);
    });
  });

  describe("Filtering", () => {
    const setFilter = async (value: string) => {
      wrapper
        .findComponent(OSearchInput)
        .vm.$emit("update:modelValue", value);
      await nextTick();
    };

    it("renders all tabs with empty filter", async () => {
      wrapper = createWrapper({ searchable: true });
      await setFilter("");
      expect(wrapper.findAllComponents(ORouteTab).length).toBe(3);
    });

    it("renders only matching tabs for a substring", async () => {
      wrapper = createWrapper({ searchable: true });
      await setFilter("redis");
      const tabs = wrapper.findAllComponents(ORouteTab);
      expect(tabs.length).toBe(1);
      expect(tabs[0].props("name")).toBe("redis");
    });

    it("is case-insensitive", async () => {
      wrapper = createWrapper({ searchable: true });
      await setFilter("REDIS");
      const tabs = wrapper.findAllComponents(ORouteTab);
      expect(tabs.length).toBe(1);
      expect(tabs[0].props("name")).toBe("redis");
    });

    it("renders no tabs when nothing matches", async () => {
      wrapper = createWrapper({ searchable: true });
      await setFilter("nonexistent");
      expect(wrapper.findAllComponents(ORouteTab).length).toBe(0);
    });

    it("does not filter when searchable is false even if filter set", async () => {
      // With searchable false there is no search input; all tabs always render.
      wrapper = createWrapper({ searchable: false });
      expect(wrapper.findAllComponents(ORouteTab).length).toBe(3);
    });
  });

  describe("data-test attributes", () => {
    it("derives data-test from tabDataTestPrefix when tab has none", () => {
      wrapper = createWrapper({ tabDataTestPrefix: "tab-" });
      expect(wrapper.find('[data-test="tab-postgres"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tab-redis"]').exists()).toBe(true);
    });

    it("keeps a tab's own dataTest over the prefix", () => {
      wrapper = createWrapper({
        tabDataTestPrefix: "tab-",
        tabs: [
          {
            name: "postgres",
            to: { name: "postgres" },
            label: "PostgreSQL",
            dataTest: "own-pg",
          },
          { name: "redis", to: { name: "redis" }, label: "Redis" },
        ],
      });
      expect(wrapper.find('[data-test="own-pg"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tab-postgres"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="tab-redis"]').exists()).toBe(true);
    });

    it("applies panelDataTest to the tab-list wrapper", () => {
      wrapper = createWrapper({ panelDataTest: "ds-panel" });
      expect(wrapper.find('[data-test="ds-panel"]').exists()).toBe(true);
    });
  });

  describe("v-model", () => {
    it("passes modelValue down to OTabs", () => {
      wrapper = createWrapper({ modelValue: "redis" });
      const otabs = wrapper.findComponent({ name: "OTabs" });
      expect(otabs.props("modelValue")).toBe("redis");
    });

    it("emits update:modelValue when a tab is activated", async () => {
      wrapper = createWrapper();
      // The OTabs emits update:model-value; the layout re-emits it.
      const otabs = wrapper.findComponent({ name: "OTabs" });
      otabs.vm.$emit("update:model-value", "redis");
      await nextTick();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["redis"]);
    });
  });

  describe("#tabs slot override", () => {
    it("renders slot content and not the default ORouteTabs", () => {
      wrapper = createWrapper(
        {},
        {
          slots: {
            tabs: '<div data-test="custom-tabs">Custom</div>',
          },
        },
      );
      expect(wrapper.find('[data-test="custom-tabs"]').exists()).toBe(true);
      expect(wrapper.findAllComponents(ORouteTab).length).toBe(0);
    });

    it("passes filtered tabs and filter to the #tabs slot", () => {
      const slotProps: any = {};
      wrapper = createWrapper(
        { searchable: true },
        {
          slots: {
            tabs: (props: any) => {
              Object.assign(slotProps, props);
              return "slot";
            },
          },
        },
      );
      expect(Array.isArray(slotProps.tabs)).toBe(true);
      expect(slotProps.tabs.length).toBe(3);
      expect(slotProps.filter).toBe("");
    });
  });

  describe("splitter width", () => {
    it("seeds the splitter width from the prop", () => {
      wrapper = createWrapper({ splitterWidth: 320 });
      const splitter = wrapper.findComponent({ name: "OSplitter" });
      // OSplitter receives the seeded width as its modelValue.
      expect(splitter.props("modelValue")).toBe(320);
    });

    it("defaults the splitter width to 250", () => {
      wrapper = createWrapper();
      const splitter = wrapper.findComponent({ name: "OSplitter" });
      expect(splitter.props("modelValue")).toBe(250);
    });
  });
});
