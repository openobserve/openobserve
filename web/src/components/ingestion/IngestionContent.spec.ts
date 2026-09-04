import { mount } from "@vue/test-utils";
import { describe, expect, it, afterEach } from "vitest";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

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
});
