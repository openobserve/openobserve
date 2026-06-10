import { mount } from "@vue/test-utils";
import { describe, expect, it, afterEach } from "vitest";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

describe("IngestionDocLink.vue", () => {
  let wrapper: any = null;

  const href = "https://short.openobserve.ai/database/postgres";

  const createWrapper = (props = {}, slots = {}) =>
    mount(IngestionDocLink, {
      props: { href, ...props },
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

  it("renders an anchor with the given href", () => {
    wrapper = createWrapper();
    const link = wrapper.find("a");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe(href);
  });

  it("opens in a new tab with safe rel", () => {
    wrapper = createWrapper();
    const link = wrapper.find("a");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
  });

  it("applies the design-token classes to the anchor", () => {
    wrapper = createWrapper();
    const link = wrapper.find("a");
    expect(link.classes()).toContain("tw:text-text-link");
    expect(link.classes()).toContain("hover:tw:text-text-link-hover");
    expect(link.classes()).toContain("tw:underline");
    expect(link.classes()).toContain("tw:font-medium");
  });

  it("renders the default trailing text", () => {
    wrapper = createWrapper();
    expect(wrapper.text()).toContain("to check further documentation.");
  });

  it("full text contains Click and here", () => {
    wrapper = createWrapper();
    const text = wrapper.text();
    expect(text).toContain("Click");
    expect(wrapper.find("a").text()).toBe("here");
  });

  it("custom slot text overrides the trailing text", () => {
    wrapper = createWrapper({}, { default: " for more details." });
    const text = wrapper.text();
    expect(text).toContain("for more details.");
    expect(text).not.toContain("to check further documentation.");
    // Leading "Click" + link "here" still present
    expect(text).toContain("Click");
    expect(text).toContain("here");
  });

  it("reflects a different href", () => {
    wrapper = createWrapper({ href: "https://example.com/docs" });
    expect(wrapper.find("a").attributes("href")).toBe(
      "https://example.com/docs",
    );
  });
});
