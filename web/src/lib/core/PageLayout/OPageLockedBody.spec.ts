import { describe, it, expect, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import i18n from "@/locales";
import OPageLockedBody from "./OPageLockedBody.vue";
import { provideFeatureLock } from "@/composables/useFeatureLock";

enableAutoUnmount(afterEach);

const mountBody = (lockedFeature: string | null, replace = true) =>
  mount(
    defineComponent({
      setup() {
        provideFeatureLock(ref(lockedFeature));
        return () =>
          h(OPageLockedBody, { replace }, { default: () => h("div", { "data-test": "body" }) });
      },
    }),
    { global: { plugins: [i18n], stubs: { OEmptyState: { template: "<div><slot /></div>" } } } },
  );

describe("OPageLockedBody", () => {
  it("shows the page body while nothing is locked", () => {
    const wrapper = mountBody(null);

    expect(wrapper.find('[data-test="body"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="page-layout-license-locked"]').exists()).toBe(false);
  });

  it("shows the license message in place of the body while the page is locked", () => {
    const wrapper = mountBody("workflows");

    expect(wrapper.find('[data-test="page-layout-license-locked"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="body"]').exists()).toBe(false);
  });

  it("passes the body through on a locked shell so its routed child shows the lock", () => {
    const wrapper = mountBody("workflows", false);

    expect(wrapper.find('[data-test="body"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="page-layout-license-locked"]').exists()).toBe(false);
  });
});
