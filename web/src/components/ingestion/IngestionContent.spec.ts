import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, afterEach, vi } from "vitest";
import { defineComponent, h, inject } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import { FIRST_EVENT_SNIPPET_COPIED } from "@/composables/firstEvent/firstEventCopied";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const barStart = vi.fn();
const FirstEventStatusStub = defineComponent({
  name: "FirstEventStatus",
  props: ["org", "signal", "targetStream", "kind", "guideName", "docUrl", "snippetKind"],
  emits: ["copy-command"],
  setup: (_props, { expose }) => {
    expose({ start: barStart });
    return () => h("div", { "data-test": "first-event-status-stub" });
  },
});

const page = { template: "<div />" };
const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: page },
      {
        path: "/logs",
        name: "ingestLogs",
        component: { template: "<router-view />" },
        children: [{ path: "curl", name: "curl", component: page }],
      },
      {
        path: "/metrics",
        name: "ingestMetrics",
        component: { template: "<router-view />" },
        children: [{ path: "prometheus", name: "prometheus", component: page }],
      },
      { path: "/servers/nginx", name: "nginx", component: page },
    ],
  });

const mountAt = async (path: string, slots: Record<string, unknown>, props = {}) => {
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(IngestionContent, {
    props,
    slots,
    attachTo: document.body,
    global: {
      plugins: [i18n, router],
      provide: { store },
      stubs: { FirstEventStatus: FirstEventStatusStub },
    },
  });
  await flushPromises();
  return wrapper;
};

describe("IngestionContent.vue", () => {
  let wrapper: any = null;

  const createWrapper = (slots = {}) =>
    mount(IngestionContent, {
      slots,
      global: {
        plugins: [i18n],
        provide: { store },
      },
    });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it("mounts successfully", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("root element has the layout classes", () => {
    wrapper = createWrapper();
    const root = wrapper.find("div");
    expect(root.classes()).toContain("p-3");
    expect(root.classes()).toContain("flex");
    expect(root.classes()).toContain("flex-col");
    expect(root.classes()).toContain("gap-4");
    expect(root.classes()).toContain("text-sm");
  });

  it("renders default slot content", () => {
    wrapper = createWrapper({
      default: '<span data-test="slot-content">Hello Ingestion</span>',
    });
    const slotEl = wrapper.find('[data-test="slot-content"]');
    expect(slotEl.exists()).toBe(true);
    expect(slotEl.text()).toBe("Hello Ingestion");
    expect(wrapper.text()).toContain("Hello Ingestion");
  });

  describe("first-event bar on legacy guides", () => {
    const codeBlock = (slug: string) =>
      h("div", [
        h("button", {
          "data-test": `ingestion-${slug}-code-block-copy-btn`,
          onClick: clicks[slug],
        }),
      ]);
    const clicks: Record<string, ReturnType<typeof vi.fn>> = {};

    it("mounts one bar under the snippets and above the doc link line, with the doc link's URL", async () => {
      clicks.nginx = vi.fn();
      wrapper = await mountAt("/servers/nginx", {
        default: () => [
          codeBlock("nginx"),
          h(IngestionDocLink, { href: "https://docs.example/nginx" }),
        ],
      });
      const bar = wrapper.findComponent(FirstEventStatusStub);
      expect(wrapper.findAllComponents(FirstEventStatusStub)).toHaveLength(1);
      expect(bar.props("docUrl")).toBe("https://docs.example/nginx");
      const html = wrapper.html();
      expect(html.indexOf("first-event-status-stub")).toBeGreaterThan(
        html.indexOf("ingestion-nginx-code-block-copy-btn"),
      );
      expect(html.indexOf("first-event-status-stub")).toBeLessThan(html.indexOf("noopener"));
    });

    it("reads the curl guide as a test that posts to the default stream", async () => {
      wrapper = await mountAt("/logs/curl", { default: () => [h("div")] });
      expect(wrapper.findComponent(FirstEventStatusStub).props()).toMatchObject({
        kind: "test",
        targetStream: "default",
        signal: "logs",
      });
    });

    it("takes the signal from the guide's parent route", async () => {
      wrapper = await mountAt("/metrics/prometheus", { default: () => [h("div")] });
      expect(wrapper.findComponent(FirstEventStatusStub).props()).toMatchObject({
        kind: "standard",
        signal: "metrics",
      });
    });

    it("passes the page's guide name, signal, target and snippet kind through", async () => {
      wrapper = await mountAt(
        "/servers/nginx",
        { default: () => [h("div")] },
        { guideName: "nginx", signal: "logs", targetStream: "nginx", snippetKind: "config" },
      );
      expect(wrapper.findComponent(FirstEventStatusStub).props()).toMatchObject({
        guideName: "nginx",
        signal: "logs",
        targetStream: "nginx",
        snippetKind: "config",
      });
    });

    it("restarts the bar's watch when a snippet in the guide is copied", async () => {
      barStart.mockClear();
      const Snippet = defineComponent({
        setup: () => {
          const copied = inject(FIRST_EVENT_SNIPPET_COPIED, null);
          return () => h("button", { "data-test": "snippet", onClick: () => copied?.() });
        },
      });
      wrapper = await mountAt("/logs/curl", { default: () => [h(Snippet)] });
      await wrapper.find('[data-test="snippet"]').trigger("click");
      expect(barStart).toHaveBeenCalledWith("copy");
      expect(barStart).toHaveBeenCalledTimes(1);
    });

    it("re-copies the first block for a command and the last block for a config", async () => {
      clicks.install = vi.fn();
      clicks.config = vi.fn();
      wrapper = await mountAt("/servers/nginx", {
        default: () => [codeBlock("install"), codeBlock("config")],
      });
      wrapper.findComponent(FirstEventStatusStub).vm.$emit("copy-command");
      expect(clicks.install).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      wrapper = await mountAt(
        "/servers/nginx",
        { default: () => [codeBlock("install"), codeBlock("config")] },
        { snippetKind: "config" },
      );
      wrapper.findComponent(FirstEventStatusStub).vm.$emit("copy-command");
      expect(clicks.config).toHaveBeenCalledTimes(1);
      expect(clicks.install).toHaveBeenCalledTimes(1);
    });
  });
});
